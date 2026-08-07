import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  connectAuthEmulator,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
  UserCredential,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleAuthProvider = new GoogleAuthProvider();

/**
 * Emulator mode (VITE_USE_EMULATORS=true):
 * storage-partitioned embedded browsers (sandboxed previews, in-app browsers)
 * break Firebase's cross-origin sign-in state handshake. Pointing auth AND
 * Firestore at the local emulators keeps every request on the same origin,
 * so sign-in works with a plain email/password call - no popup, no redirect.
 */
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export const DEMO_EMAIL = 'demo@freshgreenops.local';
export const DEMO_PASSWORD = 'demo1234';

// Scopes required for workspace operations should be configured via the set_up_oauth tool.
// Removing this massive list to prevent Firebase auth/internal-error during sign-in.

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      try {
        // Refresh the token on every session restore (page reload, etc.)
        // so returning users don't get bounced back to the login screen.
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
      try {
        const redirectResult = await getRedirectResult(auth);
        if (redirectResult) {
          const credential = GoogleAuthProvider.credentialFromResult(redirectResult);
          cachedAccessToken =
            credential?.accessToken ?? (await redirectResult.user.getIdToken(true));
          if (onAuthSuccess) onAuthSuccess(redirectResult.user, cachedAccessToken);
          return;
        }
      } catch (err) {
        console.error('Redirect sign-in error:', err);
      }
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
 * Sign in via a full-page redirect instead of a popup.
 * Required in storage-partitioned browser environments (sandboxed previews,
 * in-app browsers) where the popup flow's state handshake fails.
 * After the redirect completes, the app reloads and initAuth resolves the
 * pending result via getRedirectResult().
 */
export const googleSignInRedirect = async (): Promise<void> => {
  await signInWithRedirect(auth, googleAuthProvider);
};

/**
 * Emulator-mode sign-in. No popup/redirect: the local auth emulator accepts
 * any email/password. On first run the demo account is provisioned
 * automatically (the emulator doesn't create password users on sign-in).
 * Only available when VITE_USE_EMULATORS=true.
 */
export const demoSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  const signIn = async () => signInWithEmailAndPassword(auth, DEMO_EMAIL, DEMO_PASSWORD);
  let result: UserCredential;
  try {
    result = await signIn();
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') {
      await createUserWithEmailAndPassword(auth, DEMO_EMAIL, DEMO_PASSWORD);
      result = await signIn();
    } else {
      throw err;
    }
  }
  const idToken = await result.user.getIdToken(true);
  cachedAccessToken = idToken;
  return { user: result.user, accessToken: idToken };
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
