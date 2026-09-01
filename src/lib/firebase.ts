import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  User,
  GoogleAuthProvider,
  signInWithPopup,
  browserLocalPersistence,
  setPersistence,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, enableIndexedDbPersistence } from 'firebase/firestore';
import { connectAuthEmulator } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

if (typeof window !== 'undefined') {
  enableIndexedDbPersistence(db).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.debug('Firestore persistence: multiple tabs open');
    } else if (err.code === 'unimplemented') {
      console.debug('Firestore persistence not supported by browser');
    }
  });
}

// Local Firebase emulator mode (dev/testing): VITE_USE_EMULATORS=true
// routes Auth and Firestore to the local emulators on 127.0.0.1.
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);

  // Prove emulators are reachable — this prevents the silent "auto-login
  // failed" loop that happens when emulators aren't running.
  checkEmulators().catch(() => {});
}

async function checkEmulators(): Promise<void> {
  const checks = [
    { name: 'Auth', url: 'http://127.0.0.1:9099' },
    { name: 'Firestore', url: 'http://127.0.0.1:8080' },
  ];
  const results = await Promise.allSettled(
    checks.map(async (c) => {
      try {
        const r = await fetch(c.url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
        return { name: c.name, ok: r.ok || r.status === 404 }; // 404 is fine — means the process is listening
      } catch {
        return { name: c.name, ok: false };
      }
    })
  );
  const failed: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && !r.value.ok) {
      failed.push(r.value.name);
    }
  }
  if (failed.length > 0) {
    console.error(
      `[FGOS] ⚠️  Firebase emulator${failed.length > 1 ? 's' : ''} not reachable: ${failed.join(', ')}. ` +
      `Auto-login will fail. Start emulators with: npx firebase emulators:start`
    );
  } else {
    console.log('[FGOS] ✅ Firebase emulators reachable (Auth + Firestore)');
  }
}

// Usernames are mapped to a fixed local email domain so Firebase's
// email/password provider can back the login — no Google sign-in needed.
export const usernameToEmail = (username: string): string =>
  `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')}@fgos.local`;

export const isValidUsername = (username: string): boolean =>
  /^[a-zA-Z0-9._-]{3,24}$/.test(username.trim());

// ─── Google Sign-In ───────────────────────────────────────────────────────────
const googleProvider = new GoogleAuthProvider();

export const signInWithGoogle = async (): Promise<User> => {
  // Ensure persistent session (survives page reload) for production
  if (!USE_EMULATORS) {
    await setPersistence(auth, browserLocalPersistence);
  }
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

// ─── Email/Password Sign-In ───────────────────────────────────────────────────
export const signInWithEmail = async (email: string, password: string): Promise<User> => {
  if (!USE_EMULATORS) {
    await setPersistence(auth, browserLocalPersistence);
  }
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
};

// ─── Sign Out ─────────────────────────────────────────────────────────────────
export const signOutUser = async (): Promise<void> => {
  await auth.signOut();
};

// --- Auto-authentication (no login screen) --------------------------------
// In EMULATOR mode: silently signs in as the workspace owner every time.
// In PRODUCTION mode: no auto-login — show the login screen instead so
// multiple users (Carol, Sidney, etc.) can authenticate with Google or email.
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
        const idToken = await user.getIdToken(true);
        cachedAccessToken = idToken;
        if (onAuthSuccess) onAuthSuccess(user, idToken);
      } catch (err) {
        console.error('Failed to refresh auth token:', err);
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;

      if (USE_EMULATORS) {
        // Emulator mode: auto-login as owner (no login screen needed)
        try {
          const email = usernameToEmail(AUTO_AUTH_USERNAME);
          try {
            await signInWithEmailAndPassword(auth, email, AUTO_AUTH_PASSWORD);
          } catch (err: any) {
            if (err?.code === 'auth/user-not-found') {
              await createUserWithEmailAndPassword(auth, email, AUTO_AUTH_PASSWORD);
            } else {
              throw err;
            }
          }
        } catch (err: any) {
          console.error('[AutoAuth] automatic sign-in failed:', err?.message || err);
          if (onAuthFailure) onAuthFailure();
        }
      } else {
        // Production: auto-login as owner (same as emulator mode) so the app
        // is immediately usable without a login screen. Creates the owner
        // account in real Firebase Auth on first run if it doesn't exist yet.
        // NOTE: this means anyone who visits the deployed URL is signed in as
        // the owner/admin. Acceptable for this private internal tool.
        try {
          const email = usernameToEmail(AUTO_AUTH_USERNAME);
          try {
            await signInWithEmailAndPassword(auth, email, AUTO_AUTH_PASSWORD);
          } catch (err: any) {
            if (err?.code === 'auth/user-not-found') {
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
