import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  AuthError,
  GoogleAuthProvider,
  FacebookAuthProvider
} from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, facebookProvider } from '../config/firebase';
import localforage from 'localforage';
import type { UserProfile } from '../types/auth';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithFacebook: () => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const handleAuthError = (error: AuthError): string => {
  switch (error.code) {
    case 'auth/invalid-email':
      return 'Invalid email address';
    case 'auth/user-disabled':
      return 'This account has been disabled';
    case 'auth/user-not-found':
      return 'No account found with this email';
    case 'auth/wrong-password':
      return 'Incorrect password';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters';
    case 'auth/popup-closed-by-user':
      return 'Sign in was cancelled';
    case 'auth/operation-not-allowed':
      return 'This sign in method is not enabled';
    case 'appCheck/fetch-status-error':
      return 'Please verify you are not a robot and try again';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later';
    case 'auth/popup-blocked':
      return 'Pop-up blocked. Please allow pop-ups for this site';
    default:
      return 'An error occurred during authentication';
  }
};

const handleSocialSignIn = async (provider: GoogleAuthProvider | FacebookAuthProvider) => {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = provider instanceof GoogleAuthProvider 
      ? GoogleAuthProvider.credentialFromResult(result)
      : FacebookAuthProvider.credentialFromResult(result);
      
    if (!credential) {
      throw new Error('Failed to get credential');
    }

    return result.user;
  } catch (error: any) {
    if (error.code === 'appCheck/fetch-status-error') {
      // Retry once with reCAPTCHA refresh
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));
        // @ts-ignore
        await window.grecaptcha.execute('6Lf_Qk4pAAAAANPXkZxTWZHPw6UwQfvmcYHXhYxb', { action: 'login' });
        return await signInWithPopup(auth, provider);
      } catch (retryError) {
        throw retryError;
      }
    }
    throw error;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          // Try to get cached user data first
          const cachedUser = await localforage.getItem<UserProfile>(`user_${firebaseUser.uid}`);
          if (cachedUser) {
            setUser(cachedUser);
          }

          // Get fresh data from Firestore
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userRef);
          
          if (!userDoc.exists()) {
            const userProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email!,
              displayName: firebaseUser.displayName || 'User',
              photoURL: firebaseUser.photoURL || undefined,
              createdAt: Date.now(),
              lastLogin: Date.now(),
              status: 'online',
              emailVerified: firebaseUser.emailVerified,
              settings: {
                theme: { mode: 'light', primary: '#AB39D2', secondary: '#4F46E5' },
                language: 'en',
                notifications: { enabled: true, volume: 100 }
              }
            };
            
            await setDoc(userRef, userProfile);
            await localforage.setItem(`user_${firebaseUser.uid}`, userProfile);
            setUser(userProfile);
          } else {
            const userData = userDoc.data() as UserProfile;
            await updateDoc(userRef, { status: 'online', lastLogin: Date.now() });
            await localforage.setItem(`user_${firebaseUser.uid}`, userData);
            setUser(userData);
          }
        } else {
          setUser(null);
          await localforage.removeItem('currentUser');
        }
      } catch (err: any) {
        console.error('Auth state change error:', err);
        if (err?.code !== 'permission-denied' && err?.code !== 'appCheck/fetch-status-error') {
          setError('Failed to load user profile');
        }
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      setError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error('Sign in error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    try {
      setLoading(true);
      setError(null);
      const { user: firebaseUser } = await createUserWithEmailAndPassword(auth, email, password);
      
      const userProfile: UserProfile = {
        uid: firebaseUser.uid,
        email: firebaseUser.email!,
        displayName,
        createdAt: Date.now(),
        lastLogin: Date.now(),
        status: 'online',
        emailVerified: false,
        settings: {
          theme: { mode: 'light', primary: '#AB39D2', secondary: '#4F46E5' },
          language: 'en',
          notifications: { enabled: true, volume: 100 }
        }
      };
      
      await setDoc(doc(db, 'users', firebaseUser.uid), userProfile);
      await localforage.setItem(`user_${firebaseUser.uid}`, userProfile);
      setUser(userProfile);
    } catch (err: any) {
      console.error('Sign up error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      setLoading(true);
      setError(null);
      await handleSocialSignIn(googleProvider);
    } catch (err: any) {
      console.error('Google sign in error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signInWithFacebook = async () => {
    try {
      setLoading(true);
      setError(null);
      await handleSocialSignIn(facebookProvider);
    } catch (err: any) {
      console.error('Facebook sign in error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      setError(null);
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        await updateDoc(userRef, {
          status: 'offline',
          lastLogin: Date.now()
        });
        await localforage.removeItem(`user_${user.uid}`);
      }
      await firebaseSignOut(auth);
      setUser(null);
    } catch (err: any) {
      console.error('Sign out error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, data);
      const updatedUser = { ...user, ...data };
      await localforage.setItem(`user_${user.uid}`, updatedUser);
      setUser(updatedUser);
    } catch (err: any) {
      console.error('Profile update error:', err);
      setError(handleAuthError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const value = {
    user,
    loading,
    error,
    signIn,
    signUp,
    signInWithGoogle,
    signInWithFacebook,
    signOut,
    updateProfile
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};