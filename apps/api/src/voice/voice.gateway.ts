import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import * as admin from 'firebase-admin';
import { Server, Socket } from 'socket.io';

import { VoiceService } from './voice.service';

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
  USE_BROWSER_TTS_THRESHOLD: parseInt(process.env.VOICE_BROWSER_TTS_THRESHOLD || '100'), // Use browser TTS for short responses
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
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private sessions = new Map<string, VoiceSession>();
  private tenantSessionCounts = new Map<string, number>();
  private ttsClient: TextToSpeechClient;

  constructor(private readonly voiceService: VoiceService) {
    this.ttsClient = new TextToSpeechClient();

    // Periodic cleanup of stale sessions (every 5 minutes)
    setInterval(() => this.cleanupStaleSessions(), 300000);
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
   * Convert text to speech with cost controls
   * Returns null if limits exceeded or text too short (use browser TTS)
   */
  private async textToSpeechChunk(
    text: string,
    session: VoiceSession,
  ): Promise<{ audio: Buffer | null; useBrowserTTS: boolean }> {
    if (!text.trim()) return { audio: null, useBrowserTTS: false };

    // For very short responses, suggest browser TTS to save costs
    if (text.length < COST_LIMITS.USE_BROWSER_TTS_THRESHOLD) {
      return { audio: null, useBrowserTTS: true };
    }

    // Check hourly TTS limit
    if (!this.checkTTSLimit(session)) {
      console.log(`TTS hourly limit reached for tenant ${session.tenantId}`);
      return { audio: null, useBrowserTTS: true };
    }

    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Chirp3-HD-Zephyr',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0,
          effectsProfileId: ['headphone-class-device'],
        },
      });

      session.ttsCallsThisHour++;

      if (response.audioContent) {
        return { audio: Buffer.from(response.audioContent as Uint8Array), useBrowserTTS: false };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('TTS chunk failed:', message);
    }

    return { audio: null, useBrowserTTS: true };
  }

  /**
   * Split text into speakable sentences/phrases
   */
  private splitIntoSentences(text: string): string[] {
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  async handleConnection(client: Socket) {
    console.log(`Voice client connected: ${client.id}`);

    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      console.log(`Voice client ${client.id} - no token provided`);
      client.emit('error', { message: 'Authentication required' });
      client.disconnect();
      return;
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      const tenantId = decodedToken.uid;

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

      console.log(`Voice client ${client.id} authenticated as ${tenantId}`);
    } catch (error) {
      console.error(`Voice auth failed for ${client.id}:`, error);
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Voice client disconnected: ${client.id}`);
    this.cleanupSession(client.id);
  }

  @SubscribeMessage('setDocument')
  handleSetDocument(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { documentId: string },
  ) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    this.resetIdleTimeout(client, session);
    session.documentId = data.documentId || 'all';
    client.emit('documentSet', { documentId: session.documentId });
    console.log(`Voice session ${client.id} set document: ${session.documentId}`);
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
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    // Reset idle timeout on activity
    this.resetIdleTimeout(client, session);

    if (!data.text?.trim()) {
      client.emit('error', { message: 'Empty query' });
      return;
    }

    // Check rate limits
    const rateCheck = this.checkRateLimit(session);
    if (!rateCheck.allowed) {
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

    client.emit('voiceStart', { query: data.text });

    // Set query timeout
    session.queryTimeoutRef = setTimeout(() => {
      if (session.isActive) {
        session.isActive = false;
        client.emit('voiceError', { message: 'Query timeout - please try again' });
      }
    }, COST_LIMITS.QUERY_TIMEOUT_MS);

    try {
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

            const { audio, useBrowserTTS } = await this.textToSpeechChunk(sentence, session);
            if (audio) {
              client.emit('voiceAudioChunk', {
                audio: audio.toString('base64'),
                format: 'mp3',
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
        const { audio, useBrowserTTS } = await this.textToSpeechChunk(sentenceBuffer, session);
        if (audio) {
          client.emit('voiceAudioChunk', {
            audio: audio.toString('base64'),
            format: 'mp3',
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

      if (session.isActive) {
        client.emit('voiceEnd', {
          fullText: fullResponse,
          audioChunks: audioChunkIndex,
          truncated: totalChars > COST_LIMITS.MAX_RESPONSE_CHARS,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Processing failed';
      console.error(`Voice query error for ${client.id}:`, error);
      client.emit('voiceError', { message });
    } finally {
      session.isActive = false;
      if (session.queryTimeoutRef) {
        clearTimeout(session.queryTimeoutRef);
        session.queryTimeoutRef = undefined;
      }
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
}
