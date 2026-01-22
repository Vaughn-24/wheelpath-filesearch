import { User, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, Auth } from 'firebase/auth';
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
  signOut: () => Promise<void>;
  isDemo: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  error: null,
  signInWithGoogle: async () => {},
  signOut: async () => {},
  isDemo: false,
});

interface AuthProviderProps {
  children: ReactNode;
}

// Check if user explicitly logged out (persists across page loads)
const getStoredLogoutState = (): boolean => {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('wheelpath_logged_out') === 'true';
};

const setStoredLogoutState = (value: boolean) => {
  if (typeof window === 'undefined') return;
  if (value) {
    localStorage.setItem('wheelpath_logged_out', 'true');
  } else {
    localStorage.removeItem('wheelpath_logged_out');
  }
};

export function AuthProvider({ children }: AuthProviderProps) {
  // Check stored logout state to prevent demo user auto-login after redirect
  const wasLoggedOut = typeof window !== 'undefined' && getStoredLogoutState();
  
  const [user, setUser] = useState<User | null>(
    isDemoMode && !wasLoggedOut ? DEMO_USER : null
  );
  const [loading, setLoading] = useState(!isDemoMode && !wasLoggedOut);
  const [error, setError] = useState<string | null>(null);
  const [hasExplicitlyLoggedOut, setHasExplicitlyLoggedOut] = useState(wasLoggedOut);

  const signInWithGoogle = async () => {
    // Clear logout state when user explicitly signs in
    setHasExplicitlyLoggedOut(false);
    setStoredLogoutState(false);
    
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

  const signOut = async () => {
    if (isDemoMode || !auth) {
      setHasExplicitlyLoggedOut(true);
      setStoredLogoutState(true); // Persist across page loads
      setUser(null);
      console.log('Demo mode: User signed out');
      return;
    }

    try {
      setHasExplicitlyLoggedOut(true); // Prevent auto-anonymous-signin
      setStoredLogoutState(true); // Persist across page loads
      await firebaseSignOut(auth as Auth);
      setUser(null);
      setError(null);
      console.log('User signed out successfully');
    } catch (err: unknown) {
      console.error('Sign-out failed:', err);
      setHasExplicitlyLoggedOut(false); // Reset on failure
      setStoredLogoutState(false);
      const errorMessage = err instanceof Error ? err.message : 'Sign-out failed';
      setError(errorMessage);
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
        // Don't auto-signin if user explicitly logged out
        if (hasExplicitlyLoggedOut) {
          console.log('User explicitly logged out, skipping anonymous sign-in');
          setUser(null);
          setLoading(false);
          return;
        }

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
  }, [hasExplicitlyLoggedOut]);

  const value: AuthContextType = {
    user,
    loading,
    error,
    signInWithGoogle,
    signOut,
    isDemo: isDemoMode,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
