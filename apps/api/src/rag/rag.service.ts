import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as aiplatform from '@google-cloud/aiplatform';
import * as admin from 'firebase-admin';
import { Message } from '@wheelpath/schemas';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RagService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any;
  private predictionClient: aiplatform.v1.PredictionServiceClient;
  private firestore: admin.firestore.Firestore;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-ai-dev';
  private location = process.env.GCP_LOCATION || 'us-central1';
  private indexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID;
  private deployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID;
  private publicEndpointDomain = process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN;

  constructor(private readonly metricsService: MetricsService) {
    // Use Google AI API with GEMINI_API_KEY
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      // Use gemini-2.0-flash as specified in config
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });
      console.log('Initialized Gemini with Google AI API (gemini-2.0-flash-exp)');
    } else {
      console.warn('GEMINI_API_KEY not set - chat will use fallback responses');
    }
    
    // Use PredictionServiceClient for embeddings (still via Vertex AI)
    this.predictionClient = new aiplatform.v1.PredictionServiceClient({
        apiEndpoint: `${this.location}-aiplatform.googleapis.com`
    });

    // Initialize Firebase if not already done
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();
  }

  private async findNeighborsViaPublicEndpoint(embedding: number[], filter: any): Promise<any[]> {
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
        neighborCount: 5
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
      const errorText = await response.text();
      console.error('Vector Search error:', response.status, errorText);
      throw new Error(`Vector Search failed: ${response.status}`);
    }

    const result = await response.json();
    return result.nearestNeighbors?.[0]?.neighbors || [];
  }

  async chatStream(tenantId: string, documentId: string, query: string, history: Message[]) {
    let chunksData: any[] = [];
    let filter: any = null;

    const hasVectorSearch = this.indexEndpointId && this.deployedIndexId && this.publicEndpointDomain;
    
    if (hasVectorSearch) {
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

        // Embed Query using text-embedding-004
        const EXPECTED_EMBEDDING_DIM = 768;
        let embedding: number[];
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
            if (!predictions || predictions.length === 0) throw new Error('No predictions returned');
            
            const embeddingValue = predictions[0].structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values;
            if (!embeddingValue) throw new Error('No embedding values found in response');
            
            embedding = embeddingValue.map((v: any) => v.numberValue || 0);
            
            if (embedding && embedding.length !== EXPECTED_EMBEDDING_DIM) {
                console.warn(`Query embedding: Expected ${EXPECTED_EMBEDDING_DIM} dimensions, got ${embedding.length}`);
            }
        } catch (error: any) {
            console.error('Embedding failed:', error);
            // Continue without vector search
            embedding = [];
        }
        
        if (embedding && embedding.length > 0) {
            try {
                const neighbors = await this.findNeighborsViaPublicEndpoint(embedding, filter);
                
                const chunkRefs = neighbors.map((n: any) => {
                    if (!n.datapoint?.datapointId) return null;
                    const parts = n.datapoint.datapointId.split('_');
                    const chunkIndex = parts[parts.length - 1];
                    const docIdFromVector = parts.slice(0, -1).join('_');
                    return this.firestore.collection('documents').doc(docIdFromVector).collection('chunks').doc(chunkIndex);
                }).filter(Boolean) as admin.firestore.DocumentReference[];

                if (chunkRefs.length > 0) {
                    const chunkSnaps = await this.firestore.getAll(...chunkRefs);
                    chunksData = chunkSnaps.map((snap, index) => {
                        const data = snap.data();
                        const docId = snap.ref.parent.parent?.id;
                        return {
                            id: snap.id,
                            index: index + 1,
                            text: data?.text || '',
                            pageNumber: data?.pageNumber || 1,
                            documentId: docId
                        };
                    });
                }
            } catch (vectorError: any) {
                console.error('Vector search failed:', vectorError.message);
            }
        }
    }
      
    const context = chunksData.length > 0 
        ? chunksData.map(c => `[${c.index}] (Page ${c.pageNumber}): ${c.text}`).join('\n\n')
        : '';
    
    const systemPrompt = chunksData.length > 0 
        ? `You are a helpful assistant. Use the following CONTEXT to answer the user's question.
Always cite your sources using the format [1], [2], etc. corresponding to the context chunks.
Do not invent citations. If the answer is not in the context, say you don't know.

CONTEXT:
${context}`
        : `You are WheelPath AI, a helpful assistant for construction project management. 
The user hasn't uploaded any documents yet. Help with general questions and encourage them to upload documents for grounded answers.
Be helpful, professional, and concise.`;

    // Use Google AI API for chat
    if (!this.model) {
        // Fallback response if no API key
        const fallbackStream = (async function*() {
            yield { candidates: [{ content: { parts: [{ text: "I'm WheelPath AI. The AI service is currently being configured. Please try again shortly or upload documents to get started." }] } }] };
        })();
        return { stream: fallbackStream, citations: chunksData };
    }

    // Prepend system prompt to history as a model message
    const chatHistory = [
      { role: 'user', parts: [{ text: 'System context: ' + systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] },
      ...history.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }))
    ];
    
    const chat = this.model.startChat({ history: chatHistory });

    const result = await chat.sendMessageStream(query);

    // Track usage metrics (non-blocking)
    this.metricsService.track({
      type: 'chat_query',
      tenantId,
      documentId: documentId === 'all' ? undefined : documentId,
      metadata: {
        embeddingChars: query.length,
        vectorNeighbors: chunksData.length,
        // Note: Token counts would require response inspection
        // which we can't do with streaming without buffering
      }
    }).catch(err => console.warn('Metrics tracking failed:', err.message));

    return {
        stream: result.stream,
        citations: chunksData
    };
  }
}
