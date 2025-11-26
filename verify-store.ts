
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize
initializeApp({ projectId: 'wheelpath-ai-dev' });
const db = getFirestore();

async function verifyStore() {
  console.log("\n🔍 CCC VERIFICATION: STORE PILLAR\n");

  // 1. Find ALL documents matching the title
  const snapshot = await db.collection('documents').get();
  const matches = snapshot.docs.filter(d => {
      const title = d.data().title || '';
      return title.includes('RFI-128') || title.includes('RFI-091');
  });

  console.log(`Found ${matches.length} matching documents:`);
  matches.forEach(d => {
      console.log(`- [${d.data().createdAt}] ID: ${d.id} | Status: ${d.data().status}`);
  });
  
  if (matches.length === 0) return;

  // Verify the latest one
  const targetDoc = matches.sort((a, b) => (a.data().createdAt > b.data().createdAt ? -1 : 1))[0];

  if (!targetDoc) {
      console.error("❌ FAIL: Document not found in Firestore.");
      return;
  }

  const data = targetDoc.data();
  console.log(`✅ Document Found: "${data.title}"`);
  console.log(`   ID: ${targetDoc.id}`);
  
  // 2. Verify Metadata Schema
  if (data.status === 'ready' && data.gcsPath && data.stats) {
      console.log(`✅ Metadata Integrity: PASS`);
      console.log(`   - Status: ${data.status}`);
      console.log(`   - GCS Path: ${data.gcsPath}`);
      console.log(`   - Stats: Page Count ${data.stats.pageCount}, Chunk Count ${data.stats.chunkCount}`);
  } else {
      console.error(`❌ Metadata Integrity: FAIL`);
      console.log(data);
  }

  // 3. Verify Content (Chunks) - Direct check for chunk '0'
  const chunkDoc = await targetDoc.ref.collection('chunks').doc('0').get();
  if (chunkDoc.exists) {
      const chunk = chunkDoc.data();
      console.log(`✅ Content Extraction: PASS`);
      console.log(`   - Sample Text: "${chunk?.text ? chunk.text.substring(0, 50) : 'NO TEXT'}..."`);
      console.log(`   - Page: ${chunk?.pageNumber}`);
  } else {
      // Try listing without order
      const anyChunks = await targetDoc.ref.collection('chunks').limit(1).get();
      if (!anyChunks.empty) {
           const c = anyChunks.docs[0].data();
           console.log(`✅ Content Extraction: PASS (Found via list)`);
           console.log(`   - Sample Text: "${c.text.substring(0, 50)}..."`);
      } else {
           console.error(`❌ Content Extraction: FAIL (No chunks found at all)`);
      }
  }

  console.log("\n🏁 CCC Verdict: STORE Pillar is " + (chunkDoc.exists ? "COMPLETE" : "INCOMPLETE"));
}

verifyStore().catch(console.error);

