
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'wheelpath-filesearch' });
const db = getFirestore();

async function verifyTestDoc() {
  console.log("Checking for 'test-doc-1'...");
  
  const snapshot = await db.collection('documents').get();
  const doc = snapshot.docs.find(d => d.data().title?.includes('test-doc-1'));
  
  if (!doc) {
      console.log("❌ Document not found.");
      return;
  }
  
  console.log(`✅ Found: ${doc.id} (${doc.data().status})`);
  
  const chunks = await doc.ref.collection('chunks').get();
  console.log(`✅ Chunks found: ${chunks.size}`);
  
  chunks.docs.forEach(c => {
      console.log(`   - [${c.id}] ${c.data().text.substring(0, 50)}...`);
  });
}

verifyTestDoc().catch(console.error);

