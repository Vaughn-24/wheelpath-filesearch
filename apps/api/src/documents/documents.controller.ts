import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentTenant } from '../tenant/tenant.decorator';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';
import { DocumentsService } from './documents.service';

@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('upload-url')
  getUploadUrl(
    @CurrentTenant() tenantId: string,
    @Body() body: { filename: string; contentType: string },
  ) {
    return this.documents.generateUploadUrl(tenantId, body.filename, body.contentType);
  }

  @Get()
  getAll(@CurrentTenant() tenantId: string) {
    return this.documents.findAllByTenant(tenantId);
  }

  @Get(':id')
  async getOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const found = await this.documents.findOneByTenant(tenantId, id);
    if (!found) {
      return { error: 'Not found' };
    }
    return found;
  }

  @Delete(':id')
  async delete(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    await this.documents.deleteDocument(tenantId, id);
    return { success: true };
  }
}
