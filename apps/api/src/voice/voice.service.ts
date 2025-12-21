import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { MetricsService } from '../metrics/metrics.service';
import { TenantService } from '../tenant/tenant.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * VoiceService - Voice agent using File Search API
 *
 * This service is SEPARATE from RagService to ensure:
 * 1. No interference with existing chat functionality
 * 2. Voice-optimized prompt construction (concise, no citations)
 * 3. Independent scaling and error handling
 */
@Injectable()
export class VoiceService {
  private ai: GoogleGenAI | null = null;

  // Model for voice (uses File Search)
  private readonly MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  constructor(
    private readonly metricsService: MetricsService,
    private readonly tenantService: TenantService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
      console.log(`VoiceService: Initialized with File Search (model: ${this.MODEL})`);
    } else {
      console.warn('VoiceService: GEMINI_API_KEY not set');
    }
  }

  /**
   * WheelPath Voice Profile - System Prompt
   *
   * Core Identity: The calm, experienced field mentor who understands
   * construction documents, project realities, and trade contractor workloads.
   *
   * Tagline: "Get Clarity. Go Build."
   */
  private buildVoiceSystemPrompt(hasDocuments: boolean): string {
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

    if (hasDocuments) {
      return `${voiceProfile}

The system automatically retrieves relevant context from the user's project documents using File Search.
Answer the user's question using the retrieved context. If the answer isn't available, say "I don't have that information in your documents yet."`;
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
    transcribedText: string,
  ): Promise<string> {
    if (!this.ai) {
      return 'Voice service is being configured. Please try again shortly.';
    }

    // Check if tenant has a File Search store
    const storeName = await this.tenantService.getFileSearchStore(tenantId);
    const hasDocuments = !!storeName;

    // Build voice-optimized prompt
    const systemInstruction = this.buildVoiceSystemPrompt(hasDocuments);

    // Prepare config
    const config: any = {
      systemInstruction,
      generationConfig: {
        maxOutputTokens: 500, // Shorter for voice
      },
    };

    // Add File Search tool if tenant has documents
    if (storeName) {
      config.tools = [
        {
          fileSearch: {
            fileSearchStoreNames: [storeName],
          },
        },
      ];
    }

    try {
      const response = await this.ai.models.generateContent({
        model: this.MODEL,
        contents: [{ role: 'user', parts: [{ text: transcribedText }] }],
        config,
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || 'I could not process that. Please try again.';

      // Track metrics (non-blocking)
      this.metricsService
        .track({
          type: 'voice_query',
          tenantId,
          documentId: documentId === 'all' ? undefined : documentId,
          metadata: {
            queryLength: transcribedText.length,
            responseLength: text.length,
          },
        })
        .catch((err: Error) => console.warn('Voice metrics failed:', err.message));

      return text;
    } catch (error: any) {
      console.error('VoiceService: Generation failed:', error.message);
      return 'I ran into a temporary issue. Please try again in a moment.';
    }
  }

  /**
   * Stream voice response for lower perceived latency
   */
  async *streamVoiceResponse(
    tenantId: string,
    _documentId: string, // Unused but kept for API compatibility
    transcribedText: string,
  ): AsyncGenerator<string> {
    if (!this.ai) {
      yield 'Voice service is being configured.';
      return;
    }

    // Check if tenant has a File Search store
    const storeName = await this.tenantService.getFileSearchStore(tenantId);
    const hasDocuments = !!storeName;

    const systemInstruction = this.buildVoiceSystemPrompt(hasDocuments);

    const config: any = {
      systemInstruction,
      generationConfig: {
        maxOutputTokens: 500,
      },
    };

    if (storeName) {
      config.tools = [
        {
          fileSearch: {
            fileSearchStoreNames: [storeName],
          },
        },
      ];
    }

    try {
      const response = await this.ai.models.generateContentStream({
        model: this.MODEL,
        contents: [{ role: 'user', parts: [{ text: transcribedText }] }],
        config,
      });

      for await (const chunk of response) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          yield text;
        }
      }
    } catch (error: any) {
      console.error('VoiceService: Stream failed:', error.message);
      yield 'I ran into a temporary issue. Please try again.';
    }
  }
}
