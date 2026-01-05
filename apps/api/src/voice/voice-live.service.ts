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

IMPORTANT: The user has uploaded project documents (PDFs, specs, RFIs, drawings, etc.) to this system.
You MUST use the search_project_documents function to find information from their documents before answering any questions about their project.
ALWAYS call search_project_documents first when the user asks about:
- Specifications, dimensions, or measurements
- Deadlines, schedules, or dates
- Materials, quantities, or costs
- RFIs, submittals, or change orders
- Any project-specific information

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented  
- Friendly but professional
- Never rushed, never panicked

RESPONSE PATTERN:
1. Call search_project_documents with the user's question
2. Use the returned context to answer
3. Give a clear next step

AVOID:
- Guessing or making up information
- Answering without checking documents first
- Markdown or formatting (this is spoken audio)
- Citations like [1] or [2]

COMMON PHRASES:
- "Let me check your documents..."
- "Based on your project documents..."
- "Here's what I found..."
- "You're good to go."

Remember: Get Clarity. Go Build.`;
  }

  /**
   * Get document summaries/content for pre-loading into voice session
   */
  private async getDocumentSummaries(tenantId: string, documentId: string): Promise<string> {
    try {
      let docIds: string[] = [];
      
      if (documentId && documentId !== 'all') {
        docIds = [documentId];
      } else {
        // Get all ready documents for this tenant
        const docsSnap = await this.firestore.collection('documents')
          .where('tenantId', '==', tenantId)
          .where('status', '==', 'ready')
          .limit(5)
          .get();
        docsSnap.forEach(d => docIds.push(d.id));
      }
      
      console.log(`[VoiceLive] Found ${docIds.length} documents for context`);
      
      if (docIds.length === 0) {
        return 'No documents have been uploaded yet.';
      }

      let context = '';
      
      for (const docId of docIds) {
        const docSnap = await this.firestore.collection('documents').doc(docId).get();
        const docData = docSnap.data();
        const title = docData?.title || 'Untitled Document';
        
        // Get chunks for this document
        const chunksSnap = await this.firestore
          .collection('documents').doc(docId)
          .collection('chunks')
          .orderBy('chunkIndex')
          .limit(10) // Get up to 10 chunks per document
          .get();
        
        if (!chunksSnap.empty) {
          context += `\n\n=== DOCUMENT: ${title} ===\n`;
          chunksSnap.docs.forEach((chunk) => {
            const data = chunk.data();
            const pageNum = data.pageNumber || 1;
            context += `[Page ${pageNum}]: ${data.text}\n`;
          });
        }
      }
      
      // Limit context to prevent token overflow
      if (context.length > 15000) {
        context = context.substring(0, 15000) + '\n\n[Content truncated for voice session]';
      }
      
      return context || 'Documents are being processed.';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[VoiceLive] Failed to get document summaries:', message);
      return 'Unable to load documents at this time.';
    }
  }

  /**
   * Build system prompt with pre-loaded document context
   */
  private buildVoiceSystemPromptWithContext(documentContext: string): string {
    return `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

The user's project documents have been pre-loaded below. Use this information to answer their questions accurately.

=== USER'S PROJECT DOCUMENTS ===
${documentContext}
=== END OF DOCUMENTS ===

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented  
- Friendly but professional
- Never rushed, never panicked

RESPONSE PATTERN:
1. Listen to the user's question
2. Find the relevant information from the documents above
3. Give a clear, concise answer
4. Suggest a next step when appropriate

AVOID:
- Guessing or making up information
- Saying you can't access documents (you have them above!)
- Markdown or formatting (this is spoken audio)
- Citations like [1] or [2]
- Long-winded responses

IMPORTANT RULES:
- If the user asks about something in their documents, reference the specific information
- If the information isn't in the documents, say "I didn't find that in your uploaded documents"
- Keep responses brief and actionable - this is voice, not text
- Use page numbers when relevant: "On page 3, it shows..."

COMMON PHRASES:
- "According to your documents..."
- "On page [X] of [document name]..."
- "Here's what your project shows..."
- "You're good to go."

Remember: Get Clarity. Go Build.`;
  }

  /**
   * Create a Gemini Live API WebSocket session with pre-loaded document context
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
      // Pre-fetch document context for the user's documents
      console.log(`[VoiceLive] Pre-fetching document context for tenant ${tenantId}`);
      const documentContext = await this.getDocumentSummaries(tenantId, documentId);
      console.log(`[VoiceLive] Got document context: ${documentContext.length} chars`);

      // Gemini Live API WebSocket endpoint
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.geminiApiKey}`;
      
      const ws = new WebSocket(wsUrl);

      // Initial setup message - include document context directly in system prompt
      const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash-live-001';
      console.log(`[VoiceLive] Using voice model: ${voiceModel}`);
      
      // Build system prompt with pre-loaded document context
      const systemPrompt = this.buildVoiceSystemPromptWithContext(documentContext);
      
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
            parts: [{ text: systemPrompt }]
          },
        }
      };

      ws.on('open', () => {
        console.log(`[VoiceLive] Session ${sessionId} connected to Gemini Live API`);
        console.log(`[VoiceLive] Sending setup message:`, JSON.stringify(setupMessage).substring(0, 200));
        ws.send(JSON.stringify(setupMessage));
      });

      ws.on('message', async (data: WebSocket.Data) => {
        const rawMsg = data.toString();
        // Only log non-audio messages in detail
        if (!rawMsg.includes('"inlineData"') || rawMsg.length < 500) {
          console.log(`[VoiceLive] Message: ${rawMsg.substring(0, 300)}`);
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const message = JSON.parse(rawMsg) as any;
          
          // Log setup completion
          if (message.setupComplete) {
            console.log(`[VoiceLive] Setup complete for session ${sessionId}`);
          }
          
          // Log turn completion
          if (message.serverContent?.turnComplete) {
            console.log(`[VoiceLive] Turn complete for session ${sessionId}`);
          }
          
          // Track voice usage metrics
          if (message.serverContent?.modelTurn?.parts) {
            this.metricsService.track({
              type: 'voice_query',
              tenantId,
              documentId: documentId === 'all' ? undefined : documentId,
              metadata: { hasContext: documentContext.length > 100 }
            }).catch(() => {}); // Ignore metric errors
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

