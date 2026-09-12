import React, { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw, ShoppingCart, TrendingUp, Package, AlertTriangle,
  Store, ExternalLink, CheckCircle2, XCircle, Loader2, BarChart3, Clock
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { fetchGlobalKeys } from '../lib/keys';
import { Brand } from '../types';
import { BrandSwitcher } from './BrandSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelStat { source: string; revenue: number; orders: number; }
interface DailyStat { date: string; revenue: number; orders: number; }
interface BaseOrder {
  orderId: number;
  source: string;
  sourceId: string;
  dateAdded: string | null;
  dateConfirmed: string | null;
  statusId: number;
  complete: boolean;
  paymentDone: boolean;
  paymentMethod: string | null;
  currency: string;
  itemTotal: number;
  deliveryPrice: number;
  total: number;
  itemCount: number;
  buyer: { name: string | null; email: string | null; phone: string | null };
  delivery: { fullname: string | null; city: string | null; postcode: string | null; country: string | null; method: string | null };
  products: { name: string | null; sku: string | null; quantity: number; priceBrutto: number }[];
}
interface BaseProduct { id: number; sku: string | null; name: string | null; ean: string | null; asin: string | null; stock: number; price: number; parentId: number; }
interface SourceInfo { key: string; label: string; id: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  personal: 'In person / by phone',
  shop: 'WooCommerce',
  ebay: 'eBay',
  amazon: 'Amazon',
  google: 'Google Shopping',
  temuuk: 'Temu UK',
  tiktok: 'TikTok Shop',
  order_return: 'Order return',
};

const CHANNEL_COLORS: Record<string, string> = {
  amazon: 'bg-orange-500',
  ebay: 'bg-blue-500',
  shop: 'bg-violet-500',
  google: 'bg-sky-500',
  temuuk: 'bg-rose-500',
  tiktok: 'bg-slate-800',
  personal: 'bg-emerald-500',
  order_return: 'bg-slate-400',
};

const channelLabel = (key: string) => CHANNEL_LABELS[key] || key;
const channelColor = (key: string) => CHANNEL_COLORS[key] || 'bg-slate-500';

const fmtMoney = (n: number, currency = 'GBP') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0);

const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const timeAgo = (iso: string | null) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

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

// ─── KPI card ─────────────────────────────────────────────────────────────────

const KpiCard: React.FC<{ label: string; value: string; sub?: string; icon: React.ReactNode; accent: string }> =
  ({ label, value, sub, icon, accent }) => (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        <div className={`p-2 rounded-lg ${accent}`}>{icon}</div>
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );

// ─── Main component ───────────────────────────────────────────────────────────

interface ScoreboardProps {
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
}

