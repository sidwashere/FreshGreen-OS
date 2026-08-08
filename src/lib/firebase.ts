import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleAuthProvider = new GoogleAuthProvider();

// Local Firebase emulator mode (dev/testing): VITE_USE_EMULATORS=true
// routes Auth and Firestore to the local emulators on 127.0.0.1.
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

// Usernames are mapped to a fixed local email domain so Firebase's
// email/password provider can back the login — no Google sign-in needed.
export const usernameToEmail = (username: string): string =>
  `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@greenops.local`;

export const isValidUsername = (username: string): boolean =>
  /^[a-zA-Z0-9._-]{3,24}$/.test(username.trim());

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      try {
        // Refresh the ID token on every session restore (page reload, new tab)
        // so returning users aren't bounced back to the login screen.
        const idToken = await user.getIdToken(true);
        cachedAccessToken = idToken;
        if (onAuthSuccess) onAuthSuccess(user, idToken);
      } catch (err) {
        console.error('Failed to refresh auth token:', err);
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      // No active session yet. If we just returned from a sign-in via redirect
      // (storage-partitioned browsers like sandboxed previews can't use popups),
      // resolve the pending credential before declaring the user signed out.
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleAuthProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Username + password sign-in (bypasses Google entirely).
 * Emails are derived from the username via usernameToEmail().
 */
export const usernameSignIn = async (username: string, password: string) => {
  try {
    isSigningIn = true;
    const result = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    const idToken = await result.user.getIdToken(true);
    cachedAccessToken = idToken;
    return { user: result.user, accessToken: idToken };
  } catch (error: any) {
    console.error('Username sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Create a new username/password account. The account exists in Firebase
 * Auth immediately but stays "pending approval" until an admin approves it
 * via the app_users/{uid}.approved flag.
 */
export const createUsernameUser = async (username: string, password: string) => {
  try {
    isSigningIn = true;
    const result = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    const idToken = await result.user.getIdToken(true);
    cachedAccessToken = idToken;
    return { user: result.user, accessToken: idToken };
  } catch (error: any) {
    console.error('Create username account error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Admin-only account creation. Runs on a SEPARATE in-memory auth instance so
 * creating a user does NOT replace the signed-in admin's session (Firebase's
 * createUserWithEmailAndPassword would otherwise log the new user in).
 */
export const adminCreateAccount = async (username: string, password: string) => {
  const adminAuth = initializeAuth(app, { persistence: inMemoryPersistence });
  if (USE_EMULATORS) {
    connectAuthEmulator(adminAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  try {
    const result = await createUserWithEmailAndPassword(adminAuth, usernameToEmail(username), password);
    return { user: result.user };
  } finally {
    adminAuth.signOut().catch(() => {});
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
