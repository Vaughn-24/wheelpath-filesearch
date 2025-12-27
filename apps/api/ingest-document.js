const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { v1 } = require('@google-cloud/aiplatform');
const fs = require('fs');
const path = require('path');

// Load environment
require('dotenv').config({ path: './apps/api/.env' });

const project = process.env.GCP_PROJECT || 'wheelpath-filesearch';
const location = process.env.GCP_LOCATION || 'us-central1';
const indexId = process.env.VERTEX_INDEX_ID;

// Initialize
if (!admin.apps.length) {
  admin.initializeApp({ projectId: project });
}
const firestore = admin.firestore();
const storage = new Storage({ projectId: project });

const predictionClient = new v1.PredictionServiceClient({
  apiEndpoint: `${location}-aiplatform.googleapis.com`
});

const indexClient = new v1.IndexServiceClient({
  apiEndpoint: `${location}-aiplatform.googleapis.com`
});

async function generateEmbedding(text) {
  const endpoint = `projects/${project}/locations/${location}/publishers/google/models/text-embedding-004`;
  
  const instanceValue = {
    structValue: {
      fields: {
        content: { stringValue: text }
      }
    }
  };
  
  const [response] = await predictionClient.predict({
    endpoint,
    instances: [instanceValue],
  });

  if (!response.predictions || response.predictions.length === 0) return undefined;
  
  const prediction = response.predictions[0];
  const embeddings = prediction.structValue?.fields?.embeddings;
  const values = embeddings?.structValue?.fields?.values?.listValue?.values;
  
  if (!values) return undefined;
  
  return values.map(v => v.numberValue || 0);
}

function chunkText(text, chunkSize = 4000, overlap = 400) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start += chunkSize - overlap;
  }
  return chunks;
}

async function processDocument(documentId) {
  console.log('Processing document:', documentId);
  
  // Get document from Firestore
  const docRef = firestore.collection('documents').doc(documentId);
  const docSnap = await docRef.get();
  
  if (!docSnap.exists) {
    console.error('Document not found in Firestore');
    return;
  }
  
  const docData = docSnap.data();
  console.log('Document:', docData.title);
  console.log('GCS Path:', docData.gcsPath);
  
  // Update status
  await docRef.update({ status: 'processing' });
  
  try {
    // Parse GCS path: gs://bucket/path
    const gcsPath = docData.gcsPath;
    const match = gcsPath.match(/gs:\/\/([^\/]+)\/(.+)/);
    if (!match) {
      throw new Error('Invalid GCS path: ' + gcsPath);
    }
    
    const bucketName = match[1];
    const fileName = match[2];
    
    console.log('Downloading from bucket:', bucketName, 'file:', fileName);
    
    // Download file
    const bucket = storage.bucket(bucketName);
    const [buffer] = await bucket.file(fileName).download();
    
    console.log('Downloaded', buffer.length, 'bytes');
    
    // Parse PDF
    const pdfParse = require('pdf-parse');
    
    const options = {
      pagerender: function(pageData) {
        return pageData.getTextContent({ normalizeWhitespace: true })
          .then(function(textContent) {
            let lastY, text = '';
            for (let item of textContent.items) {
              if (lastY == item.transform[5] || !lastY) {
                text += item.str;
              } else {
                text += '\n' + item.str;
              }
              lastY = item.transform[5];
            }
            return `[[[PAGE:${pageData.pageIndex + 1}]]]${text}`;
          });
      }
    };
    
    const data = await pdfParse(buffer, options);
    const text = data.text;
    const pageCount = data.numpages;
    
    console.log('Extracted', text.length, 'chars from', pageCount, 'pages');
    
    // Chunk by page
    const pages = text.split('[[[PAGE:');
    let allChunks = [];
    
    for (const p of pages) {
      if (!p.trim()) continue;
      const pageNumStr = p.split(']]]')[0];
      const pageText = p.split(']]]')[1] || '';
      const pageNum = parseInt(pageNumStr);
      if (isNaN(pageNum)) continue;
      
      const pageChunks = chunkText(pageText);
      pageChunks.forEach(c => allChunks.push({ text: c, page: pageNum }));
    }
    
    console.log('Generated', allChunks.length, 'chunks');
    
    // Generate embeddings and store
    const points = [];
    
    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      console.log(`Embedding chunk ${i + 1}/${allChunks.length}...`);
      
      const embedding = await generateEmbedding(chunk.text);
      
      if (!embedding || embedding.length === 0) {
        console.warn(`No embedding for chunk ${i}`);
        continue;
      }
      
      points.push({
        datapointId: `${documentId}_${i}`,
        featureVector: embedding,
        restricts: [{ namespace: 'documentId', allowList: [documentId] }]
      });
      
      // Store chunk in Firestore
      await firestore.collection('documents').doc(documentId).collection('chunks').doc(`${i}`).set({
        text: chunk.text,
        index: i,
        pageNumber: chunk.page,
        pageSpan: `Page ${chunk.page}`
      });
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('Generated', points.length, 'embeddings');
    
    // Upsert to Vertex AI Index
    if (indexId && points.length > 0) {
      console.log('Upserting to Vertex AI Index:', indexId);
      const indexName = `projects/${project}/locations/${location}/indexes/${indexId}`;
      
      const batchSize = 50;
      for (let i = 0; i < points.length; i += batchSize) {
        const batch = points.slice(i, i + batchSize);
        await indexClient.upsertDatapoints({
          index: indexName,
          datapoints: batch
        });
        console.log(`Upserted batch ${i} to ${Math.min(i + batchSize, points.length)}`);
      }
    } else {
      console.warn('VERTEX_INDEX_ID not set, skipping vector upsert');
    }
    
    // Update status to ready
    await docRef.update({
      status: 'ready',
      stats: {
        pageCount,
        chunkCount: allChunks.length
      }
    });
    
    console.log('✅ Document processed successfully!');
    
  } catch (error) {
    console.error('Error processing document:', error);
    await docRef.update({ status: 'error', errorMessage: error.message });
  }
}

// Get document ID from command line
const documentId = process.argv[2] || '5c675235-e755-4763-92b5-cfc2ff78466a';
processDocument(documentId).then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
