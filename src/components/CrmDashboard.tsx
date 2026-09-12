import React, { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw, Users, Mail, ShoppingCart, Webhook, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Send, Tag, ListChecks, Key, ExternalLink
} from 'lucide-react';
import { fetchGlobalKeys } from '../lib/keys';
import { BrandSwitcher } from './BrandSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MLGroup { id: number; name: string; total: number; active: number; unsubscribed: number; bounced: number; unconfirmed: number; sent: number; opened: number; clicked: number; }
interface MLSubscriber { id: number; email: string; name: string | null; type: string | null; dateCreated: string | null; dateSubscribe: string | null; sent: number; opened: number; clicked: number; }
interface BrandLite { id: string; name: string; wcConsumerKey?: string; wcConsumerSecret?: string; wpUrl?: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const KNOWN_GROUPS: Record<string, string> = {
  'Pet Food Buyers': '184914413448333113',
  'Dog Walking Customers': '184914414424557090',
  'General Visitors': '184914415107179867',
};

const CHECKLIST = [
  { label: '8 MailerLite groups created (Pet Food Buyers, Dog Walking Customers, General Visitors, Walk Booked, Walk Completed, New Subs, Pet Care Guide Requests, Contact Enquiries)', done: true },
  { label: 'Welcome automation active for each group', done: false },
  { label: '24h appointment reminder automation (triggers on Walk Booked)', done: false },
  { label: 'Post-walk thank-you automation (triggers on Walk Completed)', done: false },
  { label: '7-day re-booking automation (one-off group filter)', done: false },
  { label: 'Abandoned cart automation + WooCommerce plugin connected', done: false },
  { label: 'General Visitor signup form embedded in WordPress footer', done: false },
  { label: 'Pet Food Buyer form on product pages / checkout opt-in', done: false },
  { label: 'Booking form → Walk Booked group → webhook → FGOS records booking', done: false },
  { label: 'WooCommerce sender name/email/footer updated', done: false },
];

const fmtNum = (n: number) => new Intl.NumberFormat('en-GB').format(n || 0);

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Request failed');
  return data as T;
}

