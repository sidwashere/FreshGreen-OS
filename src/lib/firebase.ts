import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

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
  `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@fgos.local`;

export const isValidUsername = (username: string): boolean =>
  /^[a-zA-Z0-9._-]{3,24}$/.test(username.trim());

// --- Auto-authentication (no login screen) --------------------------------
// This app is a private, single-operator tool backed by the local Firebase
// emulator. Instead of a login screen, every load silently signs in as the
// workspace owner (whose UID owns all the seeded brands/content). If the
// account does not exist yet (fresh emulator), it is created on first run —
// the app then promotes it to admin via the bootstrap flow in App.tsx.
// NOTE: this only works against the emulator / the account created below.
// If the emulator is reseeded with a different password, update AUTO_AUTH.
const AUTO_AUTH_USERNAME = 'owner';
const AUTO_AUTH_PASSWORD = 'Owner-Petfoods-2026';

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
      // No active session — auto-authenticate instead of showing a login form.
      // signInWithEmailAndPassword flips the auth state, which fires this
      // listener again with the signed-in user (so onAuthSuccess runs then).
      cachedAccessToken = null;
      try {
        const email = usernameToEmail(AUTO_AUTH_USERNAME);
        try {
          await signInWithEmailAndPassword(auth, email, AUTO_AUTH_PASSWORD);
        } catch (err: any) {
          if (err?.code === 'auth/user-not-found') {
            // First run on a fresh emulator: create the owner account. The
            // missing app_users profile is auto-provisioned as admin by the
            // approval check in App.tsx.
            await createUserWithEmailAndPassword(auth, email, AUTO_AUTH_PASSWORD);
          } else {
            throw err;
          }
        }
      } catch (err: any) {
        console.error('[AutoAuth] automatic sign-in failed:', err?.message || err);
        if (onAuthFailure) onAuthFailure();
      }
    }
  });
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
