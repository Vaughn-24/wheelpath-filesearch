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
  private vectorSearchClient: aiplatform.v1.MatchServiceClient;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-ai-dev';
  private location = process.env.GCP_LOCATION || 'us-central1';
  private indexEndpointId = process.env.VERTEX_INDEX_ENDPOINT_ID;
  private deployedIndexId = process.env.VERTEX_DEPLOYED_INDEX_ID;

  constructor() {
    this.vertexAI = new VertexAI({ project: this.project, location: this.location });
    this.model = this.vertexAI.getGenerativeModel({ model: 'gemini-1.5-pro' }) as any;
    
    // Use PredictionServiceClient for embeddings
    this.predictionClient = new aiplatform.v1.PredictionServiceClient({
        apiEndpoint: `${this.location}-aiplatform.googleapis.com`
    });

    this.firestore = admin.firestore();
    
    this.vectorSearchClient = new aiplatform.v1.MatchServiceClient({
        apiEndpoint: `${this.location}-aiplatform.googleapis.com`
    });
  }

  async chatStream(tenantId: string, documentId: string, query: string, history: Message[]) {
    let chunksData: any[] = [];
    let filter: any = null;

    if (this.indexEndpointId && this.deployedIndexId) {
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
                // No docs, empty result
                return { 
                    stream: (async function*(){ yield { candidates: [{ content: { parts: [{ text: "No documents found to search." }] } }] } })(), 
                    citations: [] 
                };
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

        // 2. Vector Search
        const indexEndpoint = `projects/${this.project}/locations/${this.location}/indexEndpoints/${this.indexEndpointId}`;
        
        const [response] = await this.vectorSearchClient.findNeighbors({
            indexEndpoint,
            deployedIndexId: this.deployedIndexId,
            queries: [{
                datapoint: {
                    featureVector: embedding,
                    restricts: filter ? [filter] : []
                },
                neighborCount: 5
            }],
            returnFullDatapoint: false
        });
        
        const neighbors = response.nearestNeighbors?.[0]?.neighbors || [];
        
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
    } else {
        // Fallback for local dev without Vertex AI set up
        console.warn("VERTEX_INDEX_ENDPOINT_ID not set, using fallback retrieval");
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
      
    const context = chunksData.map(c => `[${c.index}] (Page ${c.pageNumber}): ${c.text}`).join('\n\n');
    
    // 4. Construct Prompt
    const systemPrompt = `You are a helpful assistant. Use the following CONTEXT to answer the user's question.
    Always cite your sources strictly using the format [1], [2], etc. which corresponds to the context chunks provided.
    Do not invent citations. If the answer is not in the context, say you don't know.
    
    CONTEXT:
    ${context}
    `;

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
