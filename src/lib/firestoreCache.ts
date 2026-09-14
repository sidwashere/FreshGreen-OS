import { getDoc, getDocFromCache, DocumentSnapshot, DocumentReference } from 'firebase/firestore';

/**
 * Cache-first single-document reader.
 *
 * Reads the document from Firestore's own durable (IndexedDB) cache first so
 * the UI paints instantly on every refresh and brand swoop — no waiting on a
 * one-shot network round-trip. The network copy is still fetched in the
 * background and, when it arrives, passed to `onFresh` so live data always
 * wins a moment later. Unless `onFresh` is provided (competing setState from
 * a live onSnapshot), the freshest doc is the resolved value.
 *
 * The cache survives browser reloads and device churn automatically because it
 * lives in Firestore's on-disk persistence layer (retention ≫ 10 min).
 *
 * @param ref     Document to read.
 * @param onFresh Optional callback invoked with the network snapshot when it
 *                lands (use this to feed an onSnapshot-style setState so the
 *                cache is only the instant "prime", never the truth).
 * @param opts.useCacheForever When true and no onFresh is given, the cache hit
 *                is returned as-is and the network read only runs to refresh
 *                the cache (won't double-write state). Default false.
 */
export async function readDocCached<T = unknown>(
  ref: DocumentReference<T>,
  onFresh?: (fresh: DocumentSnapshot<T>) => void,
  opts?: { useCacheForever?: boolean }
): Promise<DocumentSnapshot<T>> {
  // 1) Instant paint path — serve from the on-disk cache (no network wait).
  try {
    const cached = await getDocFromCache(ref);
    if (cached.exists()) {
      if (onFresh) {
        // Caller owns the live state; give them the cached copy now so they can
        // render immediately, then let them apply `onFresh` when the network
        // copy lands.
        void fetchFresh(ref, onFresh);
        return cached;
      }
      if (opts?.useCacheForever) {
        // Cache is the source for painting; refresh it in the background by
        // throwing the fetch away (result is cached by Firestore automatically).
        void fetchFresh(ref);
        return cached;
      }
      // No dedicated onFresh: block on the network copy so callers that need
      // guaranteed-fresh data (e.g. backup export) still get it.
      const fresh = await getDoc(ref);
      return fresh.exists() ? fresh : cached;
    }
  } catch {
    // No cache yet (first visit) or persistence unavailable — fall through to network.
  }

  // 2) Cold path — no cache: do a normal network read.
  const snap = await getDoc(ref);
  if (onFresh) onFresh(snap);
  return snap;
}

async function fetchFresh<T>(ref: DocumentReference<T>, onApply?: (snap: DocumentSnapshot<T>) => void): Promise<void> {
  try {
    const snap = await getDoc(ref);
    if (onApply) onApply(snap);
    // (No snapshot returned to caller — the read itself refreshes Firestore's
    // local cache for the next swoop automatically.)
  } catch (err) {
    console.debug('[FirestoreCache] background refresh failed (cache retained):', err);
  }
}
