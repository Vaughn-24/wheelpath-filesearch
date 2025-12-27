import { User, signInAnonymously, GoogleAuthProvider, signInWithPopup, Auth } from 'firebase/auth';
import { useEffect, useState, createContext, useContext, ReactNode } from 'react';

import { auth, isDemoMode } from './firebase';

// Demo user for when Firebase is unavailable
const DEMO_USER = {
  uid: 'demo-user-123',
  email: 'demo@wheelpath.ai',
  displayName: 'Demo User',
  getIdToken: async () => 'demo-token',
} as unknown as User;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<void>;
  isDemo: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signInWithGoogle: async () => {},
  isDemo: false,
});

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(isDemoMode ? DEMO_USER : null);
  const [loading, setLoading] = useState(!isDemoMode);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    console.log('[Auth] signInWithGoogle called', { isDemoMode, hasAuth: !!auth });
    
    if (isDemoMode || !auth) {
      console.log('[Auth] Using demo user (demo mode or no auth)');
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      console.log('[Auth] Initiating Google sign-in popup');
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth as Auth, provider);
      console.log('[Auth] Google sign-in successful', {
        uid: result.user.uid,
        email: result.user.email,
      });
    } catch (err: unknown) {
      console.error('[Auth] Google sign-in failed', {
        error: err,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      const errorMessage = err instanceof Error ? err.message : 'Sign-in failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If in demo mode, we already set the demo user in state initialization
    if (isDemoMode || !auth) {
      console.log('[Auth] Running in demo mode - using demo user');
      return;
    }

    console.log('[Auth] Setting up auth state listener');
    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      console.log('[Auth] Auth state changed', {
        hasUser: !!u,
        uid: u?.uid || 'none',
        email: u?.email || 'none',
      });

      if (u) {
        // [Checkpoint] User authenticated
        try {
          const token = await u.getIdToken();
          console.log('[Auth] User authenticated, token retrieved', {
            uid: u.uid,
            email: u.email,
            hasToken: !!token,
            tokenLength: token?.length || 0,
          });
        } catch (tokenErr) {
          console.error('[Auth] Failed to get token for authenticated user', tokenErr);
        }
        
        setUser(u);
        setLoading(false);
        setError(null);
      } else {
        try {
          console.log('[Auth] No user, attempting anonymous sign-in...');
          const result = await signInAnonymously(auth as Auth);
          console.log('[Auth] Anonymous sign-in successful', {
            uid: result.user.uid,
            isAnonymous: result.user.isAnonymous,
          });
        } catch (err: unknown) {
          console.error('[Auth] Anonymous sign-in failed', {
            error: err,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          setError('Anonymous auth disabled. Please sign in with Google.');
          setLoading(false);
        }
      }
    });

    return () => {
      console.log('[Auth] Cleaning up auth state listener');
      unsubscribe();
    };
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    error,
    signInWithGoogle,
    isDemo: isDemoMode,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
