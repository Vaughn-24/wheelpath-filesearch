import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as admin from 'firebase-admin';
import { MetricsService } from '../metrics/metrics.service';

/**
 * VoiceService - Voice agent functionality using Gemini File API
 * 
 * Now uses the same Gemini File API approach as RagService for document grounding.
 */
@Injectable()
export class VoiceService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: any;
  private firestore: admin.firestore.Firestore;
  
  private project = process.env.GCP_PROJECT || 'wheelpath-filesearch';

  // Request timeout protection for LLM calls
  private readonly LLM_REQUEST_TIMEOUT_MS = 30000;

  constructor(private readonly metricsService: MetricsService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      const voiceModel = process.env.GEMINI_VOICE_MODEL || 'gemini-2.0-flash';
      this.model = this.genAI.getGenerativeModel({ 
        model: voiceModel,
        generationConfig: {
          maxOutputTokens: 500, // Cost guardrail: voice responses should be concise
        },
      });
      console.log(`VoiceService: Initialized Gemini (${voiceModel}) with maxOutputTokens=500`);
    } else {
      console.warn('VoiceService: GEMINI_API_KEY not set');
    }

    if (!admin.apps.length) {
      try {
        admin.initializeApp({
          projectId: this.project,
        });
        console.log('VoiceService: Firebase Admin initialized with project:', this.project);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.warn('VoiceService: Firebase Admin initialization warning:', msg);
      }
    }
    this.firestore = admin.firestore();
  }

  /**
   * Retrieve file URIs for Gemini File API (matching RagService approach)
   */
  private async retrieveFileUris(tenantId: string, documentId: string): Promise<{ fileUri: string; mimeType: string; title: string }[]> {
    console.log('[VoiceService] retrieveFileUris called', { tenantId, documentId });

    const docIds: string[] = [];
    if (documentId && documentId !== 'all') {
      docIds.push(documentId);
    } else {
      // Get all ready documents (matching RagService - allow cross-tenant for testing)
      const docsSnap = await this.firestore.collection('documents')
        .where('status', '==', 'ready')
        .get();
      docsSnap.forEach(d => docIds.push(d.id));
      console.log('[VoiceService] Found docs (all tenants):', docIds.length);
    }

    const fileUris: { fileUri: string; mimeType: string; title: string }[] = [];

    for (const docId of docIds.slice(0, 5)) { // Limit to 5 docs for cost control
      const docSnap = await this.firestore.collection('documents').doc(docId).get();
      const docData = docSnap.data();
      
      if (docData?.geminiFileUri) {
        fileUris.push({
          fileUri: docData.geminiFileUri,
          mimeType: docData.mimeType || 'application/pdf',
          title: docData.title || docId,
        });
        console.log('[VoiceService] Adding file:', docData.title);
      }
    }

    console.log('[VoiceService] Files to search:', fileUris.length);
    return fileUris;
  }

  /**
   * WheelPath Voice Profile - System Prompt
   * 
   * Core Identity: The calm, experienced field mentor who understands 
   * construction documents, project realities, and trade contractor workloads.
   * 
   * Tagline: "Get Clarity. Go Build."
   */
  private buildVoiceSystemPrompt(context: string): string {
    const voiceProfile = `You are WheelPath Voice — the calm, experienced field mentor for construction professionals.

CORE IDENTITY:
You have two superpowers:
1. Finding the right information instantly from project data
2. Turning that information into clear, confident next steps

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented  
- Friendly but professional
- Never rushed, never panicked
- Supportive without being fluffy
- Empathetic to field constraints (long days, shifting priorities)

AVOID:
- Corporate buzzwords ("synergy," "leverage," "optimize," "digital transformation")
- Legalese or overly technical jargon
- Overconfidence without evidence
- Guessing or hallucinating data
- Markdown, bullet points, or formatting (this is spoken audio)
- Citations like [1] or [2]

RESPONSE PATTERN:
Data → Meaning → Action
1. State the facts from the data
2. Explain what it means
3. Give a clear next step

COMMON PHRASES TO USE:
- "Here's what the data shows."
- "Here's the current status."
- "Based on the documents you shared…"
- "This keeps your project on track."
- "This protects your margin."
- "Next step:"
- "You're good to go."
- "Let's keep things moving."

STRUCTURAL HABITS:
- Confirm the user's request
- Pull relevant facts from the context
- Present clear, neutral findings
- Give one actionable next step
- End with reassurance when appropriate

SUCCESS CRITERIA:
- Provide clarity within 5 seconds of reading
- Turn scattered information into a coherent picture
- Support confident decision-making
- Respect the user's limited time
- Leave the user feeling supported

Remember: Every response should produce clarity and confidence — not more tasks.
Tagline encoded into tone: "Get Clarity. Go Build."`;

    if (context) {
      return `${voiceProfile}

PROJECT CONTEXT (from user's documents):
${context}

Answer the user's question using ONLY the context above. If the answer isn't in the context, say "I don't have that information in your documents yet. Want me to help you find it another way?"`;
    }
    
    return `${voiceProfile}

NOTE: The user hasn't uploaded project documents yet. 
- Help with general construction questions
- Encourage them to upload documents for project-specific answers
- Say something like: "Once you upload your project documents, I can give you specific answers grounded in your data."`;
  }

  /**
   * Process a voice query and return a text response
   * This is used for Speech-to-Text -> LLM -> Text-to-Speech flow
   */
  async processVoiceQuery(
    tenantId: string, 
    documentId: string, 
    transcribedText: string
  ): Promise<string> {
    if (!this.model) {
      return "Voice service is being configured. Please try again shortly.";
    }

    // Get file URIs for Gemini File API (same as RagService)
    const fileUris = await this.retrieveFileUris(tenantId, documentId);
    const hasFiles = fileUris.length > 0;
    
    // Build voice-optimized prompt
    const systemPrompt = hasFiles
      ? this.buildVoiceSystemPrompt(`Search the ${fileUris.length} attached document(s) to answer.`)
      : this.buildVoiceSystemPrompt('');

    // Single-turn generation (no history for voice - reduces latency)
    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];
    
    const chat = this.model.startChat({ history: chatHistory });
    
    // Build message parts - include ALL files, then the query (matching RagService)
    const messageParts: any[] = [];
    for (const file of fileUris) {
      messageParts.push({ fileData: { fileUri: file.fileUri, mimeType: file.mimeType } });
    }
    messageParts.push({ text: transcribedText });
    
    const result = await chat.sendMessage(messageParts);
    const response = result.response;
    const text = response.text();

    // Track metrics (non-blocking)
    this.metricsService.track({
      type: 'voice_query',
      tenantId,
      documentId: documentId === 'all' ? undefined : documentId,
      metadata: {
        queryLength: transcribedText.length,
        responseLength: text.length,
        hasContext: hasFiles,
      }
    }).catch(err => console.warn('Voice metrics failed:', err.message));

    return text;
  }

  /**
   * Stream voice response for lower perceived latency
   */
  async *streamVoiceResponse(
    tenantId: string,
    documentId: string,
    transcribedText: string
  ): AsyncGenerator<string> {
    // [Checkpoint 12] Voice service method invoked
    const startTime = Date.now();
    console.log('[VoiceService] streamVoiceResponse called', {
      tenantId,
      documentId,
      transcribedTextLength: transcribedText.length,
    });

    if (!this.model) {
      console.warn('[VoiceService] Model not initialized');
      yield "Voice service is being configured.";
      return;
    }

    // [Checkpoint 12.1] Get file URIs for Gemini File API (same as RagService)
    const contextStartTime = Date.now();
    console.log('[VoiceService] Retrieving file URIs for voice query');
    const fileUris = await this.retrieveFileUris(tenantId, documentId);
    console.log('[VoiceService] Files retrieved', {
      fileCount: fileUris.length,
      duration: Date.now() - contextStartTime,
    });

    const hasFiles = fileUris.length > 0;
    const systemPrompt = hasFiles
      ? this.buildVoiceSystemPrompt(`Search the ${fileUris.length} attached document(s) to answer.`)
      : this.buildVoiceSystemPrompt('');

    const chatHistory = [
      { role: 'user', parts: [{ text: systemPrompt }] },
      { role: 'model', parts: [{ text: 'Understood. I am WheelPath Voice — calm, clear, and grounded in the data. Ready to help.' }] },
    ];
    
    // [Checkpoint 13] Gemini API call for voice
    const geminiStartTime = Date.now();
    console.log('[VoiceService] Calling Gemini API for voice response', {
      model: 'gemini-2.0-flash',
      transcribedTextLength: transcribedText.length,
      hasFiles,
      fileCount: fileUris.length,
      timeoutMs: this.LLM_REQUEST_TIMEOUT_MS,
    });
    
    const chat = this.model.startChat({ history: chatHistory });
    
    // Build message parts - include ALL files, then the query (matching RagService)
    const messageParts: any[] = [];
    for (const file of fileUris) {
      messageParts.push({ fileData: { fileUri: file.fileUri, mimeType: file.mimeType } });
    }
    messageParts.push({ text: transcribedText });
    
    // Add timeout protection around stream start
    const streamStartTimeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('LLM request timeout')), this.LLM_REQUEST_TIMEOUT_MS)
    );
    
    let result: any;
    try {
      result = await Promise.race([chat.sendMessageStream(messageParts), streamStartTimeoutPromise]);
    } catch (error: any) {
      console.error('[VoiceService] Gemini API stream start failed or timed out:', error.message);
      yield "I'm having trouble processing that right now. Please try again.";
      return;
    }

    console.log('[VoiceService] Gemini API stream started', {
      duration: Date.now() - geminiStartTime,
    });

    // [Checkpoint 14] Response streaming with timeout protection
    let chunkCount = 0;
    const streamStartTime = Date.now();
    
    try {
    for await (const chunk of result.stream) {
        // Check for overall timeout (prevents infinite "thinking")
        if (Date.now() - streamStartTime > this.LLM_REQUEST_TIMEOUT_MS) {
          console.error('[VoiceService] Stream consumption timed out');
          break;
        }
        
      const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        chunkCount++;
        yield text;
      }
      }
    } catch (error: any) {
      console.error('[VoiceService] Stream consumption error:', error.message);
      // Don't throw - just stop yielding chunks
    }

    console.log('[VoiceService] Voice response stream completed', {
      chunkCount,
      totalDuration: Date.now() - startTime,
    });
  }
}

