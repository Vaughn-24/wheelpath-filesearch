import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { Injectable } from '@nestjs/common';
import { Message } from '@wheelpath/schemas';
import * as admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RagService {
  private model: GenerativeModel | null = null;
  private firestore: admin.firestore.Firestore;
  private fileManager: GoogleAIFileManager | null = null;
  private storage: Storage;

  constructor(private readonly metricsService: MetricsService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { maxOutputTokens: 2000 },
      });
      this.fileManager = new GoogleAIFileManager(apiKey);
    }

    if (!admin.apps.length) {
      admin.initializeApp({ projectId: process.env.GCP_PROJECT || 'wheelpath-filesearch' });
    }
    this.firestore = admin.firestore();
    this.storage = new Storage();
  }

  /**
   * Check if a Gemini file reference is still valid
   */
  private async isFileValid(fileUri: string): Promise<boolean> {
    if (!this.fileManager) return false;
    try {
      // Extract file name from URI (e.g., "files/abc123")
      const fileName = fileUri.split('/').pop();
      if (!fileName) return false;
      await this.fileManager.getFile(fileName);
      return true;
    } catch (error: any) {
      console.log('[RagService] File expired or invalid:', fileUri.substring(0, 50));
      return false;
    }
  }

  /**
   * Re-upload a document to Gemini Files API
   */
  private async reprocessDocument(docId: string, docData: any): Promise<string | null> {
    if (!this.fileManager || !docData.gcsPath) return null;

    try {
      console.log('[RagService] Re-processing expired document:', docData.title);
      
      const matches = docData.gcsPath.match(/gs:\/\/([^\/]+)\/(.+)/);
      if (!matches) return null;
      const [, bucket, fileName] = matches;
      
      const tempPath = path.join(os.tmpdir(), `${docId}.pdf`);
      await this.storage.bucket(bucket).file(fileName).download({ destination: tempPath });
      
      const uploadResult = await this.fileManager.uploadFile(tempPath, {
        mimeType: docData.mimeType || 'application/pdf',
        displayName: docData.title,
      });
      
      // Update Firestore with new file reference
      await this.firestore.collection('documents').doc(docId).update({
        geminiFileUri: uploadResult.file.uri,
        geminiFileName: uploadResult.file.name,
        reprocessedAt: new Date().toISOString(),
      });
      
      fs.unlinkSync(tempPath);
      console.log('[RagService] ✅ Re-processed:', uploadResult.file.uri);
      return uploadResult.file.uri;
    } catch (error: any) {
      console.error('[RagService] Re-process failed:', error.message);
      return null;
    }
  }

  async chatStream(tenantId: string, documentId: string, query: string, history: Message[]) {
    let context = '';
    const citations: any[] = [];

    // Get document(s) to search
    const docIds: string[] = [];
    if (documentId && documentId !== 'all') {
      docIds.push(documentId);
    } else {
      // Get all ready documents (TODO: add tenant filter back for production)
      const docsSnap = await this.firestore.collection('documents')
        .where('status', '==', 'ready')
        .get();
      docsSnap.forEach(d => docIds.push(d.id));
      console.log('[RagService] Found docs (all tenants):', docIds.length);
    }

    console.log('[RagService] Processing query for docs:', docIds);

    // Collect ALL file URIs from documents (validate and reprocess if needed)
    const fileUris: { fileUri: string; mimeType: string; title: string }[] = [];

    for (const docId of docIds.slice(0, 5)) { // Limit to 5 docs for cost control
      const docSnap = await this.firestore.collection('documents').doc(docId).get();
      const docData = docSnap.data();
      
      if (docData?.geminiFileUri) {
        // Validate the file reference is still active
        const isValid = await this.isFileValid(docData.geminiFileUri);
        
        if (isValid) {
          fileUris.push({
            fileUri: docData.geminiFileUri,
            mimeType: docData.mimeType || 'application/pdf',
            title: docData.title || docId,
          });
          console.log('[RagService] Adding file:', docData.title);
        } else {
          // Try to re-process the document
          const newUri = await this.reprocessDocument(docId, docData);
          if (newUri) {
            fileUris.push({
              fileUri: newUri,
              mimeType: docData.mimeType || 'application/pdf',
              title: docData.title || docId,
            });
            console.log('[RagService] Adding re-processed file:', docData.title);
          } else {
            console.log('[RagService] Skipping expired/invalid file:', docData.title);
          }
        }
      } else {
        // Fall back to existing chunks in Firestore
        const chunksSnap = await this.firestore
          .collection('documents').doc(docId)
          .collection('chunks')
          .orderBy('chunkIndex')
          .limit(10)
          .get();
        
        if (!chunksSnap.empty) {
          chunksSnap.docs.forEach((chunk) => {
            const data = chunk.data();
            context += `[${citations.length + 1}] (Page ${data.pageNumber || 1}): ${data.text}\n\n`;
            citations.push({
              index: citations.length + 1,
              pageNumber: data.pageNumber || 1,
              text: data.text?.substring(0, 100) + '...',
              documentId: docId,
            });
          });
        }
      }
    }

    console.log('[RagService] Files to search:', fileUris.length, 'Context chunks:', citations.length);

    // Build system prompt
    const hasContext = fileUris.length > 0 || context.length > 0;
    
    const systemPrompt = hasContext
      ? `You are WheelPath AI — the calm, experienced field mentor for construction professionals.
${context ? `Use this context to answer:\n${context}` : `Search the ${fileUris.length} attached document(s) to answer.`}
Cite sources using [1], [2], etc. Tagline: "Get Clarity. Go Build."`
      : `You are WheelPath AI. The user hasn't uploaded documents yet. Help with general questions and encourage document upload.`;

    if (!this.model) {
      const fallback = (async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'AI service not configured.' }] } }] };
      })();
      return { stream: fallback, citations };
    }

    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Ready. Get Clarity. Go Build.' }] },
      ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] })),
    ];

    // Build message - include ALL files, then the query
    const messageParts: any[] = [];
    for (const file of fileUris) {
      messageParts.push({ fileData: { fileUri: file.fileUri, mimeType: file.mimeType } });
    }
    messageParts.push({ text: query });

    try {
      const chat = this.model.startChat({ history: chatHistory });
      const result = await chat.sendMessageStream(messageParts);

      this.metricsService.track({
          type: 'chat_query',
          tenantId,
          documentId: documentId === 'all' ? undefined : documentId,
        metadata: { queryLength: query.length },
      }).catch(() => {});

      return { stream: result.stream, citations };
    } catch (error: any) {
      console.error('Chat error:', error.message);
      const errorStream = (async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'Temporary issue. Please try again.' }] } }] };
      })();
      return { stream: errorStream, citations };
    }
  }
}
