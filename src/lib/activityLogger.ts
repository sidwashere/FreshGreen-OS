import { collection, doc, setDoc, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';

export type ActivityCategory = 'generation' | 'api_request' | 'error' | 'event' | 'output';
export type ActivityStatus = 'success' | 'error' | 'warning' | 'info';

export interface ActivityLog {
  id: string;
  timestamp: string; // ISO string
  category: ActivityCategory;
  status: ActivityStatus;
  action: string;
  title: string;
  message: string;
  brandId?: string;
  brandName?: string;
  userId?: string;
  userEmail?: string;
  payload?: Record<string, any>;
  response?: Record<string, any>;
  durationMs?: number;
  ip?: string;
}

/**
 * Persistently record an activity log entry in Firestore (`activity_logs` collection)
 * and optionally mirror to local buffer for offline instant UI feedback.
 */
export async function logActivity(entry: Omit<ActivityLog, 'id' | 'timestamp'>): Promise<string> {
  const logId = `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const currentUser = auth.currentUser;
  
  const fullLog: ActivityLog = {
    id: logId,
    timestamp: new Date().toISOString(),
    userId: currentUser?.uid || entry.userId || 'system',
    userEmail: currentUser?.email || entry.userEmail || 'system@fgos.local',
    ...entry,
  };

  try {
    // 1. Save directly to Firestore for app-wide persistence
    await setDoc(doc(db, 'activity_logs', logId), fullLog);
  } catch (err) {
    console.warn('[ActivityLogger] Firestore direct save failed, sending to server API:', err);
    // 2. Fallback to server API logger endpoint
    try {
      await fetch('/api/logs/record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullLog),
      });
    } catch (apiErr) {
      console.error('[ActivityLogger] Failed to persist log:', apiErr);
    }
  }

  return logId;
}

/**
 * Subscribe to real-time activity logs from Firestore.
 */
export function subscribeToLogs(
  onLogs: (logs: ActivityLog[]) => void,
  options?: { category?: ActivityCategory; brandId?: string; maxLogs?: number }
) {
  const max = options?.maxLogs || 250;
  const uid = auth.currentUser?.uid || 'unknown';
  // Scope to the current user's entries plus system-generated server entries.
  // This matches the Firestore rules: userId in [uid, 'system'].
  const constraints: any[] = [where('userId', 'in', [uid, 'system']), orderBy('timestamp', 'desc'), limit(max)];

  if (options?.category) {
    constraints.unshift(where('category', '==', options.category));
  }
  if (options?.brandId) {
    constraints.unshift(where('brandId', '==', options.brandId));
  }

  const q = query(collection(db, 'activity_logs'), ...constraints);

  return onSnapshot(
    q,
    (snapshot) => {
      const logs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog));
      onLogs(logs);
    },
    (error) => {
      console.error('[ActivityLogger] Snapshot subscription error:', error);
    }
  );
}
