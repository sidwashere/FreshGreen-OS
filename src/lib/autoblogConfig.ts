import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Per-brand AutoBlog configuration.
 *
 * Persistence model (production-grade):
 *  - Firestore `settings/autoblog` doc (brands map) is the SOURCE OF TRUTH —
 *    survives browser clears, device changes and multi-user access.
 *  - localStorage `fgos_autoblog_cfg_<brandId>` is the offline cache so the
 *    UI renders instantly and works when Firestore is unreachable.
 *  - Legacy flat keys (`fgos_autoblog_cadence`, `fgos_autoblog_start_date`,
 *    `fgos_autoblog_auto_publish`, `fgos_autoblog_sheet_url_<brandId>`) are
 *    read once as a migration fallback when no per-brand cache exists yet.
 */
export interface AutoblogConfig {
  sheetUrl: string;
  cadenceDays: number;
  startDate: string;
  autoPublish: boolean;
  defaultTone: string;
  defaultWordCount: number;
  autoGenerateImages: boolean;
  autoSeoAnalysis: boolean;
  autoHumanize: boolean;
  updatedAt?: string;
}

export const defaultAutoblogConfig = (): AutoblogConfig => ({
  sheetUrl: '',
  cadenceDays: 3,
  startDate: new Date().toISOString().split('T')[0],
  autoPublish: true,
  defaultTone: 'professional',
  defaultWordCount: 1500,
  autoGenerateImages: true,
  autoSeoAnalysis: true,
  autoHumanize: false,
});

const cfgKey = (brandId: string) => `fgos_autoblog_cfg_${brandId || 'none'}`;

/** Load the per-brand config from the local cache (with legacy-key migration). */
export function loadAutoblogConfig(brandId: string): AutoblogConfig {
  const key = cfgKey(brandId);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...defaultAutoblogConfig(), ...parsed };
      }
    }
  } catch { /* corrupted cache — fall through to legacy keys */ }

  // Legacy migration: the old flat keys were global (cadence/start/auto-publish)
  // and per-brand (sheet URL). Read them once so nothing is lost on upgrade.
  try {
    return {
      ...defaultAutoblogConfig(),
      sheetUrl: localStorage.getItem(`fgos_autoblog_sheet_url_${brandId || 'none'}`) || '',
      cadenceDays: parseInt(localStorage.getItem('fgos_autoblog_cadence') || '3', 10) || 3,
      startDate: localStorage.getItem('fgos_autoblog_start_date') || defaultAutoblogConfig().startDate,
      autoPublish: localStorage.getItem('fgos_autoblog_auto_publish') !== '0',
    };
  } catch {
    return defaultAutoblogConfig();
  }
}

/** Write the per-brand config to the local cache (instant, offline-safe). */
export function saveAutoblogConfigLocal(brandId: string, cfg: AutoblogConfig): void {
  try {
    localStorage.setItem(cfgKey(brandId), JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }));
  } catch { /* storage full / private mode — cloud save still covers us */ }
}

/** Fetch the per-brand config from Firestore (source of truth). Null if absent. */
export async function fetchAutoblogConfigCloud(brandId: string): Promise<AutoblogConfig | null> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'autoblog'));
    const perBrand = snap.data()?.brands?.[brandId];
    if (perBrand && typeof perBrand === 'object') {
      return { ...defaultAutoblogConfig(), ...perBrand };
    }
  } catch (err) {
    console.debug('[AutoblogConfig] cloud fetch failed (using local cache):', err);
  }
  return null;
}

/** Persist the per-brand config to Firestore (debounced by the caller). */
export async function saveAutoblogConfigCloud(brandId: string, cfg: AutoblogConfig): Promise<void> {
  try {
    await setDoc(
      doc(db, 'settings', 'autoblog'),
      { brands: { [brandId]: { ...cfg, updatedAt: new Date().toISOString() } } },
      { merge: true },
    );
  } catch (err) {
    console.debug('[AutoblogConfig] cloud save failed (local cache kept):', err);
  }
}

/** Read every brand's config from Firestore (used by Backup & Restore). */
export async function fetchAllAutoblogConfigsCloud(): Promise<Record<string, AutoblogConfig>> {
  try {
    const snap = await getDoc(doc(db, 'settings', 'autoblog'));
    const brands = snap.data()?.brands || {};
    const out: Record<string, AutoblogConfig> = {};
    for (const [brandId, cfg] of Object.entries(brands)) {
      if (cfg && typeof cfg === 'object') out[brandId] = { ...defaultAutoblogConfig(), ...cfg };
    }
    return out;
  } catch (err) {
    console.debug('[AutoblogConfig] fetch-all failed:', err);
    return {};
  }
}

/** Restore every brand's config into Firestore (used by Backup & Restore). */
export async function restoreAllAutoblogConfigsCloud(configs: Record<string, AutoblogConfig>): Promise<void> {
  try {
    await setDoc(doc(db, 'settings', 'autoblog'), { brands: configs }, { merge: true });
  } catch (err) {
    console.debug('[AutoblogConfig] restore failed:', err);
    throw err;
  }
}