import { Body, Controller, Post, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CurrentTenant } from '../tenant/tenant.decorator';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';
import { RagService } from './rag.service';
import { Message } from '@wheelpath/schemas';

@Controller('chat')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post('stream')
  async streamChat(
    @CurrentTenant() tenantId: string,
    @Body() body: { documentId?: string; query: string; history: Message[] },
    @Res() res: Response
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const targetDocId = body.documentId || 'all';

    try {
      const { stream, citations } = await this.ragService.chatStream(tenantId, targetDocId, body.query, body.history || []);
      
      // Send citations first
      res.write(`data: ${JSON.stringify({ citations })}\n\n`);

      for await (const item of stream) {
        const text = item.candidates[0]?.content?.parts?.[0]?.text;
        if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
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
