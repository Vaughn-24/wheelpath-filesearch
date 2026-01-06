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
   * Get document summaries/content for pre-loading into voice session
   * Uses Gemini File API to extract text from the document
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
      
      console.log(`[VoiceLive] Found ${docIds.length} documents for tenant ${tenantId}`);
      
      if (docIds.length === 0) {
        return 'No documents have been uploaded yet.';
      }

      let context = '';
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const { GoogleAIFileManager } = require('@google/generative-ai/server');
      const genAI = new GoogleGenerativeAI(this.geminiApiKey);
      const fileManager = new GoogleAIFileManager(this.geminiApiKey);
      const extractModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
      
      for (const docId of docIds) {
        const docSnap = await this.firestore.collection('documents').doc(docId).get();
        const docData = docSnap.data();
        const title = docData?.title || 'Untitled Document';
        
        console.log(`[VoiceLive] Processing document: ${title}, hasGeminiUri: ${!!docData?.geminiFileUri}`);
        
        if (docData?.geminiFileUri) {
          try {
            // Check if file is still valid
            const fileName = docData.geminiFileUri.split('/').pop();
            if (fileName) {
              try {
                await fileManager.getFile(fileName);
              } catch {
                console.log(`[VoiceLive] File expired for ${title}, skipping`);
                context += `\n\n=== DOCUMENT: ${title} ===\n[Document available but needs reprocessing]\n`;
                continue;
              }
            }
            
            // Extract text content using Gemini
            console.log(`[VoiceLive] Extracting text from ${title}...`);
            const result = await extractModel.generateContent([
              {
                fileData: {
                  fileUri: docData.geminiFileUri,
                  mimeType: docData.mimeType || 'application/pdf',
                }
              },
              { text: 'Extract ALL the text content from this document. Include all details, numbers, dates, and specifications. Format as plain text.' }
            ]);
            
            const extractedText = result.response.text();
            console.log(`[VoiceLive] Extracted ${extractedText.length} chars from ${title}`);
            
            if (extractedText && extractedText.length > 0) {
              context += `\n\n=== DOCUMENT: ${title} ===\n${extractedText}\n`;
            }
          } catch (error: any) {
            console.error(`[VoiceLive] Failed to extract from ${title}:`, error.message);
            context += `\n\n=== DOCUMENT: ${title} ===\n[Error loading document content]\n`;
          }
        } else {
          // Try to get from chunks as fallback
          const chunksSnap = await this.firestore
            .collection('documents').doc(docId)
            .collection('chunks')
            .limit(10)
            .get();
          
          if (!chunksSnap.empty) {
            context += `\n\n=== DOCUMENT: ${title} ===\n`;
            chunksSnap.docs.forEach((chunk) => {
              const data = chunk.data();
              context += `${data.text}\n`;
            });
          } else {
            context += `\n\n=== DOCUMENT: ${title} ===\n[Document uploaded but content not yet processed]\n`;
          }
        }
      }
      
      // Limit context to prevent token overflow
      if (context.length > 20000) {
        context = context.substring(0, 20000) + '\n\n[Content truncated for voice session]';
      }
      
      console.log(`[VoiceLive] Total context: ${context.length} chars`);
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
    // Check if we have real document content
    const hasDocuments = documentContext.includes('=== DOCUMENT:') || 
                         documentContext.length > 100;
    
    if (!hasDocuments) {
      return `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

The user hasn't uploaded any documents yet. When they ask questions:
- Let them know they can upload documents for project-specific answers
- Offer to help with general construction questions
- Keep responses brief and friendly

AVOID: Markdown, citations, long responses. This is spoken audio.

Remember: Get Clarity. Go Build.`;
    }

    return `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

CRITICAL: The user's documents are ALREADY LOADED below. You have FULL ACCESS to them RIGHT NOW. Do NOT say you are "processing" or "loading" - the documents are ready.

=== USER'S PROJECT DOCUMENTS (READY TO USE) ===
${documentContext}
=== END OF DOCUMENTS ===

INSTRUCTIONS:
1. The documents above contain the user's actual project data
2. When the user asks a question, IMMEDIATELY look through the documents above
3. Give a direct answer based on what you find
4. If the info isn't in the documents, say "I didn't find that in your uploaded documents"

TONE: Calm, professional, brief. This is voice - keep answers short.

NEVER SAY:
- "Let me process..." - documents are already loaded
- "I'm checking..." - just answer directly
- "I don't have access..." - you DO have access above

ALWAYS:
- Reference specific document names and page numbers when relevant
- Keep responses under 30 seconds when spoken
- End with a clear next step or "You're good to go"

Get Clarity. Go Build.`;
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

