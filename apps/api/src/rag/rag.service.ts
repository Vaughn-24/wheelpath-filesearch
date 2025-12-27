import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { Injectable } from '@nestjs/common';
import { Message } from '@wheelpath/schemas';
import * as admin from 'firebase-admin';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class RagService {
  private model: GenerativeModel | null = null;
  private firestore: admin.firestore.Firestore;

  constructor(private readonly metricsService: MetricsService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      this.model = genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { maxOutputTokens: 2000 },
      });
    }

    if (!admin.apps.length) {
      admin.initializeApp({ projectId: process.env.GCP_PROJECT || 'wheelpath-filesearch' });
    }
    this.firestore = admin.firestore();
  }

  async chatStream(tenantId: string, documentId: string, query: string, history: Message[]) {
    let context = '';
    let fileUri: string | null = null;
    let mimeType = 'application/pdf';
    const citations: any[] = [];

    // Get document(s) to search
    const docIds: string[] = [];
    if (documentId && documentId !== 'all') {
      docIds.push(documentId);
    } else {
      // Get all tenant documents
      const docsSnap = await this.firestore.collection('documents')
        .where('tenantId', '==', tenantId)
        .where('status', '==', 'ready')
        .get();
      docsSnap.forEach(d => docIds.push(d.id));
    }

    console.log('[RagService] Processing query for docs:', docIds);

    // For each document, check for geminiFileUri OR fall back to chunks
    for (const docId of docIds.slice(0, 3)) { // Limit to 3 docs
      const docSnap = await this.firestore.collection('documents').doc(docId).get();
      const docData = docSnap.data();
      
      if (docData?.geminiFileUri) {
        // Use Gemini File API (preferred)
        fileUri = docData.geminiFileUri;
        mimeType = docData.mimeType || 'application/pdf';
        console.log('[RagService] Using Gemini File API:', fileUri);
        break; // Only use one file for now
      } else {
        // Fall back to existing chunks in Firestore
        const chunksSnap = await this.firestore
          .collection('documents').doc(docId)
          .collection('chunks')
          .orderBy('chunkIndex')
          .limit(10)
          .get();
        
        console.log('[RagService] Falling back to chunks for doc:', docId, 'found:', chunksSnap.size);
        
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

    // Build system prompt
    const hasContext = fileUri || context.length > 0;
    console.log('[RagService] Context built:', { hasFileUri: !!fileUri, contextLength: context.length, citationCount: citations.length });
    
    const systemPrompt = hasContext
      ? `You are WheelPath AI — the calm, experienced field mentor for construction professionals.
${context ? `Use this context to answer:\n${context}` : 'Use the attached document to answer.'}
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

    // Build message - include file if available, otherwise just text
    const messageParts: any[] = [];
    if (fileUri) {
      messageParts.push({ fileData: { fileUri, mimeType } });
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