async function apiPost<T>(path: string, token: string, body: any): Promise<T> {
  const res = await fetch(`${path}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.message || `Request failed (${res.status})`);
  }
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Request failed');
  return data as T;
}

// ─── Small UI bits ────────────────────────────────────────────────────────────

const Card: React.FC<{ title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }> =
  ({ title, icon, children, right }) => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">{icon}{title}</h2>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );

const StatusPill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span className={`inline-flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
    {ok ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
    {label}
  </span>
);

// ─── Main component ───────────────────────────────────────────────────────────

interface CrmDashboardProps {
  brands: BrandLite[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
}

export const CrmDashboard: React.FC<CrmDashboardProps> = ({ brands, selectedBrandId, onSelectBrand }) => {
  const [token, setToken] = useState<string>('');
  const [tokenReady, setTokenReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<MLGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [subscribers, setSubscribers] = useState<MLSubscriber[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  // Sync panel state
  const [syncBrandId, setSyncBrandId] = useState<string>('');
  const [syncDays, setSyncDays] = useState(90);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  // Webhook panel state
  const [webhookEmail, setWebhookEmail] = useState('');
  const [webhookEvent, setWebhookEvent] = useState('booked');
  const [webhookResult, setWebhookResult] = useState<any>(null);
  const [webhookSending, setWebhookSending] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const status = await apiGet<{ groups: MLGroup[] }>('/api/crm/mailerlite/status', token);
      setGroups(status.groups || []);
      // Auto-select the Pet Food Buyers group if present.
      const pfb = (status.groups || []).find((g) => g.name === 'Pet Food Buyers');
      setSelectedGroup((prev) => prev ?? pfb?.id ?? null);
    } catch (err: any) {
      setError(err.message || 'Could not load MailerLite status.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadSubscribers = useCallback(async (groupId: number) => {
    if (!token) return;
    setSubsLoading(true);
    try {
      const data = await apiGet<{ subscribers: MLSubscriber[] }>(`/api/crm/mailerlite/subscribers?group_id=${groupId}&limit=25`, token);
      setSubscribers(data.subscribers || []);
    } catch (err: any) {
      setSubscribers([]);
    } finally {
      setSubsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const keys = await fetchGlobalKeys().catch(() => null);
      const ml = (keys as any)?.mailerlite || '';
      if (!cancelled) {
        setToken(ml);
        setTokenReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tokenReady && token) load();
  }, [tokenReady, token, load]);

  useEffect(() => {
    if (selectedGroup) loadSubscribers(selectedGroup);
  }, [selectedGroup, loadSubscribers]);

  const runSync = async () => {
    const brand = brands.find((b) => b.id === syncBrandId);
    if (!brand || !token) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const group = groups.find((g) => g.name === 'Pet Food Buyers');
      const result = await apiPost<any>('/api/crm/sync-woo', token, {
        wpUrl: brand.wpUrl,
        key: brand.wcConsumerKey,
        secret: brand.wcConsumerSecret,
        groupId: group?.id,
        days: syncDays,
      });
      setSyncResult(result);
    } catch (err: any) {
      setSyncResult({ error: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const sendWebhook = async () => {
    if (!token || !webhookEmail) return;
    setWebhookSending(true);
    setWebhookResult(null);
    try {
      const result = await apiPost<any>('/api/crm/mailerlite/webhook', token, {
        email: webhookEmail,
        event: webhookEvent,
        name: 'Test Customer',
      });
      setWebhookResult(result);
    } catch (err: any) {
      setWebhookResult({ error: err.message });
    } finally {
      setWebhookSending(false);
    }
  };

  const wcBrands = brands.filter((b) => b.wcConsumerKey && b.wcConsumerSecret);
  const selectedGroupInfo = groups.find((g) => g.id === selectedGroup);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Mail className="w-6 h-6 text-emerald-600" />
            CRM & Automation Sync Engine
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            MailerLite + WooCommerce + Amelia — subscribers, groups, tags and automations in one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <BrandSwitcher
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={onSelectBrand}
            allLabel="All brands"
            size="sm"
          />
          <button
            onClick={load}
            disabled={loading || !token}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Token missing warning */}
      {tokenReady && !token && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">MailerLite token not configured</p>
            <p className="text-sm text-amber-700 mt-1">
              Add your MailerLite API token in <span className="font-medium">Settings → API Keys → mailerlite</span> (MailerLite dashboard → Integrations → API), then refresh.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Could not load CRM status</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {loading && !groups.length && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading CRM status…
        </div>
      )}

      {!loading && groups.length > 0 && (
        <>
          {/* Groups overview */}
          <div className="grid md:grid-cols-3 gap-4 mb-6">
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroup(g.id)}
                className={`text-left bg-white rounded-xl border p-4 shadow-sm transition ${selectedGroup === g.id ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800">{g.name}</p>
                  <Users className="w-4 h-4 text-slate-400" />
                </div>
                <p className="text-2xl font-bold text-slate-900 mt-2">{fmtNum(g.total)}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {fmtNum(g.active)} active · {fmtNum(g.unconfirmed)} unconfirmed · {fmtNum(g.unsubscribed)} unsubscribed
                </p>
              </button>
            ))}
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Subscribers in selected group */}
            <Card
              title={`Subscribers — ${selectedGroupInfo?.name || 'group'}`}
              icon={<Users className="w-4 h-4 text-emerald-600" />}
              right={subsLoading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <span className="text-xs text-slate-500">{subscribers.length} shown</span>}
            >
              {subscribers.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">No subscribers in this group yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {subscribers.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.name || s.email}</p>
                        <p className="text-xs text-slate-500 truncate">{s.email}</p>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <p className="text-xs text-slate-600">{fmtNum(s.opened)} opened · {fmtNum(s.clicked)} clicked</p>
                        <p className="text-[10px] text-slate-400">{s.dateSubscribe ? new Date(s.dateSubscribe).toLocaleDateString('en-GB') : '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* WooCommerce → MailerLite sync */}
            <Card
              title="WooCommerce → MailerLite sync"
              icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
              right={<StatusPill ok={wcBrands.length > 0} label={wcBrands.length > 0 ? `${wcBrands.length} WC brands` : 'No WC creds'} />}
            >
              <p className="text-xs text-slate-500 mb-3">
                Pull recent WooCommerce orders for a brand and add the buyers to the <strong>Pet Food Buyers</strong> group (deduped by email).
              </p>
              <div className="flex flex-wrap gap-2 mb-3">
                <select
                  value={syncBrandId}
                  onChange={(e) => setSyncBrandId(e.target.value)}
                  className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Select brand…</option>
                  {wcBrands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <select
                  value={syncDays}
                  onChange={(e) => setSyncDays(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700"
                >
                  {[30, 90, 180, 365].map((d) => <option key={d} value={d}>last {d}d</option>)}
                </select>
                <button
                  onClick={runSync}
                  disabled={syncing || !syncBrandId || !token}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Sync buyers
                </button>
              </div>
              {syncResult && (
                <div className={`p-3 rounded-lg text-xs ${syncResult.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                  {syncResult.error ? (
                    <p>{syncResult.error}</p>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold">Sync complete</p>
                      <p>{syncResult.ordersScanned} orders scanned · {syncResult.uniqueBuyers} unique buyers</p>
                      <p><strong>{syncResult.added}</strong> added · <strong>{syncResult.existing}</strong> already in group · {syncResult.failed} failed</p>
                      {syncResult.errors?.length > 0 && (
                        <p className="text-red-600">{syncResult.errors.join('; ')}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* MailerLite webhook */}
            <Card
              title="MailerLite webhook → walk groups"
              icon={<Webhook className="w-4 h-4 text-violet-600" />}
              right={<StatusPill ok={!!token} label={token ? 'Ready' : 'No token'} />}
            >
              <p className="text-xs text-slate-500 mb-3">
                MailerLite automations call this endpoint when a booking happens; the engine moves the subscriber
                between <code className="bg-slate-100 px-1 rounded">Walk Booked</code> and <code className="bg-slate-100 px-1 rounded">Walk Completed</code> groups,
                which triggers the reminder / thank-you / re-booking automations.
              </p>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 font-mono text-[11px] text-slate-600 mb-3 break-all">
                POST {window.location.origin}/api/crm/mailerlite/webhook
              </div>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  type="email"
                  value={webhookEmail}
                  onChange={(e) => setWebhookEmail(e.target.value)}
                  placeholder="test@example.com"
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-violet-500 focus:outline-none"
                />
                <select
                  value={webhookEvent}
                  onChange={(e) => setWebhookEvent(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700"
                >
                  <option value="booked">booked → Walk Booked</option>
                  <option value="completed">completed → Walk Completed</option>
                  <option value="cancelled">cancelled → remove from Walk Booked</option>
                </select>
                <button
                  onClick={sendWebhook}
                  disabled={webhookSending || !webhookEmail || !token}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
                >
                  {webhookSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-4 h-4" />}
                  Test webhook
                </button>
              </div>
              {webhookResult && (
                <div className={`p-3 rounded-lg text-xs ${webhookResult.error ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                  {webhookResult.error ? <p>{webhookResult.error}</p> : (
                    <p>Moved <strong>{webhookResult.email}</strong>: {webhookResult.mapped} — {webhookResult.actions?.join(', ')}</p>
                  )}
                </div>
              )}
            </Card>

            {/* Automation checklist */}
            <Card
              title="Automation checklist (from spec)"
              icon={<ListChecks className="w-4 h-4 text-amber-600" />}
              right={<span className="text-xs text-slate-500">{CHECKLIST.filter((c) => c.done).length}/{CHECKLIST.length} done</span>}
            >
              <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {CHECKLIST.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {c.done ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full border border-slate-300 mt-0.5 shrink-0" />
                    )}
                    <span className={c.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{c.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Full spec: daniels_petfoods_automation_specs.md (MailerLite dashboard builds the automations)
              </p>
            </Card>
          </div>

          {/* Connection info */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
              <Key className="w-4 h-4 text-slate-500" /> Connection
            </h2>
            <div className="flex flex-wrap gap-2">
              <StatusPill ok={!!token} label={token ? 'MailerLite API connected' : 'MailerLite token missing'} />
              <StatusPill ok={groups.length > 0} label={`${groups.length} groups found`} />
              <StatusPill ok={wcBrands.length > 0} label={`${wcBrands.length} brands with WooCommerce creds`} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};