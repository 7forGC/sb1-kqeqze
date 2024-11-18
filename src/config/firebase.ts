import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  GoogleAuthProvider, 
  FacebookAuthProvider, 
  browserLocalPersistence,
  setPersistence,
  inMemoryPersistence
} from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import localforage from 'localforage';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB72qLBGmi-eHgL4FHdJs9h7L0gTsX3M2c",
  authDomain: "forgcai.firebaseapp.com",
  projectId: "forgcai",
  storageBucket: "forgcai.appspot.com",
  messagingSenderId: "850121715325",
  appId: "1:850121715325:web:3a8b8b8b8b8b8b8b8b8b8b"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services early
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Initialize providers
const googleProvider = new GoogleAuthProvider();
const facebookProvider = new FacebookAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

facebookProvider.setCustomParameters({
  display: 'popup'
});

// Initialize App Check
const initializeAppCheckWithRetry = async (retries = 3, delay = 2000): Promise<any> => {
  let lastError;

  for (let i = 0; i < retries; i++) {
    try {
      // Clear any existing reCAPTCHA elements
      const elements = document.getElementsByClassName('grecaptcha-badge');
      while (elements.length > 0) {
        elements[0].remove();
      }

      // Initialize reCAPTCHA if not already initialized
      if (!window.grecaptcha) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://www.google.com/recaptcha/enterprise.js?render=6Lf_Qk4pAAAAANPXkZxTWZHPw6UwQfvmcYHXhYxb';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
          document.head.appendChild(script);
        });

        // Wait for reCAPTCHA to be ready
        await new Promise<void>((resolve) => {
          if (window.grecaptcha?.enterprise) {
            resolve();
          } else {
            window.grecaptcha = {
              ...window.grecaptcha,
              enterprise: {
                ready: (callback: () => void) => {
                  if (document.readyState === 'complete') {
                    callback();
                  } else {
                    window.addEventListener('load', callback);
                  }
                }
              }
            };
          }
        });
      }

      // Get reCAPTCHA token
      const token = await new Promise<string>((resolve, reject) => {
        window.grecaptcha.enterprise.ready(async () => {
          try {
            const token = await window.grecaptcha.enterprise.execute(
              '6Lf_Qk4pAAAAANPXkZxTWZHPw6UwQfvmcYHXhYxb',
              { action: 'initialize' }
            );
            resolve(token);
          } catch (error) {
            reject(error);
          }
        });
      });

      if (!token) {
        throw new Error('Failed to get reCAPTCHA token');
      }

      // Initialize App Check
      const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider('6Lf_Qk4pAAAAANPXkZxTWZHPw6UwQfvmcYHXhYxb'),
        isTokenAutoRefreshEnabled: true
      });

      // Verify App Check is working
      const appCheckToken = await appCheck.getToken(true);
      if (!appCheckToken) {
        throw new Error('Failed to get App Check token');
      }

      return appCheck;
    } catch (error) {
      console.error(`App Check initialization attempt ${i + 1} failed:`, error);
      lastError = error;

      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        continue;
      }
    }
  }

  // If we're in development, use debug token as fallback
  if (process.env.NODE_ENV === 'development') {
    console.warn('Falling back to development mode App Check');
    // @ts-ignore
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    return initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider('6Lf_Qk4pAAAAANPXkZxTWZHPw6UwQfvmcYHXhYxb'),
      isTokenAutoRefreshEnabled: true
    });
  }

  throw lastError || new Error('Failed to initialize App Check');
};

// Initialize App Check and export promise
const appCheckPromise = initializeAppCheckWithRetry().catch(error => {
  console.error('Final App Check initialization failed:', error);
  return null;
});

// Initialize Auth persistence
setPersistence(auth, browserLocalPersistence).catch(error => {
  console.error('Auth persistence error:', error);
  setPersistence(auth, inMemoryPersistence).catch(console.error);
});

// Enable Firestore persistence
const initFirestorePersistence = async () => {
  try {
    await enableIndexedDbPersistence(db, {
      synchronizeTabs: true,
      forceOwnership: false
    });
  } catch (err: any) {
    if (err.code === 'failed-precondition') {
      console.warn('Multiple tabs open, persistence enabled in another tab');
    } else if (err.code === 'unimplemented') {
      console.warn('Browser doesn\'t support persistence');
    }
  }
};

// Initialize persistence with retry logic
const initWithRetry = async (retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await initFirestorePersistence();
      break;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
};

initWithRetry().catch(console.error);

// Configure localforage
localforage.config({
  name: '7forall',
  storeName: 'offline_store',
  description: 'Offline data store for 7 for All'
});

export {
  app as default,
  auth,
  db,
  storage,
  appCheckPromise as appCheck,
  googleProvider,
  facebookProvider
};