import { Body, Controller, HttpCode, Post, UnprocessableEntityException } from '@nestjs/common';
import { RfiSchema } from '@wheelpath/validation';
import type { Rfi } from '@wheelpath/types';
import { InMemoryRfiRepository } from './rfi.repository';

@Controller('rfi')
export class RfiController {
  constructor(private readonly repo: InMemoryRfiRepository) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const parsed = RfiSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        error: 'ValidationError',
        issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const rfi: Rfi = parsed.data as Rfi;
    const created = await this.repo.create(rfi);
    return { ok: true, id: created.id };
  }
}
