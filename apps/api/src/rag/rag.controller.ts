import { Body, Controller, Post, Res, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';
import { RagService } from './rag.service';
import { RateLimitService, RATE_LIMITS } from '../common/rate-limit.service';
import { Message } from '@wheelpath/schemas';

/**
 * ============================================================================
 * COST PROTECTIONS FOR CHAT:
 * ============================================================================
 * 1. Rate limiting: 60 queries/hour per tenant
 * 2. Query length limit: 2000 characters max
 * 3. History limit: Last 20 messages only
 * 4. Response timeout: 30 seconds (handled by client)
 * 5. LLM call tracking for cost monitoring
 */

@Controller('chat')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('stream')
  async streamChat(
    @CurrentTenant() tenantId: string,
    @Body() body: { documentId?: string; query: string; history: Message[] },
    @Res() res: Response,
  ) {
    // === COST PROTECTION: Rate Limiting ===
    const rateCheck = this.rateLimitService.checkChatLimit(tenantId);
    if (!rateCheck.allowed) {
      throw new HttpException(
        {
          error: 'rate_limited',
          message: rateCheck.reason,
          remaining: 0,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // === COST PROTECTION: Query Length ===
    const queryCheck = this.rateLimitService.validateQueryLength(body.query || '');
    if (!queryCheck.valid) {
      throw new HttpException(
        {
          error: 'query_too_long',
          message: queryCheck.reason,
          maxLength: RATE_LIMITS.CHAT_QUERY_MAX_LENGTH,
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // === COST PROTECTION: Trim History ===
    const trimmedHistory = this.rateLimitService.validateHistory(body.history || []);

    // === COST PROTECTION: Check LLM limit ===
    const llmCheck = this.rateLimitService.checkLLMLimit(tenantId);
    if (!llmCheck.allowed) {
      throw new HttpException(
        {
          error: 'llm_limit_reached',
          message: llmCheck.reason,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Send rate limit info in headers
    res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining || 0));
    res.setHeader('X-RateLimit-Limit', String(RATE_LIMITS.CHAT_QUERIES_PER_HOUR));

    const targetDocId = body.documentId || 'all';

    try {
      // Record the query for rate limiting
      this.rateLimitService.recordChatQuery(tenantId);
      this.rateLimitService.recordLLMCall(tenantId);

      const { stream, citations } = await this.ragService.chatStream(
        tenantId,
        targetDocId,
        body.query,
        trimmedHistory,
      );

      // Send citations and rate limit info first
      res.write(
        `data: ${JSON.stringify({
          citations,
          rateLimit: {
            remaining: (rateCheck.remaining || 1) - 1,
            limit: RATE_LIMITS.CHAT_QUERIES_PER_HOUR,
          },
        })}\n\n`,
      );

      let totalResponseLength = 0;
      const maxResponseChars = RATE_LIMITS.CHAT_RESPONSE_MAX_TOKENS * 4; // ~4 chars per token

      for await (const item of stream) {
        // Type assertion for dynamic stream items
        const streamItem = item as { candidates?: { content?: { parts?: { text?: string }[] } }[]; citations?: unknown[] };

        // Handle text chunks
        const text = streamItem.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          totalResponseLength += text.length;

          // Truncate if response is too long
          if (totalResponseLength > maxResponseChars) {
            const truncatedText = text.slice(0, maxResponseChars - (totalResponseLength - text.length));
            res.write(`data: ${JSON.stringify({ text: truncatedText, truncated: true })}\n\n`);
            break;
          }

          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }

        // Handle citation updates from File Search groundingMetadata
        if (streamItem.citations && streamItem.citations.length > 0) {
          res.write(`data: ${JSON.stringify({ citations: streamItem.citations })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      console.error(error);
      res.write(`data: ${JSON.stringify({ error: 'Processing failed' })}\n\n`);
      res.end();
    }
  }
}
