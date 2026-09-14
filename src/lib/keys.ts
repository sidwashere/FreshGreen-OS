import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { readDocCached } from './firestoreCache';
import type { AiModelPref } from '../types';

export const fetchGlobalKeys = async () => {
  try {
    // Cache-first: the durable (IndexedDB) copy paints instantly on every
    // refresh and brand swoop — no one-shot network wait. The network copy is
    // still fetched in the background by readDocCached and lands in the cache
    // for the next swoop automatically.
    const docRef = doc(db, 'settings', 'global');
    const snap = await readDocCached(docRef, undefined, { useCacheForever: true });
    if (snap.exists() && snap.data().apiKeys) {
      return snap.data().apiKeys;
    }
  } catch (err) {
    console.debug("Skipped fetching global keys from cloud due to network or permissions.", err);
  }
  return JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}');
};

export const DEFAULT_AI_PREF: AiModelPref = {
  provider: 'gemini',
  model: 'gemini-3.5-flash',
  autoFallback: true,
};

export const AI_MODEL_OPTIONS: { provider: AiModelPref['provider']; label: string; model: string }[] = [
  { provider: 'gemini', label: 'Gemini Flash 3.5', model: 'gemini-3.5-flash' },
  { provider: 'gemini', label: 'Gemini Flash Latest', model: 'gemini-flash-latest' },
  { provider: 'gemini', label: 'Gemini 2.5 Flash', model: 'gemini-2.5-flash' },
  { provider: 'openrouter', label: 'OpenRouter · GPT-OSS 20B (free)', model: 'openai/gpt-oss-20b:free' },
  { provider: 'openrouter', label: 'OpenRouter · Nemotron 120B (free)', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
  { provider: 'openrouter', label: 'OpenRouter · Cohere North Mini (free)', model: 'cohere/north-mini-code:free' },
  { provider: 'openrouter', label: 'OpenRouter · Gemma 4 31B (free)', model: 'google/gemma-4-31b-it:free' },
  { provider: 'openrouter', label: 'OpenRouter · Nemotron Ultra (free)', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  { provider: 'openrouter', label: 'OpenRouter · Auto free tier', model: 'openrouter/free' },
];

/** True if a stored pref points at a known model option (or a custom endpoint). */
const isValidPref = (p: any): boolean =>
  !!p &&
  !!p.model &&
  (p.provider === 'custom'
    ? true
    : AI_MODEL_OPTIONS.some((o) => o.provider === p.provider && o.model === p.model));

/** Lightweight runtime pref: which provider/model runs every AI action (localStorage, instant). */
export const fetchAiPref = (): AiModelPref => {
  try {
    const raw = localStorage.getItem('fgos_ai_pref');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidPref(parsed)) {
        return { ...DEFAULT_AI_PREF, ...parsed };
      }
      // Stale or corrupted pref (e.g. a model id from an older build). Repair it
      // in place so the model dropdown can never show one model while a
      // different one actually runs every AI action.
      console.warn('AI pref was invalid, resetting to default.', parsed);
      saveAiPref(DEFAULT_AI_PREF);
    }
  } catch (err) {
    console.debug('Failed to parse AI pref, using default.', err);
  }
  return DEFAULT_AI_PREF;
};

export const saveAiPref = (pref: AiModelPref) => {
  localStorage.setItem('fgos_ai_pref', JSON.stringify(pref));
  // Mirror to Firestore so the pref survives device changes and browser
  // clears. Best-effort: the local copy is the fast path and still works
  // offline; the cloud copy is restored on the next app start.
  setDoc(doc(db, 'settings', 'global'), { aiPref: pref }, { merge: true }).catch(() => {});
};

/**
 * Hydrate the AI pref from Firestore into localStorage. Call once at app
 * start (after auth). The cloud copy wins over the local one so a pref
 * saved on another device is restored here.
 */
export const syncAiPrefFromCloud = async (): Promise<void> => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    const cloud = snap.data()?.aiPref;
    if (cloud && isValidPref(cloud)) {
      localStorage.setItem('fgos_ai_pref', JSON.stringify({ ...DEFAULT_AI_PREF, ...cloud }));
    }
  } catch (err) {
    console.debug('AI pref cloud sync skipped (using local):', err);
  }
};
