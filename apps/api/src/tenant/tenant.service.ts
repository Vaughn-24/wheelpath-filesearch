import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';

/**
 * TenantService - Manages File Search Stores for each tenant
 *
 * Each tenant gets their own File Search Store for data isolation.
 * The store name is cached in Firestore for persistence.
 */
@Injectable()
export class TenantService {
  private ai: GoogleGenAI;
  private firestore: admin.firestore.Firestore;

  // In-memory cache for store names (reduces Firestore reads)
  private storeCache = new Map<string, string>();

  constructor() {
    // Initialize Google GenAI with API key
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for File Search');
    }
    this.ai = new GoogleGenAI({ apiKey });

    // Initialize Firebase if not already done
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();

    console.log('TenantService initialized with File Search support');
  }

  /**
   * Get or create a File Search Store for a tenant
   * Returns the store name (e.g., "fileSearchStores/abc123")
   */
  async getOrCreateFileSearchStore(tenantId: string): Promise<string> {
    // Check in-memory cache first
    if (this.storeCache.has(tenantId)) {
      return this.storeCache.get(tenantId)!;
    }

    // Check Firestore for existing store
    const tenantDoc = await this.firestore.collection('tenants').doc(tenantId).get();

    if (tenantDoc.exists) {
      const data = tenantDoc.data();
      if (data?.fileSearchStoreName) {
        this.storeCache.set(tenantId, data.fileSearchStoreName);
        return data.fileSearchStoreName;
      }
    }

    // Create new File Search Store for this tenant
    console.log(`Creating File Search Store for tenant: ${tenantId}`);

    try {
      const store = await this.ai.fileSearchStores.create({
        config: {
          displayName: `tenant-${tenantId.slice(0, 8)}-store`,
        },
      });

      const storeName = store.name;
      if (!storeName) {
        throw new Error('File Search Store creation returned no name');
      }

      // Save to Firestore
      await this.firestore.collection('tenants').doc(tenantId).set(
        {
          fileSearchStoreName: storeName,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // Cache it
      this.storeCache.set(tenantId, storeName);

      console.log(`Created File Search Store: ${storeName} for tenant: ${tenantId}`);
      return storeName;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to create File Search Store for tenant ${tenantId}:`, message);
      throw new Error(`Failed to create File Search Store: ${message}`);
    }
  }

  /**
   * Get the File Search Store name for a tenant (returns null if not exists)
   */
  async getFileSearchStore(tenantId: string): Promise<string | null> {
    // Check cache
    if (this.storeCache.has(tenantId)) {
      return this.storeCache.get(tenantId)!;
    }

    // Check Firestore
    const tenantDoc = await this.firestore.collection('tenants').doc(tenantId).get();
    if (tenantDoc.exists && tenantDoc.data()?.fileSearchStoreName) {
      const storeName = tenantDoc.data()!.fileSearchStoreName;
      this.storeCache.set(tenantId, storeName);
      return storeName;
    }

    return null;
  }

  /**
   * Clear the cache for a tenant (useful after store deletion)
   */
  clearCache(tenantId: string): void {
    this.storeCache.delete(tenantId);
  }
}

