import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
  HttpException,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

// Multer file type for TypeScript
interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

import { CurrentTenant } from '../tenant/tenant.decorator';
import { JwtAuthGuard, TenantGuard } from '../tenant/tenant.guard';
import { DocumentsService } from './documents.service';
import { RateLimitService, RATE_LIMITS } from '../common/rate-limit.service';

/**
 * ============================================================================
 * COST PROTECTIONS FOR DOCUMENTS:
 * ============================================================================
 * 1. Upload rate limiting: 10 uploads/hour per tenant
 * 2. Max documents per tenant: 100
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

  /**
   * Upload a document directly to File Search Store
   * POST /documents/upload
   * Content-Type: multipart/form-data
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 25 * 1024 * 1024, // 25MB max
      },
    }),
  )
  async uploadDocument(
    @CurrentTenant() tenantId: string,
    @UploadedFile() file: MulterFile,
  ) {
    if (!file) {
      throw new HttpException(
        {
          error: 'no_file',
          message: 'No file uploaded',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // === COST PROTECTION: Validate file type ===
    if (!file.mimetype?.includes('pdf')) {
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
    const uploadCheck = this.rateLimitService.checkDocumentUploadLimit(
      tenantId,
      file.size,
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

    // Record the upload for rate limiting
    this.rateLimitService.recordDocumentUpload(tenantId, file.size);

    try {
      // Upload to File Search Store
      const document = await this.documents.uploadDocument(
        tenantId,
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      return {
        document,
        usage: this.rateLimitService.getUsageStats(tenantId),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      throw new HttpException(
        {
          error: 'upload_failed',
          message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Legacy endpoint for backward compatibility
   * Returns an error directing to new upload endpoint
   */
  @Post('upload-url')
  async getUploadUrl() {
    throw new HttpException(
      {
        error: 'deprecated',
        message:
          'This endpoint is deprecated. Use POST /documents/upload with multipart/form-data instead.',
      },
      HttpStatus.GONE,
    );
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
      throw new HttpException(
        {
          error: 'not_found',
          message: 'Document not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return found;
  }

  @Delete(':id')
  async delete(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    // Get file size before deletion to update storage tracking
    const doc = await this.documents.findOneByTenant(tenantId, id);
    if (!doc) {
      throw new HttpException(
        {
          error: 'not_found',
          message: 'Document not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    this.rateLimitService.recordDocumentDeletion(tenantId, doc.sizeBytes || 0);
    await this.documents.deleteDocument(tenantId, id);

    return {
      success: true,
      usage: this.rateLimitService.getUsageStats(tenantId),
    };
  }
}
