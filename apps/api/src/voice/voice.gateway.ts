import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import * as admin from 'firebase-admin';
import { Server, Socket } from 'socket.io';

import { VoiceService } from './voice.service';
import { VoiceLiveService } from './voice-live.service';

/**
 * ============================================================================
 * COST PROTECTION CONFIGURATION
 * ============================================================================
 * These limits protect against runaway costs from voice sessions.
 * All values are configurable via environment variables.
 */
const COST_LIMITS = {
  // Connection limits
  IDLE_TIMEOUT_MS: parseInt(process.env.VOICE_IDLE_TIMEOUT_MS || '300000'), // 5 minutes
  MAX_SESSION_DURATION_MS: parseInt(process.env.VOICE_MAX_SESSION_MS || '1800000'), // 30 minutes
  MAX_SESSIONS_PER_TENANT: parseInt(process.env.VOICE_MAX_SESSIONS_PER_TENANT || '3'),
  HEARTBEAT_INTERVAL_MS: parseInt(process.env.VOICE_HEARTBEAT_MS || '30000'), // 30 seconds

  // Query rate limiting
  MAX_QUERIES_PER_MINUTE: parseInt(process.env.VOICE_MAX_QUERIES_PER_MIN || '10'),
  QUERY_COOLDOWN_MS: parseInt(process.env.VOICE_QUERY_COOLDOWN_MS || '2000'), // 2 seconds between queries
  QUERY_TIMEOUT_MS: parseInt(process.env.VOICE_QUERY_TIMEOUT_MS || '30000'), // 30 second max query time

  // TTS cost controls
  MAX_RESPONSE_CHARS: parseInt(process.env.VOICE_MAX_RESPONSE_CHARS || '2000'), // ~$0.032 max per response
  USE_BROWSER_TTS_THRESHOLD: parseInt(process.env.VOICE_BROWSER_TTS_THRESHOLD || '0'), // Always use Gemini TTS
  MAX_TTS_CALLS_PER_HOUR: parseInt(process.env.VOICE_MAX_TTS_PER_HOUR || '100'),
};

interface VoiceSession {
  tenantId: string;
  documentId: string;
  isActive: boolean;
  // Cost protection tracking
  connectedAt: number;
  lastActivityAt: number;
  queryCount: number;
  queryCountResetAt: number;
  lastQueryAt: number;
  ttsCallsThisHour: number;
  ttsCallsResetAt: number;
  idleTimeoutRef?: NodeJS.Timeout;
  sessionTimeoutRef?: NodeJS.Timeout;
  heartbeatRef?: NodeJS.Timeout;
  queryTimeoutRef?: NodeJS.Timeout;
}

/**
 * VoiceGateway - WebSocket handler for real-time voice communication
 *
 * COST PROTECTIONS IMPLEMENTED:
 * 1. Idle timeout - disconnects after 5 min of inactivity
 * 2. Max session duration - hard limit of 30 min
 * 3. Query rate limiting - max 10 queries/minute
 * 4. Query cooldown - 2 seconds between queries
 * 5. Query timeout - 30 second max processing time
 * 6. TTS cost controls - max response length, hourly limits
 * 7. Concurrent session limits per tenant
 * 8. Heartbeat for dead connection detection
 */
