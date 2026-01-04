import { Injectable } from '@nestjs/common';
import * as aiplatform from '@google-cloud/aiplatform';
import * as admin from 'firebase-admin';
import { MetricsService } from '../metrics/metrics.service';
import WebSocket from 'ws';

/**
 * VoiceLiveService - Gemini Live API integration with RAG
 * 
 * This service handles the Gemini Live API WebSocket connection with:
 * 1. Function calling for on-demand RAG retrieval
 * 2. Raw PCM audio streaming (16kHz input, 24kHz output)
 * 3. Integration with existing vector search and document storage
 */
@Injectable()
export class VoiceLiveService {
  private predictionClient: aiplatform.v1.PredictionServiceClient;
  private firestore: admin.firestore.Firestore;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-filesearch';
  private location = process.env.GCP_LOCATION || 'us-central1';
  private indexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID;
  private deployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID;
  private publicEndpointDomain = process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN;
  private geminiApiKey = process.env.GEMINI_API_KEY;

  // Active Live API sessions
  private sessions = new Map<string, {
    ws: WebSocket;
    tenantId: string;
    documentId: string;
    createdAt: number;
  }>();

  constructor(private readonly metricsService: MetricsService) {
    this.predictionClient = new aiplatform.v1.PredictionServiceClient({
      apiEndpoint: `${this.location}-aiplatform.googleapis.com`,
    });

    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          projectId: this.project,
        });
        console.log('VoiceLiveService: Firebase Admin initialized with project:', this.project);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn('VoiceLiveService: Firebase Admin initialization warning:', msg);
      }
    }
    this.firestore = admin.firestore();
  }

  /**
   * Retrieve context chunks for a tenant/document (shared logic with RAG)
   */
  async retrieveContext(tenantId: string, documentId: string, query: string): Promise<string> {
    const hasVectorSearch = this.indexEndpointId && this.deployedIndexId && this.publicEndpointDomain;
    if (!hasVectorSearch) return '';

    let filter: { namespace: string; allowList: string[] } | null = null;
    if (documentId === 'all') {
      const docsSnapshot = await this.firestore.collection('documents')
        .where('tenantId', '==', tenantId)
        .select('id')
        .get();
      const docIds = docsSnapshot.docs.map(d => d.id);
      if (docIds.length > 0) {
        filter = { namespace: 'documentId', allowList: docIds };
      }
    } else {
      filter = { namespace: 'documentId', allowList: [documentId] };
    }

    // Embed query
    let embedding: number[] = [];
    try {
      const endpoint = `projects/${this.project}/locations/${this.location}/publishers/google/models/text-embedding-004`;
      const instanceValue = {
        structValue: {
          fields: {
            content: { stringValue: query }
          }
        }
      };
      
      const [response] = await this.predictionClient.predict({
        endpoint,
        instances: [instanceValue as any],
      });

      const predictions = response.predictions;
      if (predictions && predictions.length > 0) {
        const embeddingValue = predictions[0].structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values;
        if (embeddingValue) {
          embedding = embeddingValue.map((v) => {
            if ('numberValue' in v && typeof v.numberValue === 'number') {
              return v.numberValue;
            }
            return 0;
          });
        }
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('VoiceLiveService: Embedding failed:', msg);
      return '';
    }

    if (embedding.length === 0) return '';

    // Vector search
    try {
      const neighbors = await this.findNeighbors(embedding, filter);
      const chunkRefs = neighbors.map((n: any) => {
        if (!n.datapoint?.datapointId) return null;
        const parts = n.datapoint.datapointId.split('_');
        const chunkIndex = parts[parts.length - 1];
        const docIdFromVector = parts.slice(0, -1).join('_');
        return this.firestore.collection('documents').doc(docIdFromVector).collection('chunks').doc(chunkIndex);
      }).filter(Boolean) as admin.firestore.DocumentReference[];

      if (chunkRefs.length > 0) {
        const chunkSnaps = await this.firestore.getAll(...chunkRefs);
        const texts = chunkSnaps.map(snap => snap.data()?.text || '').filter(Boolean);
        return texts.join('\n\n');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('VoiceLiveService: Vector search failed:', message);
    }

    return '';
  }

  private async findNeighbors(
    embedding: number[],
    filter: { namespace: string; allowList: string[] } | null
  ): Promise<Array<{ datapoint?: { datapointId?: string } }>> {
    const url = `https://${this.publicEndpointDomain}/v1/projects/${this.project}/locations/${this.location}/indexEndpoints/${this.indexEndpointId}:findNeighbors`;
    
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth();
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    
    const body = {
      deployedIndexId: this.deployedIndexId,
      queries: [{
        datapoint: {
          featureVector: embedding,
          restricts: filter ? [filter] : []
        },
        neighborCount: 3 // Fewer chunks for voice (conciseness)
      }],
      returnFullDatapoint: false
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Vector Search failed: ${response.status}`);
    }

    const result = await response.json();
    return result.nearestNeighbors?.[0]?.neighbors || [];
  }

  /**
   * Build system prompt for Gemini Live API
   */
  private buildVoiceSystemPrompt(): string {
    return `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

CORE IDENTITY:
You have two superpowers:
1. Finding the right information instantly from project data
2. Turning that information into clear, confident next steps

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented  
- Friendly but professional
- Never rushed, never panicked
- Supportive without being fluffy
- Empathetic to field constraints (long days, shifting priorities)

AVOID:
- Corporate buzzwords ("synergy," "leverage," "optimize," "digital transformation")
- Legalese or overly technical jargon
- Overconfidence without evidence
- Guessing or hallucinating data
- Markdown, bullet points, or formatting (this is spoken audio)
- Citations like [1] or [2]

RESPONSE PATTERN:
Data → Meaning → Action
1. State the facts from the data
2. Explain what it means
3. Give a clear next step

COMMON PHRASES TO USE:
- "Here's what the data shows."
- "Here's the current status."
- "Based on the documents you shared…"
- "This keeps your project on track."
- "This protects your margin."
- "Next step:"
- "You're good to go."
- "Let's keep things moving."

STRUCTURAL HABITS:
- Confirm the user's request
- Pull relevant facts from the context (use search_project_documents function when needed)
- Present clear, neutral findings
- Give one actionable next step
- End with reassurance when appropriate

SUCCESS CRITERIA:
- Provide clarity within 5 seconds
- Turn scattered information into a coherent picture
- Support confident decision-making
- Respect the user's limited time
- Leave the user feeling supported

Remember: Every response should produce clarity and confidence — not more tasks.
Tagline encoded into tone: "Get Clarity. Go Build."

When you need information from the user's uploaded documents, call the search_project_documents function with their question.`;
  }

  /**
   * Create a Gemini Live API WebSocket session with RAG function calling
   */
  async createLiveSession(
    sessionId: string,
    tenantId: string,
    documentId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.geminiApiKey) {
      return { success: false, error: 'GEMINI_API_KEY not configured' };
    }

    try {
      // Gemini Live API WebSocket endpoint
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;
      
      const ws = new WebSocket(wsUrl);

      // Build RAG tool definition
      const ragTool = {
        functionDeclarations: [{
          name: 'search_project_documents',
          description: 'Search through uploaded project documents to find relevant information. Use this when the user asks about project details, specifications, RFIs, or any information that might be in their documents.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query to find relevant document chunks'
              }
            },
            required: ['query']
          }
        }]
      };

      // Initial setup message
      // Use GEMINI_VOICE_MODEL env var or default to gemini-2.0-flash-live-001
      const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash-live-001';
      console.log(`[VoiceLive] Using voice model: ${voiceModel}`);
      
      const setupMessage = {
        setup: {
          model: `models/${voiceModel}`,
          generation_config: {
            response_modalities: ['AUDIO'],
            speech_config: {
              voice_config: {
                prebuilt_voice_config: {
                  voice_name: 'Puck'
                }
              }
            }
          },
          system_instruction: {
            parts: [{ text: this.buildVoiceSystemPrompt() }]
          },
          tools: [ragTool],
        }
      };

      ws.on('open', () => {
        console.log(`[VoiceLive] Session ${sessionId} connected to Gemini Live API`);
        console.log(`[VoiceLive] Sending setup message:`, JSON.stringify(setupMessage).substring(0, 200));
        ws.send(JSON.stringify(setupMessage));
      });

      ws.on('message', async (data: WebSocket.Data) => {
        console.log(`[VoiceLive] Received message:`, data.toString().substring(0, 500));
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const message = JSON.parse(data.toString()) as any;
          
          // Handle function calls (RAG retrieval)
          if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.functionCall) {
                const functionCall = part.functionCall;
                
                if (functionCall.name === 'search_project_documents') {
                  const query = functionCall.args?.query || '';
                  console.log(`[VoiceLive] Function call: search_project_documents("${query}")`);
                  
                  // Retrieve context using existing RAG system
                  const context = await this.retrieveContext(tenantId, documentId, query);
                  
                  // Send function response back to Gemini (tool_response format)
                  const functionResponse = {
                    tool_response: {
                      function_responses: [{
                        name: functionCall.name,
                        id: functionCall.id || functionCall.name,
                        response: {
                          result: context || 'No relevant information found in documents.'
                        }
                      }]
                    }
                  };
                  
                  console.log(`[VoiceLive] Sending function response:`, JSON.stringify(functionResponse).substring(0, 200));
                  ws.send(JSON.stringify(functionResponse));
                  
                  // Track metrics
                  this.metricsService.track({
                    type: 'voice_query',
                    tenantId,
                    documentId: documentId === 'all' ? undefined : documentId,
                    metadata: {
                      hasContext: context.length > 0,
                    }
                  }).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : 'Unknown error';
                    console.warn('Voice metrics failed:', msg);
                  });
                }
              }
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[VoiceLive] Error processing message:`, message);
        }
      });

      ws.on('error', (error: Error) => {
        console.error(`[VoiceLive] WebSocket error for session ${sessionId}:`, error);
      });

      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[VoiceLive] Gemini WebSocket closed for ${sessionId}`, {
          code,
          reason: reason.toString(),
        });
        this.sessions.delete(sessionId);
      });

      // Store session
      this.sessions.set(sessionId, {
        ws,
        tenantId,
        documentId,
        createdAt: Date.now()
      });

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[VoiceLive] Failed to create session ${sessionId}:`, error);
      return { success: false, error: message };
    }
  }

  /**
   * Send audio data to Gemini Live API
   * Expects 16kHz 16-bit mono PCM from browser
   */
  async sendAudio(sessionId: string, audioData: Buffer): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: 'Session not found or not connected' };
    }

    try {
      // Convert audio to base64 for transmission
      const audioBase64 = audioData.toString('base64');
      
      // Gemini Live API expects realtimeInput for audio streaming
      const message = {
        realtimeInput: {
          mediaChunks: [{
            mimeType: 'audio/pcm;rate=16000',
            data: audioBase64
          }]
        }
      };

      session.ws.send(JSON.stringify(message));
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Close a Live API session
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.ws.close();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Get session WebSocket for direct message handling
   */
  getSession(sessionId: string): WebSocket | null {
    return this.sessions.get(sessionId)?.ws || null;
  }
}

