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
    if (isDemoMode || !auth) {
      setUser(DEMO_USER);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth as Auth, provider);
    } catch (err: unknown) {
      console.error('Google sign-in failed:', err);
      const errorMessage = err instanceof Error ? err.message : 'Sign-in failed';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // If in demo mode, we already set the demo user in state initialization
    if (isDemoMode || !auth) {
      console.log('Running in demo mode - using demo user');
      return;
    }

    const unsubscribe = auth.onAuthStateChanged(async (u) => {
      if (u) {
        setUser(u);
        setLoading(false);
        setError(null);
      } else {
        try {
          console.log('No user, attempting anonymous sign-in...');
          await signInAnonymously(auth as Auth);
        } catch (err: unknown) {
          console.error('Anonymous sign-in failed:', err);
          setError('Anonymous auth disabled. Please sign in with Google.');
          setLoading(false);
        }
      }
    });

    return () => unsubscribe();
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
