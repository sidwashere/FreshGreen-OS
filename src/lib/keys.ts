import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { AiModelPref } from '../types';

export const fetchGlobalKeys = async () => {
  try {
    const docRef = doc(db, 'settings', 'global');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists() && docSnap.data().apiKeys) {
      return docSnap.data().apiKeys;
    }
  } catch (err) {
    console.debug("Skipped fetching global keys from cloud due to network or permissions.", err);
  }
  return JSON.parse(localStorage.getItem('greenops_byok_keys') || '{}');
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
    const raw = localStorage.getItem('greenops_ai_pref');
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
  localStorage.setItem('greenops_ai_pref', JSON.stringify(pref));
};