export const Scoreboard: React.FC<ScoreboardProps> = ({ brands, selectedBrandId, onSelectBrand }) => {
  const [token, setToken] = useState<string>('');
  const [tokenReady, setTokenReady] = useState(false);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [score, setScore] = useState<{ totalRevenue: number; totalOrders: number; daily: DailyStat[]; channels: ChannelStat[] } | null>(null);
  const [orders, setOrders] = useState<BaseOrder[]>([]);
  const [products, setProducts] = useState<{ count: number; inStock: number; outOfStock: number; totalStock: number } | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const activeBrand = brands.find((b) => b.id === selectedBrandId) || null;
  const sourceFilter = activeBrand?.baseOrderSources?.length
    ? activeBrand.baseOrderSources.join(',')
    : '';
  const inventoryId = activeBrand?.baseInventoryId || 94059;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const srcParam = sourceFilter ? `&sources=${encodeURIComponent(sourceFilter)}` : '';
      const invParam = activeBrand ? `?inventory_id=${inventoryId}` : '';
      const [statusRes, scoreRes, ordersRes, productsRes] = await Promise.all([
        apiGet<{ sources: SourceInfo[] }>('/api/base/status', token),
        apiGet<{ totalRevenue: number; totalOrders: number; daily: DailyStat[]; channels: ChannelStat[] }>(`/api/base/scoreboard?days=${days}${srcParam}`, token),
        apiGet<{ orders: BaseOrder[] }>(`/api/base/orders?days=${days}${srcParam}`, token),
        apiGet<{ count: number; inStock: number; outOfStock: number; totalStock: number }>(`/api/base/products${invParam}`, token),
      ]);
      setSources(statusRes.sources || []);
      setScore(scoreRes);
      setOrders(ordersRes.orders || []);
      setProducts(productsRes);
      setLastRefresh(new Date());
    } catch (err: any) {
      setError(err.message || 'Could not load scoreboard.');
    } finally {
      setLoading(false);
    }
  }, [token, days, sourceFilter, inventoryId, activeBrand]);

  // Resolve the BaseLinker token from Firestore apiKeys (settings/global).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const keys = await fetchGlobalKeys().catch(() => null);
      const bl = (keys as any)?.baselinker || '';
      if (!cancelled) {
        setToken(bl);
        setTokenReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-load once the token is available.
  useEffect(() => {
    if (tokenReady && token) load();
  }, [tokenReady, token, load]);

  const today = score?.daily?.length ? score.daily[score.daily.length - 1] : null;
  const maxChannelRevenue = Math.max(1, ...(score?.channels || []).map((c) => c.revenue));
  const pendingOrders = orders.filter((o) => !o.complete);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-emerald-600" />
            Multi-Channel Scoreboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeBrand
              ? `Live orders & revenue for ${activeBrand.name} via Base.com (BaseLinker).`
              : 'Live orders & revenue across every sales channel via Base.com (BaseLinker).'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Brand selector — one brand at a time (global switcher) */}
          <BrandSwitcher
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={onSelectBrand}
            allLabel="All brands"
            size="sm"
          />
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium ${days === d ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {d}d
              </button>
            ))}
          </div>
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

      {/* Connection status */}
      {tokenReady && !token && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">BaseLinker token not configured</p>
            <p className="text-sm text-amber-700 mt-1">
              Add your Base.com API token in <span className="font-medium">Settings → API Keys → baselinker</span> (stored in Firestore, never in git), then refresh.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 p-4 flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-800">Could not load scoreboard</p>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      )}

      {loading && !score && (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading scoreboard…
        </div>
      )}

      {!loading && score && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            <KpiCard
              label="Today"
              value={fmtMoney(today?.revenue || 0)}
              sub={`${today?.orders || 0} order${(today?.orders || 0) === 1 ? '' : 's'}`}
              icon={<TrendingUp className="w-4 h-4 text-emerald-600" />}
              accent="bg-emerald-50"
            />
            <KpiCard
              label={`Last ${days} days`}
              value={fmtMoney(score.totalRevenue)}
              sub={`${score.totalOrders} order${score.totalOrders === 1 ? '' : 's'}`}
              icon={<ShoppingCart className="w-4 h-4 text-blue-600" />}
              accent="bg-blue-50"
            />
            <KpiCard
              label="Open orders"
              value={String(pendingOrders.length)}
              sub={`${orders.length} in window`}
              icon={<Store className="w-4 h-4 text-amber-600" />}
              accent="bg-amber-50"
            />
            <KpiCard
              label="Products"
              value={String(products?.count || 0)}
              sub={`${products?.inStock || 0} in stock · ${products?.outOfStock || 0} out`}
              icon={<Package className="w-4 h-4 text-violet-600" />}
              accent="bg-violet-50"
            />
            <KpiCard
              label="Channels"
              value={String(sources.length)}
              sub={lastRefresh ? `Synced ${timeAgo(lastRefresh.toISOString())}` : '—'}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
              accent="bg-emerald-50"
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Revenue by channel */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-4">Revenue by channel</h2>
              {score.channels.length === 0 ? (
                <p className="text-sm text-slate-400 py-8 text-center">No orders yet — revenue will appear here as orders come in.</p>
              ) : (
                <div className="space-y-3">
                  {score.channels.sort((a, b) => b.revenue - a.revenue).map((c) => (
                    <div key={c.source}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2 text-slate-700">
                          <span className={`w-2.5 h-2.5 rounded-full ${channelColor(c.source)}`} />
                          {channelLabel(c.source)}
                        </span>
                        <span className="font-medium text-slate-900">
                          {fmtMoney(c.revenue)} <span className="text-slate-400 font-normal">· {c.orders} ord.</span>
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${channelColor(c.source)}`}
                          style={{ width: `${Math.max(2, (c.revenue / maxChannelRevenue) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily revenue chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800 mb-4">Daily revenue</h2>
              {score.daily.every((d) => d.revenue === 0) ? (
                <p className="text-sm text-slate-400 py-8 text-center">No revenue in this window yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={score.daily} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickFormatter={(d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                    <Tooltip
                      formatter={(v: any) => [fmtMoney(Number(v)), 'Revenue']}
                      labelFormatter={(l: any) => new Date(l).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                    />
                    <Bar dataKey="revenue" fill="#059669" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Orders queue */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Order queue</h2>
              <span className="text-xs text-slate-500">{orders.length} order{orders.length === 1 ? '' : 's'} in last {days} days</span>
            </div>
            {orders.length === 0 ? (
              <p className="text-sm text-slate-400 py-10 text-center">
                No orders yet. This hub will list every order from Amazon, eBay, WooCommerce, TikTok Shop, Temu & Google Shopping as they arrive.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-100">
                      <th className="px-5 py-3 font-medium">Order</th>
                      <th className="px-5 py-3 font-medium">Channel</th>
                      <th className="px-5 py-3 font-medium">Buyer</th>
                      <th className="px-5 py-3 font-medium">Items</th>
                      <th className="px-5 py-3 font-medium">Total</th>
                      <th className="px-5 py-3 font-medium">Payment</th>
                      <th className="px-5 py-3 font-medium">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.orderId} className="border-b border-slate-50 hover:bg-slate-50/50">
                        <td className="px-5 py-3 font-mono text-xs text-slate-700">#{o.orderId}</td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full ${channelColor(o.source)}`} />
                            <span className="text-slate-700">{channelLabel(o.source)}</span>
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-slate-800">{o.buyer.name || o.delivery.fullname || '—'}</p>
                          {o.buyer.email && <p className="text-xs text-slate-400">{o.buyer.email}</p>}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{o.itemCount}</td>
                        <td className="px-5 py-3 font-medium text-slate-900">{fmtMoney(o.total, o.currency)}</td>
                        <td className="px-5 py-3">
                          {o.paymentDone ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
                              <CheckCircle2 className="w-3 h-3" /> Paid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {fmtDate(o.dateConfirmed || o.dateAdded)}
                          <span className="block text-slate-400">{timeAgo(o.dateConfirmed || o.dateAdded)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Connected channels */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Connected channels</h2>
            <div className="flex flex-wrap gap-2">
              {sources.map((s) => (
                <span key={`${s.key}-${s.id}`} className="inline-flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 text-slate-700">
                  <span className={`w-2 h-2 rounded-full ${channelColor(s.key)}`} />
                  {channelLabel(s.key)}
                  <span className="text-slate-400 font-mono">{s.id}</span>
                </span>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-3 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Managed in the Base.com panel — panel-f.baselinker.com
            </p>
          </div>
        </>
      )}
    </div>
  );
};