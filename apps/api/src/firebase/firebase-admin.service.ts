import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';

/**
 * FirebaseAdminService - Centralized Firebase Admin initialization
 * 
 * This service ensures Firebase Admin is initialized once with proper error handling.
 * It uses Application Default Credentials (ADC) when available, or project ID fallback.
 */
@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private _firestore: admin.firestore.Firestore | null = null;
  private _auth: admin.auth.Auth | null = null;

  onModuleInit() {
    this.initialize();
  }

  private initialize() {
    if (admin.apps.length > 0) {
      console.log('Firebase Admin already initialized');
      this._firestore = admin.firestore();
      this._auth = admin.auth();
      return;
    }

    try {
      const projectId = process.env.GCP_PROJECT || 'wheelpath-filesearch';
      
      // Try to initialize with project ID
      // This will use Application Default Credentials if available
      admin.initializeApp({
        projectId,
      });
      
      console.log(`✅ Firebase Admin initialized with project: ${projectId}`);
      this._firestore = admin.firestore();
      this._auth = admin.auth();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Firebase Admin initialization failed:', msg);
      console.error('💡 To fix: Run "gcloud auth application-default login"');
      // Don't throw - allow app to start but operations will fail gracefully
    }
  }

  get firestore(): admin.firestore.Firestore {
    if (!this._firestore) {
      throw new Error('Firebase Admin not initialized. Check logs for errors.');
    }
    return this._firestore;
  }

  get auth(): admin.auth.Auth {
    if (!this._auth) {
      throw new Error('Firebase Admin not initialized. Check logs for errors.');
    }
    return this._auth;
  }

  isInitialized(): boolean {
    return admin.apps.length > 0 && this._firestore !== null;
  }
}

