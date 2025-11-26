import { Injectable } from '@nestjs/common';
import { VertexAI } from '@google-cloud/vertexai';
import * as aiplatform from '@google-cloud/aiplatform';
import * as admin from 'firebase-admin';
import { Message } from '@wheelpath/schemas';

@Injectable()
export class RagService {
  private vertexAI: VertexAI;
  private model: any;
  private predictionClient: aiplatform.v1.PredictionServiceClient;
  private firestore: admin.firestore.Firestore;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-ai-dev';
  private location = process.env.GCP_LOCATION || 'us-central1';
  private indexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID;
  private deployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID;
  // Public endpoint domain for Vector Search
  private publicEndpointDomain = process.env.VERTEX_PUBLIC_ENDPOINT_DOMAIN;

  constructor() {
    this.vertexAI = new VertexAI({ project: this.project, location: this.location });
    this.model = this.vertexAI.getGenerativeModel({ model: 'gemini-1.5-flash-001' }) as any;
    
    // Use PredictionServiceClient for embeddings
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
    // Use public endpoint REST API for Vector Search
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
        // 0. Prepare Filter
        if (documentId === 'all') {
            const docsSnapshot = await this.firestore.collection('documents')
                .where('tenantId', '==', tenantId)
                .select('id')
                .get();
            const docIds = docsSnapshot.docs.map(d => d.id);
            if (docIds.length > 0) {
                filter = { namespace: 'documentId', allowList: docIds };
            } else {
                // No docs, empty result - but still respond helpfully
                console.log('No documents found for tenant, proceeding without context');
            }
        } else {
            filter = { namespace: 'documentId', allowList: [documentId] };
        }

        // 1. Embed Query using text-embedding-004 (768 dimensions)
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
            
            // Validate dimension
            if (embedding && embedding.length !== EXPECTED_EMBEDDING_DIM) {
                console.warn(`Query embedding: Expected ${EXPECTED_EMBEDDING_DIM} dimensions, got ${embedding.length}`);
            }
        } catch (error: any) {
            console.error('Embedding failed:', error);
            throw new Error('Failed to generate query embedding');
        }
        
        if (!embedding || embedding.length === 0 || !Array.isArray(embedding)) {
            throw new Error('Invalid embedding format returned');
        }

        // 2. Vector Search via Public Endpoint
        try {
            const neighbors = await this.findNeighborsViaPublicEndpoint(embedding, filter);
            
            // 3. Fetch Chunks from Firestore
            // IDs are stored as `${documentId}_${chunkIndex}`
            const chunkRefs = neighbors.map((n: any) => {
                if (!n.datapoint?.datapointId) return null;
                const parts = n.datapoint.datapointId.split('_');
                const chunkIndex = parts[parts.length - 1];
                // Extract documentId correctly (it might contain underscores if we allowed it, but UUIDs don't)
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
            console.error('Vector search failed, continuing without context:', vectorError.message);
            // Continue without vector search results
        }
    } else {
        // Fallback for local dev without Vertex AI set up
        console.warn("Vector search not configured, using fallback retrieval");
        if (documentId && documentId !== 'all') {
            const chunksSnapshot = await this.firestore
                .collection('documents')
                .doc(documentId)
                .collection('chunks')
                .limit(5)
                .get();
                
            chunksData = chunksSnapshot.docs.map((d, index) => ({
                id: d.id,
                index: index + 1,
                text: d.data().text,
                pageNumber: d.data().pageNumber || 1
            }));
        }
    }
      
    const context = chunksData.length > 0 
        ? chunksData.map(c => `[${c.index}] (Page ${c.pageNumber}): ${c.text}`).join('\n\n')
        : 'No documents available. Please upload documents to get grounded answers.';
    
    // 4. Construct Prompt
    const systemPrompt = chunksData.length > 0 
        ? `You are a helpful assistant. Use the following CONTEXT to answer the user's question.
Always cite your sources strictly using the format [1], [2], etc. which corresponds to the context chunks provided.
Do not invent citations. If the answer is not in the context, say you don't know.

CONTEXT:
${context}
`
        : `You are WheelPath AI, a helpful assistant for construction project management. 
The user hasn't uploaded any documents yet. You can still help with general questions, but encourage them to upload relevant documents for more specific, grounded answers.
Be helpful, professional, and concise.`;

    // 5. Call Gemini
    const chat = this.model.startChat({
      history: history.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.content }]
      })),
      systemInstruction: { parts: [{ text: systemPrompt }] }
    });

    const result = await chat.sendMessageStream(query);
    return {
        stream: result.stream,
        citations: chunksData
    };
  }
}
