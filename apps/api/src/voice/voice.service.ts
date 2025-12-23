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

  constructor(private readonly metricsService: MetricsService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      // Use Gemini 3 Pro for high-quality voice responses
      // Can be overridden with GEMINI_VOICE_MODEL env var
      const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-3-pro-preview';
      this.model = this.genAI.getGenerativeModel({ model: voiceModel });
      console.log(`VoiceService: Initialized Gemini 3 (${voiceModel})`);
    } else {
      console.warn('VoiceService: GEMINI_API_KEY not set');
    }
    
    this.predictionClient = new aiplatform.v1.PredictionServiceClient({
      apiEndpoint: `${this.location}-aiplatform.googleapis.com`
    });

    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();
  }

  /**
   * Retrieve context chunks for a tenant/document (shared logic with RAG)
   */
  private async retrieveContext(tenantId: string, documentId: string, query: string): Promise<string> {
    const hasVectorSearch = this.indexEndpointId && this.deployedIndexId && this.publicEndpointDomain;
    if (!hasVectorSearch) return '';

    let filter: any = null;
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
          embedding = embeddingValue.map((v: any) => v.numberValue || 0);
        }
      }
    } catch (error: any) {
      console.error('VoiceService: Embedding failed:', error.message);
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
    } catch (error: any) {
      console.error('VoiceService: Vector search failed:', error.message);
    }

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
    if (!this.model) {
      yield "Voice service is being configured.";
      return;
    }

    const context = await this.retrieveContext(tenantId, documentId, transcribedText);
    const systemPrompt = this.buildVoiceSystemPrompt(context);

    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];
    
    const chat = this.model.startChat({ history: chatHistory });
    const result = await chat.sendMessageStream(transcribedText);

    for await (const chunk of result.stream) {
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        yield text;
      }
    }
  }
}

