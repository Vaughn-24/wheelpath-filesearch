import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Check if we have valid Firebase config
const hasValidConfig = firebaseConfig.apiKey && firebaseConfig.projectId;

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

// Demo mode flag - set to true when Firebase is unavailable
export let isDemoMode = false;

// Defer Firebase initialization to avoid blocking module loading
// This prevents Firebase initialization errors from breaking React's jsx-dev-runtime
if (typeof window !== 'undefined' && hasValidConfig) {
  // Client-side: Initialize Firebase asynchronously
  try {
    app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (error) {
    console.warn('Firebase initialization failed, running in demo mode:', error);
    isDemoMode = true;
  }
} else if (!hasValidConfig) {
  console.warn('Firebase config missing, running in demo mode');
  isDemoMode = true;
} else {
  // Server-side: Skip Firebase initialization during SSR to avoid module loading issues
  isDemoMode = true;
}

export { db, auth };
