import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { Message } from '@wheelpath/schemas';

import { MetricsService } from '../metrics/metrics.service';
import { TenantService } from '../tenant/tenant.service';
import { PILOT_TRADES } from '../common/constants';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * RagService - Chat with documents using File Search API
 *
 * Flow:
 * 1. Get tenant's File Search Store
 * 2. Send query to Gemini with fileSearch tool
 * 3. Gemini automatically retrieves relevant context
 * 4. Extract citations from groundingMetadata
 * 5. Stream response back to client
 */

interface GroundingChunk {
  retrievedContext?: {
    uri: string;
    title: string;
  };
}

interface Citation {
  index: number;
  title: string;
  uri: string;
}

@Injectable()
export class RagService {
  private ai: GoogleGenAI;

  // Cost protection: request timeout (30 seconds)
  private readonly REQUEST_TIMEOUT_MS = 30000;

  // Model to use (File Search requires 2.5+ models)
  private readonly MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  constructor(
    private readonly metricsService: MetricsService,
    private readonly tenantService: TenantService,
  ) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }

    this.ai = new GoogleGenAI({ apiKey });

    console.log(`RagService initialized with File Search (model: ${this.MODEL})`);
  }

  /**
   * Stream a chat response using File Search for retrieval
   */
  async chatStream(tenantId: string, documentId: string, query: string, history: Message[]) {
    // Get the tenant's File Search Store
    const storeName = await this.tenantService.getFileSearchStore(tenantId);

    // Build the system instruction (WheelPath voice profile)
    const systemInstruction = this.buildSystemInstruction(!!storeName);

    // Build conversation contents
    const contents = this.buildContents(history, query);

    // Prepare the generation config
    const config: any = {
      systemInstruction,
      generationConfig: {
        maxOutputTokens: 2000, // Cost guardrail
      },
    };

    // Only add File Search tool if tenant has a store with documents
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
      // Add timeout protection
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('LLM request timeout')), this.REQUEST_TIMEOUT_MS);
      });

      // Generate content with streaming
      const responsePromise = this.ai.models.generateContentStream({
        model: this.MODEL,
        contents,
        config,
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);

      // Track usage metrics (non-blocking)
      this.metricsService
        .track({
          type: 'chat_query',
          tenantId,
          documentId: documentId === 'all' ? undefined : documentId,
          metadata: {
            queryLength: query.length,
          },
        })
        .catch((err: Error) => console.warn('Metrics tracking failed:', err.message));

      // Return stream and a function to extract citations after streaming
      return {
        stream: this.transformStream(response),
        citations: [] as Citation[], // Citations come from groundingMetadata in stream
      };
    } catch (error: any) {
      console.error('LLM streaming failed:', error.message);

      // Return fallback stream on error
      return {
        stream: this.createFallbackStream(error),
        citations: [],
      };
    }
  }

  /**
   * Transform the SDK stream to our expected format
   */
  private async *transformStream(response: any) {
    try {
      for await (const chunk of response) {
        // Extract text from the chunk
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          yield {
            candidates: [
              {
                content: {
                  parts: [{ text }],
                },
              },
            ],
          };
        }

        // Extract grounding metadata for citations
        const groundingMetadata = chunk.candidates?.[0]?.groundingMetadata;
        if (groundingMetadata?.groundingChunks) {
          const citations = this.extractCitations(groundingMetadata.groundingChunks);
          if (citations.length > 0) {
            yield {
              citations,
            };
          }
        }
      }
    } catch (error: any) {
      console.error('Stream processing error:', error.message);
      yield {
        candidates: [
          {
            content: {
              parts: [{ text: '\n\n[Response interrupted. Please try again.]' }],
            },
          },
        ],
      };
    }
  }

  /**
   * Extract citations from grounding chunks
   */
  private extractCitations(groundingChunks: GroundingChunk[]): Citation[] {
    return groundingChunks
      .filter((chunk) => chunk.retrievedContext)
      .map((chunk, index) => ({
        index: index + 1,
        title: chunk.retrievedContext!.title || 'Document',
        uri: chunk.retrievedContext!.uri || '',
      }));
  }

  /**
   * Create a fallback stream for error cases
   */
  private async *createFallbackStream(error: any) {
    const message =
      error.message?.includes('429') || error.message?.includes('quota')
        ? "I've hit my rate limit for now. Please wait a moment and try again. Your documents are ready — just give me a few seconds."
        : error.message?.includes('timeout')
          ? 'That took longer than expected. Let me try again with a shorter response.'
          : 'I ran into a temporary issue. Please try again in a moment. Get Clarity. Go Build.';

    yield {
      candidates: [
        {
          content: {
            parts: [{ text: message }],
          },
        },
      ],
    };
  }

  /**
   * Build conversation contents from history and query
   */
  private buildContents(history: Message[], query: string) {
    const contents = history.map((msg) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Add the current query
    contents.push({
      role: 'user',
      parts: [{ text: query }],
    });

    return contents;
  }

  /**
   * Build the WheelPath system instruction
   */
  private buildSystemInstruction(hasDocuments: boolean): string {
    if (hasDocuments) {
      return `You are WheelPath AI — the calm, experienced field mentor for construction professionals.

CORE IDENTITY:
You have two superpowers:
1. Finding the right information instantly from project documents
2. Turning that information into clear, confident next steps that reduce rework, risk, and chaos

Tagline encoded into tone: "Get Clarity. Go Build."

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented
- Friendly but professional
- Never rushed, never panicked
- Supportive without being fluffy
- Empathetic to field constraints (long days, shifting priorities, moving targets)

AVOID:
- Corporate buzzwords ("synergy," "leverage," "optimize," "digital transformation")
- Legalese or overly technical jargon
- Overconfidence without evidence
- Guessing or hallucinating — only state what's in the documents
- Criticizing stakeholders

RESPONSE PATTERN:
Data → Meaning → Action
1. State the facts from the documents
2. Explain what it means for the user
3. Give a clear next step if relevant

AMBIGUITY HANDLING:
If the retrieved documents are ambiguous (e.g., an RFI mentions 'the wall' but doesn't specify which one), do NOT guess. Instead, ask the user a specific clarifying question to narrow down the context.

IMPLICATIONS ANALYSIS (CRITICAL):
You are the "Virtual General Superintendent." For every query, you must analyze the retrieved facts for specific implications to the following Pilot Trades:
${PILOT_TRADES.map((t) => `- ${t}`).join('\n')}

If you find a fact that impacts one of these trades (e.g., a dimension change affecting Concrete volume, or a wall move affecting Plumbing rough-in), you MUST explicitly state it in a dedicated "Implications" section.

Structure your response as follows:
### The Facts
*   [Fact 1 from documents]
*   [Fact 2 from documents]

### The Implications
*   **[Trade Name]:** [Specific impact on cost, schedule, or coordination]
*   **[Trade Name]:** [Specific impact]
(Only include trades with actual implications. If none, omit this section.)

CITATION RULES:
- The system automatically retrieves relevant document content
- Reference the source documents when citing information
- If the answer isn't in the documents, say "I don't have that information in your documents yet."

COMMON PHRASES TO USE:
- "Here's what the data shows."
- "Based on the documents you shared…"
- "This keeps your project on track."
- "This protects your margin."
- "Next step:"
- "You're good to go."
- "Let's keep things moving."

STRUCTURAL HABITS:
- Confirm the user's request briefly
- Pull relevant facts with citations
- Present clear, neutral findings
- Give one actionable next step if relevant
- End with reassurance when appropriate ("You're in good shape.", "Let's get it done.")

FORMAT FOR TEXT:
- You may use short paragraphs for readability
- You may use simple lists when comparing multiple items
- Keep responses concise — respect the user's time
- Every response should produce clarity and confidence — not more tasks`;
    } else {
      return `You are WheelPath AI — the calm, experienced field mentor for construction professionals.

CORE IDENTITY:
You help trade contractors and project teams navigate construction complexity with clarity and confidence.

Tagline: "Get Clarity. Go Build."

TONE:
- Calm, steady, and reassuring
- Practical and solutions-oriented
- Friendly but professional
- Empathetic to field constraints

CURRENT STATUS:
The user hasn't uploaded project documents yet.

YOUR JOB:
- Help with general construction questions
- Encourage them to upload documents for project-specific, grounded answers
- Be helpful, professional, and concise
- Say something like: "Once you upload your project documents, I can give you specific answers grounded in your data."

Remember: Every response should produce clarity and confidence.`;
    }
  }
}
