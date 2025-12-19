import { Injectable } from '@nestjs/common';

/**
 * ============================================================================
 * COST PROTECTION: Rate Limiting Service
 * ============================================================================
 * Shared rate limiting across all features (chat, voice, documents)
 * Uses in-memory storage (resets on deploy - acceptable for dev/small scale)
 *
 * For production at scale, consider Redis-based rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface TenantUsage {
  // Chat limits
  chatQueries: RateLimitEntry;
  // Document limits
  documentsUploaded: RateLimitEntry;
  totalStorageBytes: number;
  // Voice limits (tracked in voice.gateway.ts)
  // API call tracking
  embeddingCalls: RateLimitEntry;
  llmCalls: RateLimitEntry;
}

// Configurable limits via environment variables
export const RATE_LIMITS = {
  // Chat limits
  CHAT_QUERIES_PER_HOUR: parseInt(process.env.CHAT_QUERIES_PER_HOUR || '60'),
  CHAT_QUERY_MAX_LENGTH: parseInt(process.env.CHAT_QUERY_MAX_LENGTH || '2000'),
  CHAT_HISTORY_MAX_MESSAGES: parseInt(process.env.CHAT_HISTORY_MAX_MESSAGES || '20'),
  CHAT_RESPONSE_MAX_TOKENS: parseInt(process.env.CHAT_RESPONSE_MAX_TOKENS || '2000'),

  // Document limits
  DOCS_PER_TENANT_MAX: parseInt(process.env.DOCS_PER_TENANT_MAX || '50'),
  DOCS_UPLOADS_PER_HOUR: parseInt(process.env.DOCS_UPLOADS_PER_HOUR || '10'),
  DOC_MAX_SIZE_MB: parseInt(process.env.DOC_MAX_SIZE_MB || '25'),
  DOC_MAX_PAGES: parseInt(process.env.DOC_MAX_PAGES || '200'),
  STORAGE_PER_TENANT_MB: parseInt(process.env.STORAGE_PER_TENANT_MB || '500'),

  // Embedding/LLM limits (shared across features)
  EMBEDDING_CALLS_PER_HOUR: parseInt(process.env.EMBEDDING_CALLS_PER_HOUR || '200'),
  LLM_CALLS_PER_HOUR: parseInt(process.env.LLM_CALLS_PER_HOUR || '100'),
};

@Injectable()
export class RateLimitService {
  private tenantUsage = new Map<string, TenantUsage>();

  private getOrCreateUsage(tenantId: string): TenantUsage {
    if (!this.tenantUsage.has(tenantId)) {
      const now = Date.now();
      this.tenantUsage.set(tenantId, {
        chatQueries: { count: 0, resetAt: now + 3600000 },
        documentsUploaded: { count: 0, resetAt: now + 3600000 },
        totalStorageBytes: 0,
        embeddingCalls: { count: 0, resetAt: now + 3600000 },
        llmCalls: { count: 0, resetAt: now + 3600000 },
      });
    }
    return this.tenantUsage.get(tenantId)!;
  }

  private checkAndResetIfNeeded(entry: RateLimitEntry): void {
    if (Date.now() > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = Date.now() + 3600000; // Reset for next hour
    }
  }

  /**
   * Check if a chat query is allowed
   */
  checkChatLimit(tenantId: string): { allowed: boolean; reason?: string; remaining?: number } {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.chatQueries);

    if (usage.chatQueries.count >= RATE_LIMITS.CHAT_QUERIES_PER_HOUR) {
      const resetIn = Math.ceil((usage.chatQueries.resetAt - Date.now()) / 60000);
      return {
        allowed: false,
        reason: `Chat limit reached (${RATE_LIMITS.CHAT_QUERIES_PER_HOUR}/hour). Resets in ${resetIn} minutes.`,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      remaining: RATE_LIMITS.CHAT_QUERIES_PER_HOUR - usage.chatQueries.count,
    };
  }

  /**
   * Record a chat query
   */
  recordChatQuery(tenantId: string): void {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.chatQueries);
    usage.chatQueries.count++;
  }

  /**
   * Check if document upload is allowed
   */
  checkDocumentUploadLimit(
    tenantId: string,
    fileSizeBytes: number,
    currentDocCount: number,
  ): { allowed: boolean; reason?: string } {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.documentsUploaded);

    // Check hourly upload limit
    if (usage.documentsUploaded.count >= RATE_LIMITS.DOCS_UPLOADS_PER_HOUR) {
      const resetIn = Math.ceil((usage.documentsUploaded.resetAt - Date.now()) / 60000);
      return {
        allowed: false,
        reason: `Upload limit reached (${RATE_LIMITS.DOCS_UPLOADS_PER_HOUR}/hour). Resets in ${resetIn} minutes.`,
      };
    }

    // Check total document count
    if (currentDocCount >= RATE_LIMITS.DOCS_PER_TENANT_MAX) {
      return {
        allowed: false,
        reason: `Maximum documents reached (${RATE_LIMITS.DOCS_PER_TENANT_MAX}). Delete some documents to upload more.`,
      };
    }

    // Check file size
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    if (fileSizeMB > RATE_LIMITS.DOC_MAX_SIZE_MB) {
      return {
        allowed: false,
        reason: `File too large (${fileSizeMB.toFixed(1)}MB). Maximum is ${RATE_LIMITS.DOC_MAX_SIZE_MB}MB.`,
      };
    }

    // Check total storage
    const newTotalMB = (usage.totalStorageBytes + fileSizeBytes) / (1024 * 1024);
    if (newTotalMB > RATE_LIMITS.STORAGE_PER_TENANT_MB) {
      return {
        allowed: false,
        reason: `Storage limit reached (${RATE_LIMITS.STORAGE_PER_TENANT_MB}MB). Delete some documents to free space.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a document upload
   */
  recordDocumentUpload(tenantId: string, fileSizeBytes: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.documentsUploaded);
    usage.documentsUploaded.count++;
    usage.totalStorageBytes += fileSizeBytes;
  }

  /**
   * Record document deletion (free up storage)
   */
  recordDocumentDeletion(tenantId: string, fileSizeBytes: number): void {
    const usage = this.getOrCreateUsage(tenantId);
    usage.totalStorageBytes = Math.max(0, usage.totalStorageBytes - fileSizeBytes);
  }

  /**
   * Check embedding API limit
   */
  checkEmbeddingLimit(tenantId: string): { allowed: boolean; reason?: string } {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.embeddingCalls);

    if (usage.embeddingCalls.count >= RATE_LIMITS.EMBEDDING_CALLS_PER_HOUR) {
      return {
        allowed: false,
        reason: `Embedding API limit reached. Please try again later.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record embedding API call
   */
  recordEmbeddingCall(tenantId: string): void {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.embeddingCalls);
    usage.embeddingCalls.count++;
  }

  /**
   * Check LLM API limit
   */
  checkLLMLimit(tenantId: string): { allowed: boolean; reason?: string } {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.llmCalls);

    if (usage.llmCalls.count >= RATE_LIMITS.LLM_CALLS_PER_HOUR) {
      return {
        allowed: false,
        reason: `Chat API limit reached. Please try again later.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record LLM API call
   */
  recordLLMCall(tenantId: string): void {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.llmCalls);
    usage.llmCalls.count++;
  }

  /**
   * Get current usage stats for a tenant
   */
  getUsageStats(tenantId: string): {
    chatQueriesRemaining: number;
    uploadsRemaining: number;
    storageMBUsed: number;
    storageMBLimit: number;
  } {
    const usage = this.getOrCreateUsage(tenantId);
    this.checkAndResetIfNeeded(usage.chatQueries);
    this.checkAndResetIfNeeded(usage.documentsUploaded);

    return {
      chatQueriesRemaining: Math.max(
        0,
        RATE_LIMITS.CHAT_QUERIES_PER_HOUR - usage.chatQueries.count,
      ),
      uploadsRemaining: Math.max(
        0,
        RATE_LIMITS.DOCS_UPLOADS_PER_HOUR - usage.documentsUploaded.count,
      ),
      storageMBUsed: usage.totalStorageBytes / (1024 * 1024),
      storageMBLimit: RATE_LIMITS.STORAGE_PER_TENANT_MB,
    };
  }

  /**
   * Validate query length
   */
  validateQueryLength(query: string): { valid: boolean; reason?: string } {
    if (query.length > RATE_LIMITS.CHAT_QUERY_MAX_LENGTH) {
      return {
        valid: false,
        reason: `Query too long (${query.length} chars). Maximum is ${RATE_LIMITS.CHAT_QUERY_MAX_LENGTH} characters.`,
      };
    }
    return { valid: true };
  }

  /**
   * Validate and trim chat history
   * Keeps only the last N messages
   */
  validateHistory<T extends { role: string; content: string }>(history: T[]): T[] {
    // Keep only the last N messages
    if (history.length > RATE_LIMITS.CHAT_HISTORY_MAX_MESSAGES) {
      return history.slice(-RATE_LIMITS.CHAT_HISTORY_MAX_MESSAGES);
    }
    return history;
  }
}
