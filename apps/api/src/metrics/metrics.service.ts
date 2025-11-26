import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

interface UsageEvent {
  type: 'document_processed' | 'chat_query' | 'embedding_generated' | 'vector_search';
  tenantId: string;
  documentId?: string;
  metadata?: {
    chunkCount?: number;
    tokenCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    embeddingChars?: number;
    vectorNeighbors?: number;
    latencyMs?: number;
  };
}

interface CostEstimate {
  embeddingCost: number;
  vectorSearchCost: number;
  geminiCost: number;
  firestoreCost: number;
  totalCost: number;
}

// Pricing constants (USD)
const PRICING = {
  EMBEDDING_PER_MILLION_CHARS: 0.025,
  VECTOR_SEARCH_PER_MILLION_QUERIES: 2.00,
  VECTOR_UPSERT_PER_MILLION: 0.10,
  GEMINI_FLASH_INPUT_PER_MILLION_TOKENS: 0.075,
  GEMINI_FLASH_OUTPUT_PER_MILLION_TOKENS: 0.30,
  FIRESTORE_READ_PER_100K: 0.06,
  FIRESTORE_WRITE_PER_100K: 0.18,
};

@Injectable()
export class MetricsService {
  private readonly logger = new Logger('Metrics');
  private firestore: admin.firestore.Firestore;

  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();
  }

  /**
   * Track a usage event - logs to Cloud Logging and optionally stores in Firestore
   */
  async track(event: UsageEvent): Promise<void> {
    const timestamp = new Date().toISOString();
    const cost = this.estimateCost(event);

    // Structured log for Cloud Logging (visible in GCP Console)
    const logEntry = {
      severity: 'INFO',
      message: `Usage: ${event.type}`,
      labels: {
        type: event.type,
        tenantId: event.tenantId,
        documentId: event.documentId || 'n/a',
      },
      jsonPayload: {
        ...event,
        timestamp,
        estimatedCost: cost,
      },
    };

    // Log to Cloud Logging (appears in GCP Console > Logging)
    this.logger.log(JSON.stringify(logEntry));

    // Store aggregated daily stats in Firestore (for admin dashboard)
    try {
      await this.incrementDailyStats(event, cost);
    } catch (error: any) {
      this.logger.warn(`Failed to store metrics: ${error?.message || error}`);
    }
  }

  /**
   * Estimate cost for an event
   */
  private estimateCost(event: UsageEvent): CostEstimate {
    const meta = event.metadata || {};
    
    let embeddingCost = 0;
    let vectorSearchCost = 0;
    let geminiCost = 0;
    let firestoreCost = 0;

    switch (event.type) {
      case 'document_processed':
        // Embedding cost for all chunks
        if (meta.embeddingChars) {
          embeddingCost = (meta.embeddingChars / 1_000_000) * PRICING.EMBEDDING_PER_MILLION_CHARS;
        }
        // Vector upsert cost
        if (meta.chunkCount) {
          vectorSearchCost = (meta.chunkCount / 1_000_000) * PRICING.VECTOR_UPSERT_PER_MILLION;
          firestoreCost = (meta.chunkCount / 100_000) * PRICING.FIRESTORE_WRITE_PER_100K;
        }
        break;

      case 'chat_query':
        // Embedding for query
        if (meta.embeddingChars) {
          embeddingCost = (meta.embeddingChars / 1_000_000) * PRICING.EMBEDDING_PER_MILLION_CHARS;
        }
        // Vector search
        vectorSearchCost = (1 / 1_000_000) * PRICING.VECTOR_SEARCH_PER_MILLION_QUERIES;
        // Gemini tokens
        if (meta.inputTokens) {
          geminiCost += (meta.inputTokens / 1_000_000) * PRICING.GEMINI_FLASH_INPUT_PER_MILLION_TOKENS;
        }
        if (meta.outputTokens) {
          geminiCost += (meta.outputTokens / 1_000_000) * PRICING.GEMINI_FLASH_OUTPUT_PER_MILLION_TOKENS;
        }
        // Firestore reads for chunks
        if (meta.vectorNeighbors) {
          firestoreCost = (meta.vectorNeighbors / 100_000) * PRICING.FIRESTORE_READ_PER_100K;
        }
        break;

      case 'embedding_generated':
        if (meta.embeddingChars) {
          embeddingCost = (meta.embeddingChars / 1_000_000) * PRICING.EMBEDDING_PER_MILLION_CHARS;
        }
        break;

      case 'vector_search':
        vectorSearchCost = (1 / 1_000_000) * PRICING.VECTOR_SEARCH_PER_MILLION_QUERIES;
        break;
    }

    return {
      embeddingCost,
      vectorSearchCost,
      geminiCost,
      firestoreCost,
      totalCost: embeddingCost + vectorSearchCost + geminiCost + firestoreCost,
    };
  }

  /**
   * Increment daily aggregated stats in Firestore
   */
  private async incrementDailyStats(event: UsageEvent, cost: CostEstimate): Promise<void> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const statsRef = this.firestore.collection('_metrics').doc(today);

    await this.firestore.runTransaction(async (tx) => {
      const doc = await tx.get(statsRef);
      const existing = doc.exists ? doc.data() : {};

      const updates: any = {
        date: today,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Increment event counts
      updates[`counts.${event.type}`] = (existing?.counts?.[event.type] || 0) + 1;
      updates['counts.total'] = (existing?.counts?.total || 0) + 1;

      // Increment costs
      updates['costs.embedding'] = (existing?.costs?.embedding || 0) + cost.embeddingCost;
      updates['costs.vectorSearch'] = (existing?.costs?.vectorSearch || 0) + cost.vectorSearchCost;
      updates['costs.gemini'] = (existing?.costs?.gemini || 0) + cost.geminiCost;
      updates['costs.firestore'] = (existing?.costs?.firestore || 0) + cost.firestoreCost;
      updates['costs.total'] = (existing?.costs?.total || 0) + cost.totalCost;

      // Track unique tenants
      if (!existing?.tenants?.includes(event.tenantId)) {
        updates.tenants = admin.firestore.FieldValue.arrayUnion(event.tenantId);
      }

      tx.set(statsRef, updates, { merge: true });
    });
  }

  /**
   * Get usage stats for admin dashboard (protected endpoint)
   */
  async getStats(days: number = 30): Promise<any> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().split('T')[0];

    const snapshot = await this.firestore
      .collection('_metrics')
      .where('date', '>=', startStr)
      .orderBy('date', 'desc')
      .get();

    const daily = snapshot.docs.map(doc => doc.data());

    // Aggregate totals
    const totals = daily.reduce((acc, day) => ({
      documents: acc.documents + (day.counts?.document_processed || 0),
      queries: acc.queries + (day.counts?.chat_query || 0),
      totalCost: acc.totalCost + (day.costs?.total || 0),
      uniqueTenants: new Set([...acc.uniqueTenants, ...(day.tenants || [])]),
    }), { documents: 0, queries: 0, totalCost: 0, uniqueTenants: new Set() });

    return {
      period: `${days} days`,
      totals: {
        documentsProcessed: totals.documents,
        chatQueries: totals.queries,
        estimatedCost: `$${totals.totalCost.toFixed(4)}`,
        uniqueUsers: totals.uniqueTenants.size,
      },
      daily,
      pricing: PRICING,
    };
  }
}

