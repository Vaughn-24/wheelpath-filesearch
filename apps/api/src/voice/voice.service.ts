import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

import { MetricsService } from '../metrics/metrics.service';
import { TenantService } from '../tenant/tenant.service';
import { PILOT_TRADES } from '../common/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Available Gemini TTS Voices (must be lowercase)
 * See: https://ai.google.dev/gemini-api/docs/speech-generation
 * Valid voices: achernar, achird, algenib, algieba, alnilam, aoede, autonoe, 
 * callirrhoe, charon, despina, enceladus, erinome, fenrir, gacrux, iapetus, 
 * kore, laomedeia, leda, orus, puck, pulcherrima, rasalgethi, sadachbia, 
 * sadaltager, schedar, sulafat, umbriel, vindemiatrix, zephyr, zubenelgenubi
 */
export const GEMINI_VOICES = {
  // Bright, upbeat voices
  PUCK: 'puck',
  CHARON: 'charon',
  KORE: 'kore',
  FENRIR: 'fenrir',
  AOEDE: 'aoede',
  
  // Calm, professional voices (recommended for WheelPath)
  SULAFAT: 'sulafat',  // Warm, approachable
  GACRUX: 'gacrux',    // Professional, confident
  PULCHERRIMA: 'pulcherrima', // Calm, reassuring
  ENCELADUS: 'enceladus', // Clear
  
  // Expressive voices
  LEDA: 'leda',
  ORUS: 'orus',
  ZEPHYR: 'zephyr',
} as const;

// Default voice for WheelPath - calm, professional
const DEFAULT_VOICE = process.env.GEMINI_VOICE || GEMINI_VOICES.SULAFAT;

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
  private readonly TEXT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  
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

AMBIGUITY HANDLING:
If the retrieved documents are ambiguous, do NOT guess. Ask a specific clarifying question.

IMPLICATIONS ANALYSIS (VOICE OPTIMIZED):
You are the "Virtual General Superintendent." You must analyze the retrieved facts for specific implications to these Pilot Trades:
${PILOT_TRADES.map((t) => `- ${t}`).join('\n')}

