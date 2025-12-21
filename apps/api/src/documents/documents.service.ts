import { Injectable } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

import { TenantService } from '../tenant/tenant.service';

/**
 * DocumentsService - Manages document upload to File Search Stores
 *
 * Flow:
 * 1. Receive file buffer from controller
 * 2. Get/create tenant's File Search Store
 * 3. Upload file to File Search Store (auto-indexes)
 * 4. Poll until indexing complete
 * 5. Save reference in Firestore
 */

export interface DocumentRecord {
  id: string;
  tenantId: string;
  title: string;
  fileSearchDocumentName: string;
  mimeType: string;
  status: 'indexing' | 'ready' | 'error';
  sizeBytes: number;
  createdAt: string;
  errorMessage?: string;
}

@Injectable()
export class DocumentsService {
  private ai: GoogleGenAI;
  private firestore: admin.firestore.Firestore;

  constructor(private readonly tenantService: TenantService) {
    // Initialize Google GenAI
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    this.ai = new GoogleGenAI({ apiKey });

    // Initialize Firebase
    if (!admin.apps.length) {
      admin.initializeApp();
    }
    this.firestore = admin.firestore();

    console.log('DocumentsService initialized with File Search support');
  }

  /**
   * Upload a document to the tenant's File Search Store
   */
  async uploadDocument(
    tenantId: string,
    fileBuffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<DocumentRecord> {
    const documentId = uuidv4();

    // Create initial record with 'indexing' status
    const docRecord: DocumentRecord = {
      id: documentId,
      tenantId,
      title: filename,
      fileSearchDocumentName: '', // Will be set after upload
      mimeType,
      status: 'indexing',
      sizeBytes: fileBuffer.length,
      createdAt: new Date().toISOString(),
    };

    // Save initial record to Firestore
    await this.firestore.collection('documents').doc(documentId).set(docRecord);

    try {
      // Get or create the tenant's File Search Store
      const storeName = await this.tenantService.getOrCreateFileSearchStore(tenantId);

      console.log(`Uploading document ${filename} to File Search Store: ${storeName}`);

      // Upload to File Search Store
      // Convert Buffer to Uint8Array for Blob compatibility
      const uint8Array = new Uint8Array(fileBuffer);
      const blob = new Blob([uint8Array], { type: mimeType });

      let operation = await this.ai.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeName,
        file: blob,
        config: {
          displayName: filename,
        },
      });

      // Poll until indexing is complete (max 2 minutes)
      const maxWaitMs = 120000;
      const startTime = Date.now();
      const pollIntervalMs = 3000;

      while (!operation.done) {
        if (Date.now() - startTime > maxWaitMs) {
          throw new Error('Document indexing timed out after 2 minutes');
        }

        await this.sleep(pollIntervalMs);
        operation = await this.ai.operations.get({ operation });
        console.log(`Indexing ${filename}... done=${operation.done}`);
      }

      // Get the File Search Document name from the result
      const fileSearchDocumentName = (operation as unknown as { result?: { name?: string } }).result
        ?.name;

      if (!fileSearchDocumentName) {
        throw new Error('File Search upload succeeded but no document name returned');
      }

      // Update Firestore with success
      const updatedRecord: Partial<DocumentRecord> = {
        fileSearchDocumentName,
        status: 'ready',
      };

      await this.firestore.collection('documents').doc(documentId).update(updatedRecord);

      console.log(`Document ${filename} indexed successfully: ${fileSearchDocumentName}`);

      return {
        ...docRecord,
        ...updatedRecord,
      } as DocumentRecord;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Failed to upload document ${filename}:`, errorMessage);

      // Update Firestore with error
      await this.firestore.collection('documents').doc(documentId).update({
        status: 'error',
        errorMessage,
      });

      throw new Error(`Document upload failed: ${errorMessage}`);
    }
  }

  /**
   * Get all documents for a tenant
   */
  async findAllByTenant(tenantId: string): Promise<DocumentRecord[]> {
    const snapshot = await this.firestore
      .collection('documents')
      .where('tenantId', '==', tenantId)
      .get();

    return snapshot.docs.map((doc) => doc.data() as DocumentRecord);
  }

  /**
   * Get a single document by ID (with tenant check)
   */
  async findOneByTenant(tenantId: string, id: string): Promise<DocumentRecord | null> {
    const doc = await this.firestore.collection('documents').doc(id).get();

    if (!doc.exists) return null;

    const data = doc.data() as DocumentRecord;
    if (data.tenantId !== tenantId) return null;

    return data;
  }

  /**
   * Delete a document (removes from File Search Store and Firestore)
   */
  async deleteDocument(tenantId: string, id: string): Promise<void> {
    const docRef = this.firestore.collection('documents').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new Error('Document not found');
    }

    const data = doc.data() as DocumentRecord;
    if (data.tenantId !== tenantId) {
      throw new Error('Unauthorized');
    }

    // Delete from File Search Store if we have a reference
    if (data.fileSearchDocumentName) {
      try {
        // Use the files API to delete the document
        await this.ai.files.delete({ name: data.fileSearchDocumentName });
        console.log(`Deleted from File Search: ${data.fileSearchDocumentName}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.warn(`Failed to delete from File Search: ${message}`);
        // Continue with Firestore deletion even if File Search deletion fails
      }
    }

    // Delete from Firestore
    await docRef.delete();
    console.log(`Deleted document from Firestore: ${id}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
