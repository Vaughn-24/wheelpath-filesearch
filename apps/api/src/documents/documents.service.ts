import { Injectable } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { Storage } from '@google-cloud/storage';
import { GoogleAIFileManager } from '@google/generative-ai/server';
import { v4 as uuidv4 } from 'uuid';
import { Document } from '@wheelpath/schemas';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

@Injectable()
export class DocumentsService {
  private firestore: admin.firestore.Firestore;
  private storage: Storage;
  private bucketName = process.env.GCS_BUCKET_NAME || 'wheelpath-filesearch-uploads-dev';
  private fileManager: GoogleAIFileManager;

  constructor() {
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: process.env.GCP_PROJECT || 'wheelpath-filesearch' });
    }
    this.firestore = admin.firestore();

    // Storage needs service account for signed URLs
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath && fs.existsSync(keyPath)) {
      this.storage = new Storage({ keyFilename: keyPath });
    } else {
      this.storage = new Storage();
    }

    // Gemini File Manager - dead simple
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY required');
    this.fileManager = new GoogleAIFileManager(apiKey);
  }

  async generateUploadUrl(tenantId: string, filename: string, contentType: string): Promise<{ uploadUrl: string, documentId: string, gcsPath: string }> {
    const documentId = uuidv4();
    const extension = filename.split('.').pop();
    const gcsFileName = `${tenantId}/${documentId}.${extension}`;
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(gcsFileName);

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType,
    });

    // Create initial document record in Firestore
    const newDoc: Document = {
      id: documentId,
      tenantId,
      title: filename,
      gcsPath: `gs://${this.bucketName}/${gcsFileName}`,
      mimeType: contentType,
      status: 'uploading',
      createdAt: new Date().toISOString(),
    };

    await this.firestore.collection('documents').doc(documentId).set(newDoc);

    return {
      uploadUrl: url,
      documentId,
      gcsPath: newDoc.gcsPath,
    };
  }

  async findAllByTenant(tenantId: string): Promise<Document[]> {
    const snapshot = await this.firestore.collection('documents')
      .where('tenantId', '==', tenantId)
      // .orderBy('createdAt', 'desc') // Requires index, might fail initially
      .get();
    
    return snapshot.docs.map(doc => doc.data() as Document);
  }

  async findOneByTenant(tenantId: string, id: string): Promise<(Document & { signedUrl: string }) | undefined> {
    const doc = await this.firestore.collection('documents').doc(id).get();
    if (!doc.exists) return undefined;
    const data = doc.data() as Document;
    if (data.tenantId !== tenantId) return undefined;

    // Generate Read URL
    const bucket = this.storage.bucket(this.bucketName);
    // Extract filename from gcsPath or reconstruct it
    // gcsPath: gs://bucket/tenant/id.ext
    const matches = data.gcsPath.match(/gs:\/\/[^\/]+\/(.+)/);
    
    let signedUrl = '';
    if (matches) {
        const gcsFileName = matches[1];
        const file = bucket.file(gcsFileName);
        const [url] = await file.getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + 60 * 60 * 1000, // 1 hour
        });
        signedUrl = url;
    }

    return { ...data, signedUrl };
  }

  async deleteDocument(tenantId: string, id: string): Promise<void> {
    const docRef = this.firestore.collection('documents').doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
        throw new Error('Document not found');
    }

    const data = doc.data() as Document;
    if (data.tenantId !== tenantId) {
        throw new Error('Unauthorized');
    }

    // 1. Delete from GCS
    if (data.gcsPath) {
        const matches = data.gcsPath.match(/gs:\/\/[^\/]+\/(.+)/);
        if (matches) {
            const gcsFileName = matches[1];
            try {
                await this.storage.bucket(this.bucketName).file(gcsFileName).delete();
            } catch (error: any) {
                console.warn(`Failed to delete GCS file ${gcsFileName}:`, error.message);
                // Continue deletion even if GCS fails (e.g. file already gone)
            }
        }
    }

    // 2. Delete Chunks Subcollection (Recursive)
    // Note: recursiveDelete is available in firebase-admin
    await this.firestore.recursiveDelete(docRef);

    // 3. (Optional) We could delete from 'chats' if we want to cascade, but keeping chat history might be desired.
    // For "Full CRUD" usually deleting the resource deletes its children. 
    // But 'chats' are top level with documentId reference? 
    // My schema said 'chats' collection. 
    // I won't delete chats for now unless requested, to be safe.
  }

  /**
   * Process document: download from GCS, upload to Gemini Files API
   * That's it. Gemini handles the rest.
   */
  async processDocument(tenantId: string, documentId: string): Promise<{ success: boolean; error?: string }> {
    const docRef = this.firestore.collection('documents').doc(documentId);
    const doc = await docRef.get();
    
    if (!doc.exists) return { success: false, error: 'Not found' };
    const data = doc.data() as Document;
    if (data.tenantId !== tenantId) return { success: false, error: 'Unauthorized' };

    // Check if already processed
    if ((data as any).geminiFileUri) {
      return { success: true }; // Already done
    }

    // Check if we have a valid GCS path
    if (!data.gcsPath) {
      return { success: false, error: 'No PDF file found. Please re-upload this document.' };
    }

    try {
      await docRef.update({ status: 'processing' });

      // 1. Download from GCS to temp file
      const matches = data.gcsPath.match(/gs:\/\/([^\/]+)\/(.+)/);
      if (!matches) throw new Error('Invalid GCS path format');
      const [, bucket, fileName] = matches;
      
      console.log(`[DocumentsService] Downloading from gs://${bucket}/${fileName}`);
      const tempPath = path.join(os.tmpdir(), `${documentId}.pdf`);
      await this.storage.bucket(bucket).file(fileName).download({ destination: tempPath });

      // 2. Upload to Gemini Files API - one line
      console.log(`[DocumentsService] Uploading to Gemini Files API...`);
      const uploadResult = await this.fileManager.uploadFile(tempPath, {
        mimeType: data.mimeType || 'application/pdf',
        displayName: data.title,
      });

      // 3. Save the file URI - this is what we use in chat
      await docRef.update({
        status: 'ready',
        geminiFileUri: uploadResult.file.uri,
        geminiFileName: uploadResult.file.name,
      });

      console.log(`[DocumentsService] ✅ Processed: ${uploadResult.file.uri}`);

      // Cleanup temp file
      fs.unlinkSync(tempPath);

      return { success: true };
    } catch (error: any) {
      console.error(`[DocumentsService] ❌ Process failed:`, error.message);
      await docRef.update({ status: 'error', errorMessage: error.message });
      return { success: false, error: error.message };
    }
  }
}
