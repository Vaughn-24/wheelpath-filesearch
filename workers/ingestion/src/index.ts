// @ts-nocheck
import { cloudEvent } from '@google-cloud/functions-framework';
import { Storage } from '@google-cloud/storage';
import { VertexAI } from '@google-cloud/vertexai';
import * as aiplatform from '@google-cloud/aiplatform';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

initializeApp();
const firestore = getFirestore();
const storage = new Storage();

const project = process.env.GCP_PROJECT || 'wheelpath-ai-dev';
const location = process.env.GCP_LOCATION || 'us-central1';
// For Upsert, we need the Index ID, not the Endpoint ID
const indexId = process.env.VERTEX_INDEX_ID; 

// Use PredictionServiceClient for embeddings to avoid SDK issues
const predictionClient = new aiplatform.v1.PredictionServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`
});

// We use IndexServiceClient for Upsert operations on the Index resource
const indexClient = new aiplatform.v1.IndexServiceClient({
    apiEndpoint: `${location}-aiplatform.googleapis.com`
});

async function generateEmbedding(text: string): Promise<number[] | undefined> {
    const endpoint = `projects/${project}/locations/${location}/publishers/google/models/text-embedding-004`;
    
    // Manual protobuf construction to avoid helper issues
    const instanceValue = {
        structValue: {
            fields: {
                content: { stringValue: text }
            }
        }
    };
    
    const [response] = await predictionClient.predict({
        endpoint,
        instances: [instanceValue as any],
    });

    if (!response.predictions || response.predictions.length === 0) return undefined;
    
    const prediction = response.predictions[0];
    const embeddings = prediction.structValue?.fields?.embeddings;
    const values = embeddings?.structValue?.fields?.values?.listValue?.values;
    
    if (!values) return undefined;
    
    return values.map((v: any) => v.numberValue || 0);
}

cloudEvent('processDocument', async (cloudEvent: any) => {
  const file = cloudEvent.data;
  const bucketName = file.bucket;
  const fileName = file.name;
  const contentType = file.contentType;

  if (!contentType?.includes('pdf')) {
    console.log('Skipping non-PDF file');
    return;
  }

  // Expected format: tenantId/documentId.pdf
  const parts = fileName.split('/');
  if (parts.length < 2) {
    console.log('Invalid file path format');
    return;
  }
  
  const tenantId = parts[0];
  const documentId = parts[1].replace('.pdf', ''); // simple removal of extension

  console.log(`Processing ${documentId} for ${tenantId}`);

  // Update Firestore status (use set with merge to handle missing docs)
  const docRef = firestore.collection('documents').doc(documentId);
  const docSnap = await docRef.get();
  
  if (!docSnap.exists) {
    console.error(`Document ${documentId} does not exist in Firestore. Creating it.`);
    // Create the document if it doesn't exist (race condition handling)
    await docRef.set({
      id: documentId,
      tenantId,
      title: fileName.split('/').pop() || 'Unknown',
      gcsPath: `gs://${bucketName}/${fileName}`,
      mimeType: contentType || 'application/pdf',
      status: 'processing',
      createdAt: new Date().toISOString()
    }, { merge: true });
  } else {
    await docRef.update({ status: 'processing' });
  }

  try {
    // 1. Download
    const bucket = storage.bucket(bucketName);
    const [buffer] = await bucket.file(fileName).download();

    // 2. Extract
    let text = '';
    let pageCount = 0;
    
    const options = {
        pagerender: function(pageData: any) {
            return pageData.getTextContent({ normalizeWhitespace: true })
            .then(function(textContent: any) {
                let lastY, text = '';
                for (let item of textContent.items) {
                    if (lastY == item.transform[5] || !lastY){
                        text += item.str;
                    }  
                    else{
                        text += '\n' + item.str;
                    }
                    lastY = item.transform[5];
                }
                return `[[[PAGE:${pageData.pageIndex + 1}]]]${text}`;
            });
        }
    }

    try {
        const data = await pdfParse(buffer, options);
        text = data.text;
        pageCount = data.numpages;
    } catch (e) {
        console.error('Failed to parse PDF', e);
        throw new Error('PDF Parsing Failed');
    }

    if (!text) {
        throw new Error('No text extracted');
    }

    // 3. Chunk (Page-aware)
    const pages = text.split('[[[PAGE:');
    let allChunks: { text: string, page: number }[] = [];

    for (const p of pages) {
        if (!p.trim()) continue;
        const pageNumStr = p.split(']]]')[0];
        const pageText = p.split(']]]')[1] || '';
        const pageNum = parseInt(pageNumStr);
        if (isNaN(pageNum)) continue;

        // Chunk size: 4000 chars (~1000 tokens) - well under text-embedding-004's 3072 token limit
        // Overlap: 400 chars (~100 tokens) for context continuity
        const pageChunks = chunkText(pageText, 4000, 400);
        pageChunks.forEach(c => allChunks.push({ text: c, page: pageNum }));
    }
    
    console.log(`Generated ${allChunks.length} chunks across ${pageCount} pages`);

    // 4. Embed & Index
    // text-embedding-004 produces 768-dimensional vectors
    const EXPECTED_EMBEDDING_DIM = 768;
    const points: any[] = [];
    
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      
      // Generate embedding using VertexAI SDK
      // text-embedding-004 accepts up to 3072 tokens (~12K chars), our chunks are 4000 chars max
      let embedding: number[] | undefined;
      try {
          embedding = await generateEmbedding(chunk.text);
      } catch (e) {
          console.error(`Error generating embedding for chunk ${i}:`, e);
          continue; // Skip this chunk if embedding fails
      }

      if (!embedding || embedding.length === 0) {
          console.warn(`No embedding returned for chunk ${i}`);
          continue;
      }

      // Ensure embedding is an array of numbers
      if (!Array.isArray(embedding) || !embedding.every(v => typeof v === 'number')) {
          console.error(`Chunk ${i}: Invalid embedding format`);
          continue;
      }

      points.push({
        datapointId: `${documentId}_${i}`,
        featureVector: embedding,
        restricts: [{ namespace: 'documentId', allowList: [documentId] }]
      });
      
      await firestore.collection('documents').doc(documentId).collection('chunks').doc(`${i}`).set({
        text: chunk.text,
        index: i,
        pageNumber: chunk.page,
        pageSpan: `Page ${chunk.page}`
      });
    }

    if (indexId && points.length > 0) {
        console.log(`Upserting ${points.length} vectors to Vertex AI Index ${indexId}`);
        
        const indexName = `projects/${project}/locations/${location}/indexes/${indexId}`;
        
        const batchSize = 50;
        for (let i = 0; i < points.length; i += batchSize) {
            const batch = points.slice(i, i + batchSize);
            // Correct Method: upsertDatapoints on IndexServiceClient (not Endpoint)
            await indexClient.upsertDatapoints({ 
              index: indexName, 
              datapoints: batch 
            });
            console.log(`Upserted batch ${i} to ${i + batchSize}`);
        }
    } else {
        console.log('Skipping Vector Upsert: VERTEX_INDEX_ID not set.');
    }

    // 5. Update Firestore
    await docRef.update({
      status: 'ready',
      stats: {
        pageCount,
        chunkCount: allChunks.length
      }
    });
    
    console.log(`Finished processing ${documentId}`);

  } catch (error) {
    console.error('Processing error:', error);
    try {
      const docSnap = await docRef.get();
      if (docSnap.exists) {
        await docRef.update({ status: 'error' });
      } else {
        // Document was deleted, create error state
        await docRef.set({
          id: documentId,
          tenantId,
          title: fileName.split('/').pop() || 'Unknown',
          gcsPath: `gs://${bucketName}/${fileName}`,
          mimeType: contentType || 'application/pdf',
          status: 'error',
          createdAt: new Date().toISOString()
        }, { merge: true });
      }
    } catch (firestoreError) {
      console.error('Failed to update error status:', firestoreError);
    }
  }
});

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  return chunks;
}