If you find a fact that impacts one of these trades, you MUST mention it.
However, for voice, you must be CONCISE. Do not list every single detail.
Pick the top 1-2 most critical implications and explain them naturally.
Example: "Here are the facts... Now, this change in slab thickness means your Concrete team needs to adjust their pour volume, and your Plumbers need to check their sleeve heights before the pour."

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
        console.log(`VoiceService: Generated audio with mimeType: ${audioData.mimeType}, size: ${audioData.data.length} bytes`);
        
        // If the format is raw PCM (audio/L16), we need to wrap it in WAV
        if (audioData.mimeType.includes('L16') || audioData.mimeType.includes('pcm')) {
          console.log('VoiceService: Converting raw PCM to WAV');
          const wavData = this.pcmToWav(audioData.data);
          return {
            audio: wavData,
            mimeType: 'audio/wav',
          };
        }
        
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
   * Stream text response with sentence-by-sentence audio generation
   * Audio is generated for each sentence as it completes, reducing latency
   */
  async *streamVoiceResponse(
    tenantId: string,
    _documentId: string,
    transcribedText: string,
  ): AsyncGenerator<{ type: 'text' | 'audio'; data: string; mimeType?: string; index?: number }> {
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
    let pendingSentence = '';
    let sentenceIndex = 0;
    const audioPromises: Promise<{ index: number; audio: string; mimeType: string } | null>[] = [];

    // Helper to detect sentence boundaries
    const extractCompleteSentences = (text: string): { sentences: string[]; remainder: string } => {
      // Match sentences ending with . ! ? followed by space or end of string
      const sentencePattern = /[^.!?]*[.!?]+(?:\s|$)/g;
      const sentences: string[] = [];
      let lastIndex = 0;
      let match;
      
      while ((match = sentencePattern.exec(text)) !== null) {
        sentences.push(match[0].trim());
        lastIndex = sentencePattern.lastIndex;
      }
      
      return {
        sentences,
        remainder: text.slice(lastIndex),
      };
    };

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
          pendingSentence += text;
          yield { type: 'text', data: text };
          
          // Check for complete sentences
          const { sentences, remainder } = extractCompleteSentences(pendingSentence);
          
          for (const sentence of sentences) {
            if (sentence.length > 5) { // Skip very short fragments
              const currentIndex = sentenceIndex++;
              console.log(`VoiceService: Generating audio for sentence ${currentIndex}: "${sentence.slice(0, 50)}..."`);
              
              // Start audio generation for this sentence (non-blocking)
              const audioPromise = this.generateAudioFromText(sentence)
                .then(result => result ? { index: currentIndex, audio: result.audio, mimeType: result.mimeType } : null)
                .catch(err => {
                  console.warn(`VoiceService: Audio generation failed for sentence ${currentIndex}:`, err.message);
                  return null;
                });
              
              audioPromises.push(audioPromise);
            }
          }
          
          pendingSentence = remainder;
        }
      }

      // Handle any remaining text as the final sentence
      if (pendingSentence.trim().length > 5) {
        const currentIndex = sentenceIndex++;
        console.log(`VoiceService: Generating audio for final sentence ${currentIndex}: "${pendingSentence.slice(0, 50)}..."`);
        
        const audioPromise = this.generateAudioFromText(pendingSentence.trim())
          .then(result => result ? { index: currentIndex, audio: result.audio, mimeType: result.mimeType } : null)
          .catch(err => {
            console.warn(`VoiceService: Audio generation failed for final sentence:`, err.message);
            return null;
          });
        
        audioPromises.push(audioPromise);
      }

      // Yield audio chunks as they complete
      // Use a race-based approach to yield as soon as each one finishes
      const remainingPromises = [...audioPromises];
      const totalChunks = remainingPromises.length;
      
      console.log(`VoiceService: Waiting for ${totalChunks} audio chunks`);
      
      while (remainingPromises.length > 0) {
        // Race to get the first completed promise
        const result = await Promise.race(
          remainingPromises.map((p, i) => p.then(r => ({ result: r, index: i })))
        );
        
        // Remove the completed promise from the array
        remainingPromises.splice(result.index, 1);
        
        if (result.result) {
          console.log(`VoiceService: Audio chunk ${result.result.index} ready (${remainingPromises.length} remaining)`);
          yield { 
            type: 'audio', 
            data: result.result.audio,
            mimeType: result.result.mimeType,
            index: result.result.index,
          };
        }
      }
    } catch (error: any) {
      console.error('VoiceService: Stream failed:', error.message);
      yield { type: 'text', data: 'I ran into a temporary issue. Please try again.' };
    }
  }

  /**
   * Convert raw PCM (16-bit, 24kHz) to WAV format
   * Gemini TTS returns audio/L16;rate=24000 which needs WAV headers for browser playback
   */
  private pcmToWav(base64Pcm: string): string {
    // Decode base64 to bytes
    const pcmBuffer = Buffer.from(base64Pcm, 'base64');
    
    // WAV header parameters (assuming 16-bit mono @ 24kHz from Gemini TTS)
    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBuffer.length;
    const headerSize = 44;
    const fileSize = headerSize + dataSize - 8;
    
    // Create WAV header
    const header = Buffer.alloc(headerSize);
    
    // RIFF chunk
    header.write('RIFF', 0);
    header.writeUInt32LE(fileSize, 4);
    header.write('WAVE', 8);
    
    // fmt sub-chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // fmt chunk size
    header.writeUInt16LE(1, 20); // audio format (PCM = 1)
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    
    // data sub-chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    // Combine header and PCM data
    const wavBuffer = Buffer.concat([header, pcmBuffer]);
    
    return wavBuffer.toString('base64');
  }

  /**
   * Get the current voice name
   */
  getVoiceName(): string {
    return this.VOICE;
  }

  /**
   * Generate a succinct greeting for new voice sessions
   * Returns audio greeting using Gemini TTS
   */
  async generateGreeting(): Promise<{ text: string; audio: string | null; mimeType: string | null }> {
    // Succinct, casual greetings that feel natural
    const greetings = [
      "Hey there. What can I help you with?",
      "Hi. Any questions for me?",
      "Hey. What would you like to know?",
      "Hi there. What's on your mind?",
      "Hey. How can I help?",
    ];

    // Pick a random greeting
    const text = greetings[Math.floor(Math.random() * greetings.length)];

    // Generate audio from the greeting
    const audioResult = await this.generateAudioFromText(text);

    return {
      text,
      audio: audioResult?.audio || null,
      mimeType: audioResult?.mimeType || null,
    };
  }
}
