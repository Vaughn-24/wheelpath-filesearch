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

interface VoiceSession {
  tenantId: string;
  documentId: string;
  isActive: boolean;
}

/**
 * VoiceGateway - WebSocket handler for real-time voice communication
 *
 * OPTIMIZED FOR LOW LATENCY:
 * - Streams TTS audio as LLM text arrives (not after full response)
 * - Uses sentence-based chunking for natural speech boundaries
 * - Sends audio chunks immediately for progressive playback
 *
 * Flow:
 * 1. Client connects via WebSocket to /voice namespace
 * 2. Client authenticates with Firebase token
 * 3. Client sends transcribed text (from browser Speech API)
 * 4. Server streams LLM response AND converts to audio in parallel
 * 5. Client receives audio chunks and plays them progressively
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
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private sessions = new Map<string, VoiceSession>();
  private ttsClient: TextToSpeechClient;

  constructor(private readonly voiceService: VoiceService) {
    this.ttsClient = new TextToSpeechClient();
  }

  /**
   * Convert a sentence/phrase to speech using Google Cloud TTS
   * Optimized for streaming - converts small chunks quickly
   */
  private async textToSpeechChunk(text: string): Promise<Buffer | null> {
    if (!text.trim()) return null;

    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: 'en-US',
          // Journey voices are the most natural-sounding (Neural2 based)
          name: 'en-US-Journey-D', // Male, calm, professional
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.05, // Slightly faster for responsiveness
          pitch: 0,
          effectsProfileId: ['headphone-class-device'],
        },
      });

      if (response.audioContent) {
        return Buffer.from(response.audioContent as Uint8Array);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('TTS chunk failed:', message);
    }
    return null;
  }

  /**
   * Split text into speakable sentences/phrases
   * This allows us to start TTS before the full response is ready
   */
  private splitIntoSentences(text: string): string[] {
    // Split on sentence boundaries while preserving the delimiters
    const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
  }

  async handleConnection(client: Socket) {
    console.log(`Voice client connected: ${client.id}`);

    // Authenticate on connection
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

      this.sessions.set(client.id, {
        tenantId,
        documentId: 'all',
        isActive: false,
      });

      client.emit('authenticated', { tenantId });
      console.log(`Voice client ${client.id} authenticated as ${tenantId}`);
    } catch (error) {
      console.error(`Voice auth failed for ${client.id}:`, error);
      client.emit('error', { message: 'Invalid token' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Voice client disconnected: ${client.id}`);
    this.sessions.delete(client.id);
  }

  /**
   * Set the document context for this voice session
   */
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

    session.documentId = data.documentId || 'all';
    client.emit('documentSet', { documentId: session.documentId });
    console.log(`Voice session ${client.id} set document: ${session.documentId}`);
  }

  /**
   * Process transcribed speech and stream back response WITH AUDIO
   *
   * OPTIMIZED FLOW (streaming TTS):
   * 1. LLM starts generating text
   * 2. As sentences complete, immediately convert to audio
   * 3. Send audio chunks to client for progressive playback
   * 4. User hears response ~1-2s after asking (not 5-8s)
   *
   * Client sends: { text: "What's on page 5?" }
   * Server emits:
   *   - 'voiceStart' when processing begins
   *   - 'voiceChunk' for each text chunk (for display)
   *   - 'voiceAudioChunk' for each audio chunk (for playback)
   *   - 'voiceEnd' when complete
   */
  @SubscribeMessage('voiceQuery')
  async handleVoiceQuery(@ConnectedSocket() client: Socket, @MessageBody() data: { text: string }) {
    const session = this.sessions.get(client.id);
    if (!session) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }

    if (!data.text?.trim()) {
      client.emit('error', { message: 'Empty query' });
      return;
    }

    if (session.isActive) {
      client.emit('voiceCancelled', { reason: 'New query started' });
    }

    session.isActive = true;
    client.emit('voiceStart', { query: data.text });

    try {
      const stream = this.voiceService.streamVoiceResponse(
        session.tenantId,
        session.documentId,
        data.text,
      );

      let fullResponse = '';
      let sentenceBuffer = '';
      let audioChunkIndex = 0;

      for await (const chunk of stream) {
        if (!session.isActive) break;

        fullResponse += chunk;
        sentenceBuffer += chunk;
        client.emit('voiceChunk', { text: chunk });

        // Check if we have complete sentences to speak
        const sentences = this.splitIntoSentences(sentenceBuffer);

        // If we have at least one complete sentence (ends with punctuation)
        // AND there's more content after it, speak the complete sentences
        if (
          sentences.length > 1 ||
          (sentences.length === 1 && /[.!?]$/.test(sentenceBuffer.trim()))
        ) {
          // Keep the last incomplete sentence in the buffer
          const lastSentence = sentences[sentences.length - 1];
          const isLastComplete = /[.!?]$/.test(lastSentence.trim());

          const sentencesToSpeak = isLastComplete ? sentences : sentences.slice(0, -1);
          sentenceBuffer = isLastComplete ? '' : lastSentence;

          // Convert sentences to audio and send immediately
          for (const sentence of sentencesToSpeak) {
            if (!session.isActive) break;

            const audioBuffer = await this.textToSpeechChunk(sentence);
            if (audioBuffer) {
              client.emit('voiceAudioChunk', {
                audio: audioBuffer.toString('base64'),
                format: 'mp3',
                index: audioChunkIndex++,
                text: sentence,
              });
            }
          }
        }
      }

      // Speak any remaining text in the buffer
      if (session.isActive && sentenceBuffer.trim()) {
        const audioBuffer = await this.textToSpeechChunk(sentenceBuffer);
        if (audioBuffer) {
          client.emit('voiceAudioChunk', {
            audio: audioBuffer.toString('base64'),
            format: 'mp3',
            index: audioChunkIndex++,
            text: sentenceBuffer,
            isFinal: true,
          });
        }
      }

      if (session.isActive) {
        client.emit('voiceEnd', {
          fullText: fullResponse,
          audioChunks: audioChunkIndex,
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Processing failed';
      console.error(`Voice query error for ${client.id}:`, error);
      client.emit('voiceError', { message });
    } finally {
      session.isActive = false;
    }
  }

  /**
   * Cancel an in-progress voice response
   */
  @SubscribeMessage('voiceCancel')
  handleVoiceCancel(@ConnectedSocket() client: Socket) {
    const session = this.sessions.get(client.id);
    if (session) {
      session.isActive = false;
      client.emit('voiceCancelled', { reason: 'User cancelled' });
    }
  }
}