@WebSocketGateway({
  namespace: '/voice',
  cors: {
    origin: [
      'https://wheelpath-web-945257727887.us-central1.run.app',
      'https://wheelpath2-ai.pages.dev',
      'https://wheelpath-ai.pages.dev',
      /https:\/\/.*\.wheelpath2-ai\.pages\.dev$/,
      'https://dev.wheelpath.ai',
      'https://wheelpath.ai',
      'http://localhost:3000',
      'http://localhost:3002',
    ],
    credentials: true,
  },
  pingInterval: 25000, // Socket.io built-in ping
  pingTimeout: 10000,
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  private sessions = new Map<string, VoiceSession>();
  private tenantSessionCounts = new Map<string, number>();
  private genAI: GoogleGenerativeAI | null = null;
  private ttsVoice = process.env.GEMINI_TTS_VOICE || 'Kore'; // Kore = American, firm

  constructor(
    private readonly voiceService: VoiceService,
    private readonly voiceLiveService: VoiceLiveService,
  ) {
    // Initialize Gemini for TTS
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      console.log(`[VoiceGateway] Gemini TTS initialized with voice: ${this.ttsVoice}`);
    } else {
      console.warn('[VoiceGateway] GEMINI_API_KEY not set - TTS will use browser fallback');
    }

    // Periodic cleanup of stale sessions (every 5 minutes)
    setInterval(() => this.cleanupStaleSessions(), 300000);
  }

  afterInit(server: Server) {
    // Debug: Log all incoming messages at the server level
    console.log('[VoiceGateway] Gateway initialized, setting up message listeners');
    console.log('[VoiceGateway] Server namespaces:', (server as any)._nsps);
    
    // Use this.server which is already scoped to the /voice namespace via @WebSocketGateway decorator
    // Listen to connections on this namespace
    this.server.on('connection', (socket) => {
      console.log(`[VoiceGateway] Raw socket.io connection in /voice namespace: ${socket.id}`);
      
      // Log all events on this socket
      socket.onAny((event, ...args) => {
        console.log(`[VoiceGateway] ====== RAW SOCKET EVENT ======`);
        console.log(`[VoiceGateway] Event: ${event} from ${socket.id}`, {
          argsCount: args.length,
          firstArg: args[0] ? JSON.stringify(args[0]).substring(0, 500) : 'none',
          allArgs: args.map((a, i) => ({
            index: i,
            type: typeof a,
            value: JSON.stringify(a).substring(0, 200),
          })),
        });
      });
    });
  }

  /**
   * Cleanup sessions that might have missed disconnect events
   */
  private cleanupStaleSessions() {
    const now = Date.now();
    for (const [clientId, session] of this.sessions.entries()) {
      const sessionAge = now - session.connectedAt;
      const idleTime = now - session.lastActivityAt;

      if (
        sessionAge > COST_LIMITS.MAX_SESSION_DURATION_MS ||
        idleTime > COST_LIMITS.IDLE_TIMEOUT_MS * 2
      ) {
        console.log(`Cleaning up stale session: ${clientId}`);
        this.cleanupSession(clientId);
      }
    }
  }

  /**
   * Clean up all timers and resources for a session
   */
  private cleanupSession(clientId: string) {
    const session = this.sessions.get(clientId);
    if (session) {
      // Clear all timers
      if (session.idleTimeoutRef) clearTimeout(session.idleTimeoutRef);
      if (session.sessionTimeoutRef) clearTimeout(session.sessionTimeoutRef);
      if (session.heartbeatRef) clearInterval(session.heartbeatRef);
      if (session.queryTimeoutRef) clearTimeout(session.queryTimeoutRef);

      // Decrement tenant session count
      const count = this.tenantSessionCounts.get(session.tenantId) || 0;
      if (count > 0) {
        this.tenantSessionCounts.set(session.tenantId, count - 1);
      }

      this.sessions.delete(clientId);
    }
  }

  /**
   * Reset idle timeout - called on any activity
   */
  private resetIdleTimeout(client: Socket, session: VoiceSession) {
    session.lastActivityAt = Date.now();

    if (session.idleTimeoutRef) {
      clearTimeout(session.idleTimeoutRef);
    }

    session.idleTimeoutRef = setTimeout(() => {
      console.log(`Idle timeout for ${client.id} - disconnecting`);
      client.emit('sessionTimeout', {
        reason: 'idle',
        message: 'Session closed due to inactivity',
      });
      client.disconnect();
    }, COST_LIMITS.IDLE_TIMEOUT_MS);
  }

  /**
   * Check if rate limit allows a new query
   */
  private checkRateLimit(session: VoiceSession): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // Reset query count if minute has passed
    if (now - session.queryCountResetAt > 60000) {
      session.queryCount = 0;
      session.queryCountResetAt = now;
    }

    // Check queries per minute
    if (session.queryCount >= COST_LIMITS.MAX_QUERIES_PER_MINUTE) {
      return {
        allowed: false,
        reason: `Rate limit exceeded. Max ${COST_LIMITS.MAX_QUERIES_PER_MINUTE} queries per minute.`,
      };
    }

    // Check cooldown between queries
    if (now - session.lastQueryAt < COST_LIMITS.QUERY_COOLDOWN_MS) {
      const waitTime = Math.ceil(
        (COST_LIMITS.QUERY_COOLDOWN_MS - (now - session.lastQueryAt)) / 1000,
      );
      return {
        allowed: false,
        reason: `Please wait ${waitTime} second(s) between queries.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Check if TTS is allowed (hourly limit)
   */
  private checkTTSLimit(session: VoiceSession): boolean {
    const now = Date.now();

    // Reset hourly count
    if (now - session.ttsCallsResetAt > 3600000) {
      session.ttsCallsThisHour = 0;
      session.ttsCallsResetAt = now;
    }

    return session.ttsCallsThisHour < COST_LIMITS.MAX_TTS_CALLS_PER_HOUR;
  }

  /**
   * Convert text to speech using Gemini Native TTS
   * Uses voices: Charon (default), Puck, Kore, Fenrir, Aoede
   * Returns null if limits exceeded or text too short (use browser TTS)
   */
  private async textToSpeechChunk(
    text: string,
    session: VoiceSession,
  ): Promise<{ audio: Buffer | null; useBrowserTTS: boolean; format: string }> {
    if (!text.trim()) return { audio: null, useBrowserTTS: false, format: 'wav' };

    // For very short responses, suggest browser TTS to save costs
    if (text.length < COST_LIMITS.USE_BROWSER_TTS_THRESHOLD) {
      return { audio: null, useBrowserTTS: true, format: 'wav' };
    }

    // Check hourly TTS limit
    if (!this.checkTTSLimit(session)) {
      console.log(`TTS hourly limit reached for tenant ${session.tenantId}`);
      return { audio: null, useBrowserTTS: true, format: 'wav' };
    }

    // Check if Gemini is initialized
    if (!this.genAI) {
      return { audio: null, useBrowserTTS: true, format: 'wav' };
    }

    try {
      // Use Gemini TTS model with configured voice
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-preview-tts',
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: this.ttsVoice },
            },
          },
        } as any, // Type assertion needed for TTS-specific config
      });

      session.ttsCallsThisHour++;

      // Extract audio from response
      const audioData = result.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (audioData?.data) {
        // Gemini returns raw PCM audio - we need to wrap it in a WAV header for browser playback
        const pcmData = Buffer.from(audioData.data, 'base64');
        const wavBuffer = this.pcmToWav(pcmData);
        return { audio: wavBuffer, useBrowserTTS: false, format: 'wav' };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[VoiceGateway] Gemini TTS failed:', message);
    }

    return { audio: null, useBrowserTTS: true, format: 'wav' };
  }

  /**
   * Convert raw PCM data to WAV format with proper headers
   * Gemini TTS returns 24kHz 16-bit mono PCM
   */
  private pcmToWav(pcmData: Buffer): Buffer {
    const sampleRate = 24000; // Gemini TTS uses 24kHz
    const numChannels = 1;    // Mono
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmData.length;
    const headerSize = 44;
    
    const wavBuffer = Buffer.alloc(headerSize + dataSize);
    
    // RIFF header
    wavBuffer.write('RIFF', 0);
    wavBuffer.writeUInt32LE(36 + dataSize, 4);
    wavBuffer.write('WAVE', 8);
    
    // fmt subchunk
    wavBuffer.write('fmt ', 12);
    wavBuffer.writeUInt32LE(16, 16);           // Subchunk1Size (16 for PCM)
    wavBuffer.writeUInt16LE(1, 20);            // AudioFormat (1 = PCM)
    wavBuffer.writeUInt16LE(numChannels, 22);  // NumChannels
    wavBuffer.writeUInt32LE(sampleRate, 24);   // SampleRate
    wavBuffer.writeUInt32LE(byteRate, 28);     // ByteRate
    wavBuffer.writeUInt16LE(blockAlign, 32);   // BlockAlign
    wavBuffer.writeUInt16LE(bitsPerSample, 34);// BitsPerSample
    
    // data subchunk
    wavBuffer.write('data', 36);
    wavBuffer.writeUInt32LE(dataSize, 40);
    
    // Copy PCM data
    pcmData.copy(wavBuffer, headerSize);
    
    return wavBuffer;
  }

  /**
   * Split text into speakable sentences/phrases
   */
  private splitIntoSentences(text: string): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  async handleConnection(client: Socket) {
    // [Checkpoint 6] WebSocket connection received
    console.log(`[VoiceGateway] Client connecting: ${client.id}`, {
      transport: (client as any).transport?.name || 'unknown',
      handshakeAuth: !!client.handshake.auth,
      handshakeHeaders: Object.keys(client.handshake.headers || {}),
    });

    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      console.warn(`[VoiceGateway] Client ${client.id} - no token provided`, {
        hasAuthToken: !!client.handshake.auth?.token,
        hasAuthHeader: !!client.handshake.headers?.authorization,
      });
      client.emit('error', { message: 'Authentication required' });
      client.disconnect();
      return;
    }

    try {
      // [Checkpoint 7] WebSocket authentication
      console.log(`[VoiceGateway] Verifying token for ${client.id}`, {
        hasToken: !!token,
        tokenLength: token?.length || 0,
        tokenPrefix: token?.substring(0, 20) || 'none',
      });

      const decodedToken = await admin.auth().verifyIdToken(token);
      const tenantId = decodedToken.uid;

      console.log(`[VoiceGateway] Token verified for ${client.id}`, {
        tenantId,
        uid: decodedToken.uid,
        email: decodedToken.email || 'none',
      });

      // Check concurrent session limit per tenant
      const currentSessions = this.tenantSessionCounts.get(tenantId) || 0;
      if (currentSessions >= COST_LIMITS.MAX_SESSIONS_PER_TENANT) {
        console.log(`Tenant ${tenantId} exceeded max sessions (${currentSessions})`);
        client.emit('error', {
          message: `Maximum ${COST_LIMITS.MAX_SESSIONS_PER_TENANT} concurrent voice sessions allowed`,
        });
        client.disconnect();
        return;
      }

      const now = Date.now();
      const session: VoiceSession = {
        tenantId,
        documentId: 'all',
        isActive: false,
        connectedAt: now,
        lastActivityAt: now,
        queryCount: 0,
        queryCountResetAt: now,
        lastQueryAt: 0,
        ttsCallsThisHour: 0,
        ttsCallsResetAt: now,
      };

      this.sessions.set(client.id, session);
      this.tenantSessionCounts.set(tenantId, currentSessions + 1);

      // Set up max session duration timeout
      session.sessionTimeoutRef = setTimeout(() => {
        console.log(`Max session duration reached for ${client.id}`);
        client.emit('sessionTimeout', {
          reason: 'maxDuration',
          message: 'Maximum session duration reached (30 minutes)',
        });
        client.disconnect();
      }, COST_LIMITS.MAX_SESSION_DURATION_MS);

      // Set up idle timeout
      this.resetIdleTimeout(client, session);

      // Set up heartbeat
      session.heartbeatRef = setInterval(() => {
        client.emit('heartbeat', { timestamp: Date.now() });
      }, COST_LIMITS.HEARTBEAT_INTERVAL_MS);

      client.emit('authenticated', {
        tenantId,
        limits: {
          maxQueriesPerMinute: COST_LIMITS.MAX_QUERIES_PER_MINUTE,
          queryCooldownMs: COST_LIMITS.QUERY_COOLDOWN_MS,
          maxSessionMinutes: COST_LIMITS.MAX_SESSION_DURATION_MS / 60000,
          idleTimeoutMinutes: COST_LIMITS.IDLE_TIMEOUT_MS / 60000,
        },
      });

      console.log(`[VoiceGateway] Client ${client.id} authenticated as ${tenantId}`);
      console.log(`[VoiceGateway] Active sessions: ${this.sessions.size}`);
      console.log(`[VoiceGateway] Session details:`, {
        clientId: client.id,
        tenantId: session.tenantId,
        documentId: session.documentId,
        isActive: session.isActive,
      });
      
      // Debug: Set up message listener on this specific client
      client.onAny((event, ...args) => {
        console.log(`[VoiceGateway] Client ${client.id} event: ${event}`, {
          argsCount: args.length,
          firstArg: args[0] ? JSON.stringify(args[0]).substring(0, 300) : 'none',
        });
      });
      console.log(`[VoiceGateway] Active sessions: ${this.sessions.size}`);
      console.log(`[VoiceGateway] Session for ${client.id}:`, {
        tenantId: session.tenantId,
        documentId: session.documentId,
        isActive: session.isActive,
      });
    } catch (error) {
      console.error(`[VoiceGateway] Auth failed for ${client.id}`, {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: (error as any)?.code || 'unknown',
        stack: error instanceof Error ? error.stack : undefined,
      });
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[VoiceGateway] Client disconnected: ${client.id}`, {
      reason: client.disconnected ? 'client' : 'server',
    });
    // Cleanup Live API session if exists
    this.voiceLiveService.closeSession(client.id).catch(console.error);
    // Cleanup regular session
    this.cleanupSession(client.id);
  }

  @SubscribeMessage('setDocument')
  handleSetDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { documentId: string },
  ) {
    console.log(`[VoiceGateway] ====== setDocument SUBSCRIBE HANDLER CALLED ======`);
    console.log(`[VoiceGateway] setDocument received from ${client.id}`, {
      documentId: data.documentId,
      hasSession: this.sessions.has(client.id),
      activeSessions: this.sessions.size,
    });

    const session = this.sessions.get(client.id);
    if (!session) {
      console.warn(`[VoiceGateway] setDocument from unauthenticated client ${client.id}`);
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.resetIdleTimeout(client, session);
    session.documentId = data.documentId || 'all';
    client.emit('documentSet', { documentId: session.documentId });
    console.log(`[VoiceGateway] Voice session ${client.id} set document: ${session.documentId}`);
  }

  @SubscribeMessage('heartbeatAck')
  handleHeartbeatAck(@ConnectedSocket() client: Socket) {
    const session = this.sessions.get(client.id);
    if (session) {
      this.resetIdleTimeout(client, session);
    }
  }

  @SubscribeMessage('voiceQuery')
  async handleVoiceQuery(@ConnectedSocket() client: Socket, @MessageBody() data: { text: string }) {
    // [Checkpoint 11] Voice query received
    console.log(`[VoiceGateway] ====== voiceQuery SUBSCRIBE HANDLER CALLED ======`);
    console.log(`[VoiceGateway] voiceQuery received from ${client.id}`, {
      textLength: data.text?.length || 0,
      text: data.text?.substring(0, 100) || 'none',
      dataType: typeof data,
      dataKeys: data ? Object.keys(data) : 'no data',
      fullData: JSON.stringify(data).substring(0, 500),
    });
    console.log(`[VoiceGateway] Active sessions count: ${this.sessions.size}`);
    console.log(`[VoiceGateway] Session IDs:`, Array.from(this.sessions.keys()));

    const session = this.sessions.get(client.id);
    if (!session) {
      console.warn(`[VoiceGateway] voiceQuery from unauthenticated client ${client.id}`);
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Reset idle timeout on activity
    this.resetIdleTimeout(client, session);

    if (!data.text?.trim()) {
      console.warn(`[VoiceGateway] Empty query from ${client.id}`);
      client.emit('error', { message: 'Empty query' });
      return;
    }

    // Check rate limits
    const rateCheck = this.checkRateLimit(session);
    if (!rateCheck.allowed) {
      console.warn(`[VoiceGateway] Rate limit hit for ${client.id}`, rateCheck);
      client.emit('rateLimited', { message: rateCheck.reason });
      return;
    }

    // Check if already processing
    if (session.isActive) {
      client.emit('voiceCancelled', { reason: 'New query started' });
      if (session.queryTimeoutRef) {
        clearTimeout(session.queryTimeoutRef);
      }
    }

    // Update rate limiting counters
    session.queryCount++;
    session.lastQueryAt = Date.now();
    session.isActive = true;

    console.log(`[VoiceGateway] Starting voice query processing for ${client.id}`, {
      tenantId: session.tenantId,
      documentId: session.documentId,
      queryLength: data.text.length,
    });

    client.emit('voiceStart', { query: data.text });

    // Set query timeout
    session.queryTimeoutRef = setTimeout(() => {
      if (session.isActive) {
        console.warn(`[VoiceGateway] Query timeout for ${client.id}`);
        session.isActive = false;
        client.emit('voiceError', { message: 'Query timeout - please try again' });
      }
    }, COST_LIMITS.QUERY_TIMEOUT_MS);

    try {
      // [Checkpoint 12] Service method invoked
      console.log(`[VoiceGateway] Calling voiceService.streamVoiceResponse`, {
        tenantId: session.tenantId,
        documentId: session.documentId,
      });

      const stream = this.voiceService.streamVoiceResponse(
        session.tenantId,
        session.documentId,
        data.text,
      );

      let fullResponse = '';
      let sentenceBuffer = '';
      let audioChunkIndex = 0;
      let totalChars = 0;

      for await (const chunk of stream) {
        if (!session.isActive) break;

        // Enforce max response length
        totalChars += chunk.length;
        if (totalChars > COST_LIMITS.MAX_RESPONSE_CHARS) {
          const truncatedChunk = chunk.slice(
            0,
            COST_LIMITS.MAX_RESPONSE_CHARS - (totalChars - chunk.length),
          );
          fullResponse += truncatedChunk;
          sentenceBuffer += truncatedChunk;
          client.emit('voiceChunk', { text: truncatedChunk, truncated: true });
          break;
        }

        fullResponse += chunk;
        sentenceBuffer += chunk;
        client.emit('voiceChunk', { text: chunk });

        const sentences = this.splitIntoSentences(sentenceBuffer);

        if (
          sentences.length > 1 ||
          (sentences.length === 1 && /[.!?]$/.test(sentenceBuffer.trim()))
        ) {
          const lastSentence = sentences[sentences.length - 1];
          const isLastComplete = /[.!?]$/.test(lastSentence.trim());

          const sentencesToSpeak = isLastComplete ? sentences : sentences.slice(0, -1);
          sentenceBuffer = isLastComplete ? '' : lastSentence;

          for (const sentence of sentencesToSpeak) {
            if (!session.isActive) break;

            const { audio, useBrowserTTS, format } = await this.textToSpeechChunk(sentence, session);
            if (audio) {
              client.emit('voiceAudioChunk', {
                audio: audio.toString('base64'),
                format,
                index: audioChunkIndex++,
                text: sentence,
              });
            } else if (useBrowserTTS) {
              // Tell client to use browser TTS for this chunk
              client.emit('voiceBrowserTTS', {
                text: sentence,
                index: audioChunkIndex++,
              });
            }
          }
        }
      }

      // Speak remaining buffer
      if (session.isActive && sentenceBuffer.trim()) {
        const { audio, useBrowserTTS, format } = await this.textToSpeechChunk(sentenceBuffer, session);
        if (audio) {
          client.emit('voiceAudioChunk', {
            audio: audio.toString('base64'),
            format,
            index: audioChunkIndex++,
            text: sentenceBuffer,
            isFinal: true,
          });
        } else if (useBrowserTTS) {
          client.emit('voiceBrowserTTS', {
            text: sentenceBuffer,
            index: audioChunkIndex++,
            isFinal: true,
          });
        }
      }

      // Always emit voiceEnd if we have a response, even if session was cancelled
      if (fullResponse.length > 0 || audioChunkIndex > 0) {
        console.log(`[VoiceGateway] Voice query completed for ${client.id}`, {
          responseLength: fullResponse.length,
          audioChunks: audioChunkIndex,
          truncated: totalChars > COST_LIMITS.MAX_RESPONSE_CHARS,
          wasActive: session.isActive,
        });
        if (!client.disconnected) {
          client.emit('voiceEnd', {
            fullText: fullResponse,
            audioChunks: audioChunkIndex,
            truncated: totalChars > COST_LIMITS.MAX_RESPONSE_CHARS,
          });
        }
      } else if (session.isActive) {
        // No response received but session still active - emit empty response
        console.warn(`[VoiceGateway] Voice query completed with no response for ${client.id}`);
        if (!client.disconnected) {
          client.emit('voiceEnd', {
            fullText: '',
            audioChunks: 0,
            error: 'No response received from service',
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Processing failed';
      console.error(`[VoiceGateway] Voice query error for ${client.id}`, {
        error,
        errorMessage: message,
        stack: error instanceof Error ? error.stack : undefined,
      });
      if (!client.disconnected) {
        client.emit('voiceError', { message });
        // Also emit voiceEnd to ensure frontend state is reset
        client.emit('voiceEnd', {
          fullText: '',
          audioChunks: 0,
          error: message,
        });
      }
    } finally {
      session.isActive = false;
      if (session.queryTimeoutRef) {
        clearTimeout(session.queryTimeoutRef);
        session.queryTimeoutRef = undefined;
      }
      console.log(`[VoiceGateway] Voice query cleanup completed for ${client.id}`);
    }
  }

  @SubscribeMessage('voiceCancel')
  handleVoiceCancel(@ConnectedSocket() client: Socket) {
    const session = this.sessions.get(client.id);
    if (session) {
      session.isActive = false;
      if (session.queryTimeoutRef) {
        clearTimeout(session.queryTimeoutRef);
        session.queryTimeoutRef = undefined;
      }
      client.emit('voiceCancelled', { reason: 'User cancelled' });
    }
  }

  /**
   * ============================================================================
   * GEMINI LIVE API HANDLERS (New Audio-Native Implementation)
   * ============================================================================
   */

  @SubscribeMessage('startLiveSession')
  async handleStartLiveSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { documentId?: string },
  ) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.resetIdleTimeout(client, session);
    const documentId = data.documentId || session.documentId || 'all';

    console.log(`[VoiceLive] Starting Live API session for ${client.id}, document: ${documentId}`);

    const result = await this.voiceLiveService.createLiveSession(
      client.id,
      session.tenantId,
      documentId,
    );

    if (!result.success) {
      client.emit('liveError', { message: result.error || 'Failed to start Live API session' });
      return;
    }

    // Set up message forwarding from Gemini Live API to client
    const geminiWs = this.voiceLiveService.getSession(client.id);
    if (geminiWs) {
      geminiWs.on('message', (data: string | Buffer) => {
        try {
          const message = JSON.parse(data.toString());

          // Forward audio responses to client
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData?.mimeType === 'audio/pcm') {
                // Send raw PCM audio to client
                client.emit('liveAudio', {
                  audio: part.inlineData.data, // Base64 encoded PCM
                  format: 'pcm',
                  sampleRate: 24000, // Gemini Live outputs 24kHz
                });
              }
            }
          }

          // Forward function call requests (for debugging)
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.functionCall) {
                client.emit('liveFunctionCall', {
                  name: part.functionCall.name,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  args: part.functionCall.args as any,
                });
              }
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[VoiceLive] Error forwarding message:`, message);
        }
      });

      geminiWs.on('error', (error: Error) => {
        console.error(`[VoiceLive] Gemini WebSocket error:`, error);
        client.emit('liveError', { message: 'Connection error' });
      });

      geminiWs.on('close', () => {
        console.log(`[VoiceLive] Gemini WebSocket closed for ${client.id}`);
        client.emit('liveDisconnected');
      });
    }

    client.emit('liveSessionReady', { documentId });
  }

  @SubscribeMessage('sendLiveAudio')
  async handleSendLiveAudio(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { audio: string }, // Base64 encoded PCM audio
  ) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.resetIdleTimeout(client, session);

    // Convert base64 to Buffer
    const audioBuffer = Buffer.from(data.audio, 'base64');

    const result = await this.voiceLiveService.sendAudio(client.id, audioBuffer);
    if (!result.success) {
      client.emit('liveError', { message: result.error || 'Failed to send audio' });
    }
  }

  @SubscribeMessage('stopLiveSession')
  async handleStopLiveSession(@ConnectedSocket() client: Socket) {
    await this.voiceLiveService.closeSession(client.id);
    client.emit('liveSessionStopped');
  }
}
