import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { MetricsService } from '../metrics/metrics.service';
import { TenantService } from '../tenant/tenant.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Available Gemini TTS Voices
 * See: https://ai.google.dev/gemini-api/docs/speech-generation
 */
export const GEMINI_VOICES = {
  // Bright, upbeat voices
  PUCK: 'Puck',
  CHARON: 'Charon',
  KORE: 'Kore',
  FENRIR: 'Fenrir',
  AOEDE: 'Aoede',
  
  // Calm, professional voices (recommended for WheelPath)
  ORBIT: 'Orbit',      // Neutral, clear
  SULAFAT: 'Sulafat',  // Warm, approachable
  GACRUX: 'Gacrux',    // Professional, confident
  PULCHERRIMA: 'Pulcherrima', // Calm, reassuring
  
  // Expressive voices
  LEDA: 'Leda',
  ORUS: 'Orus',
  ZEPHYR: 'Zephyr',
} as const;

// Default voice for WheelPath - calm, professional
const DEFAULT_VOICE = process.env.GEMINI_VOICE || GEMINI_VOICES.ORBIT;

// Model that supports native TTS
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/**
 * VoiceService - Voice agent using Gemini File Search + Native TTS
 *
 * This service uses Gemini's native TTS capabilities for natural-sounding speech.
 * It maintains compatibility with File Search for document retrieval.
 * 
 * Architecture:
 * 1. First call: Generate text response with File Search (for RAG)
 * 2. Second call: Generate audio from text with Gemini TTS
 * 
 * This two-step approach ensures File Search works (text-only) while
 * still using Gemini's superior TTS for audio generation.
 */
@Injectable()
export class VoiceService {
  private ai: GoogleGenAI | null = null;

  // Model for text generation with File Search
  private readonly TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';
  
  // Voice for TTS
  private readonly VOICE = DEFAULT_VOICE;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly tenantService: TenantService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
      console.log(`VoiceService: Initialized with Gemini TTS (voice: ${this.VOICE})`);
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
   * Generate text response using File Search
   * This is step 1 of the two-step voice process
   */
  async generateTextWithFileSearch(
    tenantId: string,
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

    // Prepare config for text generation with File Search
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
        model: this.TEXT_MODEL,
        contents: [{ role: 'user', parts: [{ text: transcribedText }] }],
        config,
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || 
        'I could not process that. Please try again.';

      return text;
    } catch (error: any) {
      console.error('VoiceService: Text generation failed:', error.message);
      return 'I ran into a temporary issue. Please try again in a moment.';
    }
  }

  /**
   * Generate audio from text using Gemini's native TTS
   * This is step 2 of the two-step voice process
   * 
   * @returns Base64-encoded WAV audio or null on failure
   */
  async generateAudioFromText(text: string): Promise<{ audio: string; mimeType: string } | null> {
    if (!this.ai) {
      return null;
    }

    try {
      const response = await this.ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ 
          role: 'user', 
          parts: [{ text }] 
        }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.VOICE,
              },
            },
          },
        },
      });

      // Extract audio from response
      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      
      if (audioData?.data && audioData?.mimeType) {
        return {
          audio: audioData.data,
          mimeType: audioData.mimeType,
        };
      }

      console.warn('VoiceService: No audio data in response');
      return null;
    } catch (error: any) {
      console.error('VoiceService: Audio generation failed:', error.message);
      return null;
    }
  }

  /**
   * Process a complete voice query: File Search → Text → Audio
   * Returns both text and audio for the response
   */
  async processVoiceQuery(
    tenantId: string,
    documentId: string,
    transcribedText: string,
  ): Promise<{ text: string; audio: string | null; mimeType: string | null }> {
    // Step 1: Generate text with File Search
    const text = await this.generateTextWithFileSearch(tenantId, transcribedText);

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

    // Step 2: Generate audio from text
    const audioResult = await this.generateAudioFromText(text);

    return {
      text,
      audio: audioResult?.audio || null,
      mimeType: audioResult?.mimeType || null,
    };
  }

  /**
   * Stream text response for lower perceived latency
   * Audio is generated after text streaming completes
   */
  async *streamVoiceResponse(
    tenantId: string,
    _documentId: string,
    transcribedText: string,
  ): AsyncGenerator<{ type: 'text' | 'audio'; data: string; mimeType?: string }> {
    if (!this.ai) {
      yield { type: 'text', data: 'Voice service is being configured.' };
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

    let fullText = '';

    try {
      // Step 1: Stream text with File Search
      const response = await this.ai.models.generateContentStream({
        model: this.TEXT_MODEL,
        contents: [{ role: 'user', parts: [{ text: transcribedText }] }],
        config,
      });

      for await (const chunk of response) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          fullText += text;
          yield { type: 'text', data: text };
        }
      }

      // Step 2: Generate audio from complete text
      if (fullText) {
        const audioResult = await this.generateAudioFromText(fullText);
        if (audioResult) {
          yield { 
            type: 'audio', 
            data: audioResult.audio,
            mimeType: audioResult.mimeType,
          };
        }
      }
    } catch (error: any) {
      console.error('VoiceService: Stream failed:', error.message);
      yield { type: 'text', data: 'I ran into a temporary issue. Please try again.' };
    }
  }

  /**
   * Get the current voice name
   */
  getVoiceName(): string {
    return this.VOICE;
  }
}
