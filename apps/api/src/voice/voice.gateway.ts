import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as admin from 'firebase-admin';
import { VoiceService } from './voice.service';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';

interface VoiceSession {
  tenantId: string;
  documentId: string;
  isActive: boolean;
}

/**
 * VoiceGateway - WebSocket handler for real-time voice communication
 * 
 * This is COMPLETELY ISOLATED from the HTTP-based chat endpoint.
 * The existing /chat/stream REST endpoint remains untouched.
 * 
 * Flow:
 * 1. Client connects via WebSocket to /voice namespace
 * 2. Client authenticates with Firebase token
 * 3. Client sends transcribed text (from browser Speech API or Whisper)
 * 4. Server streams back text response
 * 5. Client converts to speech (browser TTS or external service)
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
   * Convert text to high-quality speech using Google Cloud TTS
   * Uses Journey voices for the most natural sound
   */
  private async textToSpeech(text: string): Promise<Buffer | null> {
    try {
      const [response] = await this.ttsClient.synthesizeSpeech({
        input: { text },
        voice: {
          languageCode: 'en-US',
          // Journey voices are the most natural-sounding
          name: 'en-US-Journey-D', // Male, calm, professional
          // Alternative options:
          // 'en-US-Journey-F' - Female, calm, professional
          // 'en-US-Studio-O' - Male, warm
          // 'en-US-Studio-Q' - Female, warm
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0,
          effectsProfileId: ['headphone-class-device'], // Optimized for headphones
        },
      });

      if (response.audioContent) {
        return Buffer.from(response.audioContent as Uint8Array);
      }
    } catch (error: any) {
      console.error('TTS failed:', error.message);
    }
    return null;
  }

  async handleConnection(client: Socket) {
    console.log(`Voice client connected: ${client.id}`);
    
    // Authenticate on connection
    const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
    
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
    @MessageBody() data: { documentId: string }
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
   * Process transcribed speech and stream back response
   * 
   * Client sends: { text: "What's on page 5?" }
   * Server emits: 
   *   - 'voiceStart' when processing begins
   *   - 'voiceChunk' for each text chunk
   *   - 'voiceEnd' when complete
   */
  @SubscribeMessage('voiceQuery')
  async handleVoiceQuery(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string }
  ) {
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
      // Cancel previous query if still running
      client.emit('voiceCancelled', { reason: 'New query started' });
    }

    session.isActive = true;
    client.emit('voiceStart', { query: data.text });

    try {
      // Stream the response for lower latency
      const stream = this.voiceService.streamVoiceResponse(
        session.tenantId,
        session.documentId,
        data.text
      );

      let fullResponse = '';
      for await (const chunk of stream) {
        if (!session.isActive) {
          // Query was cancelled
          break;
        }
        fullResponse += chunk;
        client.emit('voiceChunk', { text: chunk });
      }

      if (session.isActive) {
        // Convert text to high-quality speech using Google Cloud TTS
        const audioBuffer = await this.textToSpeech(fullResponse);
        
        if (audioBuffer) {
          // Send audio as base64 for the client to play
          const audioBase64 = audioBuffer.toString('base64');
          client.emit('voiceAudio', { 
            audio: audioBase64, 
            format: 'mp3',
            fullText: fullResponse 
          });
        }
        
        client.emit('voiceEnd', { fullText: fullResponse, hasAudio: !!audioBuffer });
      }
    } catch (error: any) {
      console.error(`Voice query error for ${client.id}:`, error);
      client.emit('voiceError', { message: error.message || 'Processing failed' });
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

