
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Use default credentials (from gcloud auth login)
initializeApp({
    projectId: 'wheelpath-filesearch'
});

const db = getFirestore();

async function checkData() {
  console.log("\n🔎 INSPECTING FIRESTORE (The Brain's Memory)...\n");
  
  // Get ANY ready documents (index-free query)
  const docs = await db.collection('documents')
    .where('status', '==', 'ready')
    .limit(2)
    .get();
  
  if (docs.empty) {
      console.log("No 'ready' documents found.");
      return;
  }

  for (const doc of docs.docs) {
      const data = doc.data();
      console.log(`📄 DOCUMENT: ${data.title}`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Status: ${data.status}`);
      console.log(`   GCS Path: ${data.gcsPath}`);
      console.log(`   Stats: ${JSON.stringify(data.stats)}`);
      
      console.log(`\n   --- SAMPLE CHUNKS (What the AI reads) ---`);
      const chunks = await doc.ref.collection('chunks').orderBy('index').limit(3).get();
      
      chunks.forEach(c => {
          const chunkData = c.data();
          console.log(`   [Chunk ${chunkData.index} | Page ${chunkData.pageNumber}]`);
          // Show first 100 chars of text
          console.log(`   "${chunkData.text.replace(/\n/g, ' ').substring(0, 100)}..."\n`);
      });
  }
}

checkData().catch(console.error);
