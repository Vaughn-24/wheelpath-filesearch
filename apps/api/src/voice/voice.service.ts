import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as aiplatform from '@google-cloud/aiplatform';
import * as admin from 'firebase-admin';
import { MetricsService } from '../metrics/metrics.service';

/**
 * VoiceService - Isolated service for voice agent functionality
 * 
 * This service is SEPARATE from RagService to ensure:
 * 1. No interference with existing chat functionality
 * 2. Voice-optimized prompt construction (concise, no citations)
 * 3. Independent scaling and error handling
 */
@Injectable()
export class VoiceService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any;
  private predictionClient: aiplatform.v1.PredictionServiceClient;
  private firestore: admin.firestore.Firestore;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-filesearch';
  private location = process.env.GCP_LOCATION || 'us-central1';
  private indexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID;
  private deployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID;
  private publicEndpointDomain = process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN;
  
  // Request timeout protection (10 seconds for vector search, 30 seconds for LLM)
  private readonly VECTOR_SEARCH_TIMEOUT_MS = 10000;
  private readonly LLM_REQUEST_TIMEOUT_MS = 30000;

  constructor(private readonly metricsService: MetricsService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      // Use Gemini 2.0 Flash for high-quality voice responses (fast & current)
      // Can be overridden with GEMINI_VOICE_MODEL env var
      const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash';
      this.model = this.genAI.getGenerativeModel({ 
        model: voiceModel,
        generationConfig: {
          maxOutputTokens: 500, // Cost guardrail: voice responses should be concise
        },
      });
      console.log(`VoiceService: Initialized Gemini (${voiceModel}) with maxOutputTokens=500`);
    } else {
      console.warn('VoiceService: GEMINI_API_KEY not set');
    }
    
    this.predictionClient = new aiplatform.v1.PredictionServiceClient({
      apiEndpoint: `${this.location}-aiplatform.googleapis.com`
    });

    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          projectId: this.project,
        });
        console.log('VoiceService: Firebase Admin initialized with project:', this.project);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn('VoiceService: Firebase Admin initialization warning:', msg);
      }
    }
    this.firestore = admin.firestore();
  }

  /**
   * Retrieve context chunks for a tenant/document (shared logic with RAG)
   */
  private async retrieveContext(tenantId: string, documentId: string, query: string): Promise<string> {
    // [Checkpoint 12] Firestore query - Document retrieval for voice
    const retrieveStartTime = Date.now();
    console.log('[VoiceService] retrieveContext called', {
      tenantId,
      documentId,
      queryLength: query.length,
    });

    const hasVectorSearch = this.indexEndpointId && this.deployedIndexId && this.publicEndpointDomain;
    if (!hasVectorSearch) {
      console.log('[VoiceService] Vector search not available');
      return '';
    }

    let filter: any = null;
    if (documentId === 'all') {
      const firestoreStartTime = Date.now();
      console.log('[VoiceService] Querying Firestore for all documents', { tenantId });
      const docsSnapshot = await this.firestore.collection('documents')
        .where('tenantId', '==', tenantId)
        .select('id')
        .get();
      const docIds = docsSnapshot.docs.map(d => d.id);
      console.log('[VoiceService] Firestore query completed', {
        documentCount: docIds.length,
        duration: Date.now() - firestoreStartTime,
      });
      if (docIds.length > 0) {
        filter = { namespace: 'documentId', allowList: docIds };
      }
    } else {
      console.log('[VoiceService] Using single document filter', { documentId });
      filter = { namespace: 'documentId', allowList: [documentId] };
    }

    // Embed query
    let embedding: number[] = [];
    try {
      // [Checkpoint 12.1] Embedding generation for voice
      const embeddingStartTime = Date.now();
      const endpoint = `projects/${this.project}/locations/${this.location}/publishers/google/models/text-embedding-004`;
      console.log('[VoiceService] Generating query embedding', {
        endpoint,
        queryLength: query.length,
      });

      const instanceValue = {
        structValue: {
          fields: {
            content: { stringValue: query }
          }
        }
      };
      
      // Add timeout protection to embedding generation
      const predictPromise = this.predictionClient.predict({
        endpoint,
        instances: [instanceValue as any],
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Embedding timeout')), this.VECTOR_SEARCH_TIMEOUT_MS)
      );
      const [response] = await Promise.race([predictPromise, timeoutPromise]) as any;

      const predictions = response.predictions;
      if (predictions && predictions.length > 0) {
        const embeddingValue = predictions[0].structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values;
        if (embeddingValue) {
          embedding = embeddingValue.map((v: any) => v.numberValue || 0);
        }
      }

      console.log('[VoiceService] Embedding generated', {
        dimensions: embedding.length,
        duration: Date.now() - embeddingStartTime,
      });
    } catch (error: any) {
      console.error('[VoiceService] Embedding failed', {
        error: error.message || String(error),
        errorCode: error.code || 'unknown',
        stack: error.stack,
      });
      return '';
    }

    if (embedding.length === 0) {
      console.log('[VoiceService] No embedding generated, returning empty context');
      return '';
    }

    // Vector search
    try {
      // [Checkpoint 12.2] Vector search for voice
      const vectorSearchStartTime = Date.now();
      console.log('[VoiceService] Starting vector search', {
        embeddingDimensions: embedding.length,
        filterNamespace: filter?.namespace,
        filterAllowListLength: filter?.allowList?.length || 0,
      });

      const neighbors = await this.findNeighbors(embedding, filter);
      console.log('[VoiceService] Vector search completed', {
        neighborCount: neighbors.length,
        duration: Date.now() - vectorSearchStartTime,
      });

      const chunkRefs = neighbors.map((n: any) => {
        if (!n.datapoint?.datapointId) return null;
        const parts = n.datapoint.datapointId.split('_');
        const chunkIndex = parts[parts.length - 1];
        const docIdFromVector = parts.slice(0, -1).join('_');
        return this.firestore.collection('documents').doc(docIdFromVector).collection('chunks').doc(chunkIndex);
      }).filter(Boolean) as admin.firestore.DocumentReference[];

      if (chunkRefs.length > 0) {
        // [Checkpoint 12.3] Firestore chunk retrieval for voice
        const chunkRetrievalStartTime = Date.now();
        console.log('[VoiceService] Retrieving chunks from Firestore', {
          chunkCount: chunkRefs.length,
        });

        const chunkSnaps = await this.firestore.getAll(...chunkRefs);
        const texts = chunkSnaps.map(snap => snap.data()?.text || '').filter(Boolean);
        const context = texts.join('\n\n');

        console.log('[VoiceService] Chunks retrieved', {
          chunkCount: texts.length,
          contextLength: context.length,
          duration: Date.now() - chunkRetrievalStartTime,
          totalDuration: Date.now() - retrieveStartTime,
        });

        return context;
      }
    } catch (error: any) {
      console.error('[VoiceService] Vector search failed', {
        error: error.message || String(error),
        errorCode: error.code || 'unknown',
        stack: error.stack,
      });
    }

    console.log('[VoiceService] retrieveContext completed with empty context', {
      totalDuration: Date.now() - retrieveStartTime,
    });
    return '';
  }

  private async findNeighbors(embedding: number[], filter: any): Promise<any[]> {
    const url = `https://${this.publicEndpointDomain}/v1/projects/${this.project}/locations/${this.location}/indexEndpoints/${this.indexEndpointId}:findNeighbors`;
    
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

    // Add timeout protection to vector search fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.VECTOR_SEARCH_TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Vector Search failed: ${response.status}`);
      }

      const result = await response.json();
      return result.nearestNeighbors?.[0]?.neighbors || [];
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        console.error('[VoiceService] Vector Search timed out or failed:', error.message);
        return []; // Fallback to empty context instead of hanging
      }
      throw error;
    }
  }

  /**
   * WheelPath Voice Profile - System Prompt
   * 
   * Core Identity: The calm, experienced field mentor who understands 
   * construction documents, project realities, and trade contractor workloads.
   * 
   * Tagline: "Get Clarity. Go Build."
   */
  private buildVoiceSystemPrompt(context: string): string {
    const voiceProfile = `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

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
- Pull relevant facts from the context
- Present clear, neutral findings
- Give one actionable next step
- End with reassurance when appropriate

SUCCESS CRITERIA:
- Provide clarity within 5 seconds of reading
- Turn scattered information into a coherent picture
- Support confident decision-making
- Respect the user's limited time
- Leave the user feeling supported

Remember: Every response should produce clarity and confidence — not more tasks.
Tagline encoded into tone: "Get Clarity. Go Build."`;

    if (context) {
      return `${voiceProfile}

PROJECT CONTEXT (from user's documents):
${context}

Answer the user's question using ONLY the context above. If the answer isn't in the context, say "I don't have that information in your documents yet. Want me to help you find it another way?"`;
    }
    
    return `${voiceProfile}

NOTE: The user hasn't uploaded project documents yet. 
- Help with general construction questions
- Encourage them to upload documents for project-specific answers
- Say something like: "Once you upload your project documents, I can give you specific answers grounded in your data."`;
  }

  /**
   * Process a voice query and return a text response
   * This is used for Speech-to-Text -> LLM -> Text-to-Speech flow
   */
  async processVoiceQuery(
    tenantId: string, 
    documentId: string, 
    transcribedText: string
  ): Promise<string> {
    if (!this.model) {
      return "Voice service is being configured. Please try again shortly.";
    }

    // Retrieve context (same RAG logic, isolated execution)
    const context = await this.retrieveContext(tenantId, documentId, transcribedText);
    
    // Build voice-optimized prompt
    const systemPrompt = this.buildVoiceSystemPrompt(context);

    // Single-turn generation (no history for voice - reduces latency)
    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];
    
    const chat = this.model.startChat({ history: chatHistory });
    const result = await chat.sendMessage(transcribedText);
    const response = result.response;
    const text = response.text();

    // Track metrics (non-blocking)
    this.metricsService.track({
      type: 'voice_query',
      tenantId,
      documentId: documentId === 'all' ? undefined : documentId,
      metadata: {
        queryLength: transcribedText.length,
        responseLength: text.length,
        hasContext: context.length > 0
      }
    }).catch(err => console.warn('Voice metrics failed:', err.message));

    return text;
  }

  /**
   * Stream voice response for lower perceived latency
   */
  async *streamVoiceResponse(
    tenantId: string,
    documentId: string,
    transcribedText: string
  ): AsyncGenerator<string> {
    // [Checkpoint 12] Voice service method invoked
    const startTime = Date.now();
    console.log('[VoiceService] streamVoiceResponse called', {
      tenantId,
      documentId,
      transcribedTextLength: transcribedText.length,
    });

    if (!this.model) {
      console.warn('[VoiceService] Model not initialized');
      yield "Voice service is being configured.";
      return;
    }

    // [Checkpoint 12.1] Context retrieval
    const contextStartTime = Date.now();
    console.log('[VoiceService] Retrieving context for voice query');
    const context = await this.retrieveContext(tenantId, documentId, transcribedText);
    console.log('[VoiceService] Context retrieved', {
      contextLength: context.length,
      duration: Date.now() - contextStartTime,
    });

    const systemPrompt = this.buildVoiceSystemPrompt(context);

    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];
    
    // [Checkpoint 13] Gemini API call for voice
    const geminiStartTime = Date.now();
    console.log('[VoiceService] Calling Gemini API for voice response', {
      model: 'gemini-2.0-flash',
      transcribedTextLength: transcribedText.length,
      hasContext: context.length > 0,
      timeoutMs: this.LLM_REQUEST_TIMEOUT_MS,
    });
    
    const chat = this.model.startChat({ history: chatHistory });
    
    // Add timeout protection around stream start
    const streamStartTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM request timeout')), this.LLM_REQUEST_TIMEOUT_MS)
    );
    
    let result: any;
    try {
      result = await Promise.race([chat.sendMessageStream(transcribedText), streamStartTimeoutPromise]);
    } catch (error: any) {
      console.error('[VoiceService] Gemini API stream start failed or timed out:', error.message);
      yield "I'm having trouble processing that right now. Please try again.";
      return;
    }

    console.log('[VoiceService] Gemini API stream started', {
      duration: Date.now() - geminiStartTime,
    });

    // [Checkpoint 14] Response streaming with timeout protection
    let chunkCount = 0;
    const streamStartTime = Date.now();
    
    try {
      for await (const chunk of result.stream) {
        // Check for overall timeout (prevents infinite "thinking")
        if (Date.now() - streamStartTime > this.LLM_REQUEST_TIMEOUT_MS) {
          console.error('[VoiceService] Stream consumption timed out');
          break;
        }
        
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          chunkCount++;
          yield text;
        }
      }
    } catch (error: any) {
      console.error('[VoiceService] Stream consumption error:', error.message);
      // Don't throw - just stop yielding chunks
    }

    console.log('[VoiceService] Voice response stream completed', {
      chunkCount,
      totalDuration: Date.now() - startTime,
    });
  }
}

