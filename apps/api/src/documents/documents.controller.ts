import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import { CurrentTenant } from '../tenant/tenant.decorator';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';
import { DocumentsService } from './documents.service';
import { RateLimitService, RATE_LIMITS } from '../common/rate-limit.service';

/**
 * ============================================================================
 * COST PROTECTIONS FOR DOCUMENTS:
 * ============================================================================
 * 1. Upload rate limiting: 10 uploads/hour per tenant
 * 2. Max documents per tenant: 50
 * 3. Max file size: 25MB
 * 4. Max storage per tenant: 500MB
 * 5. Allowed file types: PDF only
 */

@Controller('documents')
@UseGuards(JwtAuthGuard, TenantGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('upload-url')
  async getUploadUrl(
    @CurrentTenant() tenantId: string,
    @Body() body: { filename: string; contentType: string; fileSize?: number },
  ) {
    // === COST PROTECTION: Validate file type ===
    if (!body.contentType?.includes('pdf')) {
      throw new HttpException(
        {
          error: 'invalid_file_type',
          message: 'Only PDF files are allowed.',
          allowedTypes: ['application/pdf'],
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // === COST PROTECTION: Get current document count ===
    const currentDocs = await this.documents.findAllByTenant(tenantId);
    const currentDocCount = currentDocs.length;

    // === COST PROTECTION: Check upload limits ===
    const fileSizeBytes = body.fileSize || 0;
    const uploadCheck = this.rateLimitService.checkDocumentUploadLimit(
      tenantId,
      fileSizeBytes,
      currentDocCount,
    );

    if (!uploadCheck.allowed) {
      throw new HttpException(
        {
          error: 'upload_limit_reached',
          message: uploadCheck.reason,
          limits: {
            maxDocuments: RATE_LIMITS.DOCS_PER_TENANT_MAX,
            maxFileSizeMB: RATE_LIMITS.DOC_MAX_SIZE_MB,
            maxStorageMB: RATE_LIMITS.STORAGE_PER_TENANT_MB,
            uploadsPerHour: RATE_LIMITS.DOCS_UPLOADS_PER_HOUR,
          },
          current: {
            documentCount: currentDocCount,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Record the upload
    this.rateLimitService.recordDocumentUpload(tenantId, fileSizeBytes);

    // Generate upload URL
    const result = await this.documents.generateUploadUrl(tenantId, body.filename, body.contentType);

    // Return with usage info
    return {
      ...result,
      usage: this.rateLimitService.getUsageStats(tenantId),
    };
  }

  @Get()
  async getAll(@CurrentTenant() tenantId: string) {
    const docs = await this.documents.findAllByTenant(tenantId);
    return {
      documents: docs,
      usage: this.rateLimitService.getUsageStats(tenantId),
      limits: {
        maxDocuments: RATE_LIMITS.DOCS_PER_TENANT_MAX,
        maxFileSizeMB: RATE_LIMITS.DOC_MAX_SIZE_MB,
      },
    };
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
    // Get file size before deletion to update storage tracking
    const doc = await this.documents.findOneByTenant(tenantId, id);
    if (doc) {
      // Estimate file size from stats if available, otherwise use 0
      // In production, you'd store actual file size in Firestore
      const estimatedSize = 1024 * 1024; // Default 1MB estimate
      this.rateLimitService.recordDocumentDeletion(tenantId, estimatedSize);
    }

    await this.documents.deleteDocument(tenantId, id);
    return {
      success: true,
      usage: this.rateLimitService.getUsageStats(tenantId),
    };
  }

  @Post(':id/process')
  async processDocument(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const result = await this.documents.processDocument(tenantId, id);
    if (!result.success) {
      throw new HttpException(
        { error: 'processing_failed', message: result.error },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    return { success: true };
  }
}
