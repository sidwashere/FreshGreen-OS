import React, { useMemo, useState } from 'react';
import { ContentItem, Brand } from '../types';
import { countWords, deriveWpState, syncItemToWp, refreshWpState, publishGate, WpState } from '../lib/wpSync';
import { runSeoFix } from '../lib/seoFix';
import { fetchAiPref } from '../lib/keys';
import { BlogRegisterEntry } from '../lib/blogRegister';
import { BlogRegister } from './BlogRegister';
import {
  Search,
  RefreshCw,
  ExternalLink,
  PenLine,
  Send,
  Trash2,
  Plus,
  Globe,
  Eye,
  Clock,
  Calendar,
  Download,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Library,
  Hash,
} from 'lucide-react';

interface ContentHubProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
  onEditItem: (item: ContentItem) => void;
  onSaveItem: (item: ContentItem) => void;
  onCreateNewItem: (title: string, brandId: string, contentType: 'post' | 'page') => void;
  onDeleteItem: (item: ContentItem) => Promise<{ success: boolean; message?: string }>;
  onDeleteEntry: (entryId: string) => Promise<{ success: boolean; message?: string }>;
  onImportWPPosts: (posts: any[], brand: Brand) => Promise<number>;
  /** Opens the unified step-by-step New Blog wizard. */
  onOpenWizard: () => void;
  onNavigateTab?: (tab: string) => void;
  register?: BlogRegisterEntry[];
}

type Filter = 'all' | 'live' | 'draft' | 'none';

const timeAgo = (iso?: string): string => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const stageChip: Record<string, string> = {
  Planned: 'bg-slate-100 text-slate-600',
  Researching: 'bg-violet-100 text-violet-700',
  Generating: 'bg-amber-100 text-amber-700',
  Draft_Ready: 'bg-sky-100 text-sky-700',
  Published: 'bg-emerald-100 text-emerald-700',
  Error: 'bg-red-100 text-red-700',
};

const wpStateMeta: Record<WpState, { label: string; cls: string; dot: string }> = {
  live: { label: 'LIVE', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  draft: { label: 'DRAFT', cls: 'bg-sky-50 text-sky-700 border-sky-200', dot: 'bg-sky-500' },
  none: { label: 'NOT ON WP', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
};

export const ContentHub: React.FC<ContentHubProps> = ({
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
  onSaveItem,
  onCreateNewItem,
  onDeleteItem,
  onDeleteEntry,
  onImportWPPosts,
  onOpenWizard,
  onNavigateTab,
  register = [],
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [trashArmId, setTrashArmId] = useState<string | null>(null);
  const [wpPosts, setWpPosts] = useState<any[] | null>(null);
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [view, setView] = useState<'posts' | 'register'>('posts');

  const brand = brands.find((b) => b.id === selectedBrandId) || null;
  const brandScoped = selectedBrandId !== 'all';

  // Items visible in this hub (brand-scoped, or everything when 'all').
  const scoped = useMemo(
    () => (brandScoped ? items.filter((i) => i.brandId === selectedBrandId) : items),
    [items, selectedBrandId, brandScoped],
  );

  const withState = useMemo(
    () => scoped.map((i) => ({ item: i, state: deriveWpState(i) })),
    [scoped],
  );

  const counts = useMemo(() => {
    let live = 0, draft = 0, none = 0, words = 0;
    for (const { item, state } of withState) {
      if (state === 'live') live++;
      else if (state === 'draft') draft++;
      else none++;
      words += countWords(item.bodyHtml || '');
    }
    return { total: scoped.length, live, draft, none, words };
  }, [withState, scoped.length]);

  const lastSynced = useMemo(() => {
    let newest: string | undefined;
    for (const { item } of withState) {
      if (item.lastSyncedAt && (!newest || item.lastSyncedAt > newest)) newest = item.lastSyncedAt;
    }
    return newest;
  }, [withState]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withState
      .filter(({ state }) => filter === 'all' || state === filter)
      .filter(({ item }) =>
        !q ||
        (item.title || '').toLowerCase().includes(q) ||
        (item.slug || '').toLowerCase().includes(q) ||
        (item.primaryKeyword || '').toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const ta = a.item.lastSyncedAt || a.item.updatedAt || a.item.createdAt || '';
        const tb = b.item.lastSyncedAt || b.item.updatedAt || b.item.createdAt || '';
        return tb.localeCompare(ta);
      });
  }, [withState, filter, search]);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice((n) => (n?.text === text ? null : n)), 5000);
  };

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy((prev) => new Set(prev).add(id));
    try {
      flash('ok', await fn());
    } catch (err: any) {
      flash('err', err?.message || 'Action failed.');
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handlePublish = async (item: ContentItem) => {
    if (!brand) return;
    const gate = publishGate(item, brand, deriveWpState(item) === 'live');
    if (!gate.ok) {
      flash('err', gate.reason || 'Publish blocked.');
      return;
    }
    await run(item.id, async () => {
      const res = await syncItemToWp(brand, item, 'publish');
      if (res.ok && res.updated) {
        onSaveItem(res.updated);
        return res.message;
      }
      throw new Error(res.message);
    });
  };

  const handleSaveDraft = async (item: ContentItem) => {
    if (!brand) return;
    await run(item.id, async () => {
      const res = await syncItemToWp(brand, item, 'draft');
      if (res.ok && res.updated) {
        onSaveItem(res.updated);
        return res.message;
      }
      throw new Error(res.message);
    });
  };

  const handleRefresh = async (item: ContentItem) => {
    if (!brand) return;
    await run(item.id, async () => {
      const res = await refreshWpState(brand, item);
      if (res.ok && res.updated) {
        onSaveItem(res.updated);
        return res.message;
      }
      throw new Error(res.message);
    });
  };

  const handleTrash = async (item: ContentItem) => {
    setTrashArmId(null);
    await run(item.id, async () => {
      const res = await onDeleteItem(item);
      if (res.success) return `Deleted "${item.title}" — its WordPress post was moved to the trash.`;
      throw new Error(res.message || 'Could not delete the item.');
    });
  };

  // Shared AI SEO fix pipeline: audit the noted issues, fix them with best
  // practices (keyphrase, meta title/description, slug, content rewrite),
  // humanise, re-test — then save so the publish button unlocks.
  const handleSeoFix = async (item: ContentItem) => {
    if (!brand) return;
    setFixingId(item.id);
    try {
      const r = await runSeoFix({
        title: item.title,
        contentType: item.contentType,
        slug: item.slug,
        metaTitle: item.metaTitle,
        metaDescription: item.metaDescription,
        primaryKeyword: item.primaryKeyword,
        secondaryKeywords: item.secondaryKeywords,
        bodyHtml: item.bodyHtml,
        featuredImageUrl: item.featuredImageUrl,
        brand,
        siteUrl: brand.wpUrl,
        modelPref: fetchAiPref(),
        humanize: true,
      });
      if (Object.keys(r.patch).length > 0) {
        onSaveItem({ ...item, ...r.patch, status: 'Draft_Ready', updatedAt: new Date().toISOString() });
      }
      if (r.ok) {
        flash('ok', r.fixed.length ? `Fixed — ${r.message}` : r.message);
      } else {
        flash('err', r.message);
      }
    } catch (err: any) {
      flash('err', err?.message || 'SEO fix failed.');
    } finally {
      setFixingId(null);
    }
  };

  // Credential problems can't be fixed by AI — those need the user's input.
  const aiFixable = (reason: string) => !/credentials|connection details|brand/i.test(reason);

  const handlePull = async () => {
    if (!brand || !brand.wpUrl || !brand.wpUsername || !brand.wpAppPassword) {
      flash('err', 'Select a brand with WordPress credentials (Brands & Settings) first.');
      return;
    }
    setPulling(true);
    try {
      const res = await fetch('/api/wp/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpUrl: brand.wpUrl,
          wpUsername: brand.wpUsername,
          wpAppPassword: brand.wpAppPassword,
          per_page: 100,
          status: 'any',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Could not fetch posts from WordPress.');
      setWpPosts(data.posts || []);
      flash('ok', `Pulled ${(data.posts || []).length} posts from WordPress (${brand.name}).`);
    } catch (err: any) {
      flash('err', err?.message || 'Pull failed.');
    } finally {
      setPulling(false);
    }
  };

  const unmirrored = useMemo(() => {
    if (!wpPosts || !brand) return [];
    return wpPosts.filter(
      (p) => !items.some((i) => i.brandId === brand.id && i.wpPostId === p.id),
    );
  }, [wpPosts, items, brand]);

  const handleImportAll = async () => {
    if (!brand || !unmirrored.length) return;
    setImporting(true);
    try {
      const n = await onImportWPPosts(unmirrored, brand);
      setWpPosts(null);
      flash('ok', n > 0 ? `Imported ${n} post${n === 1 ? '' : 's'} from WordPress into the pipeline.` : 'Everything is already mirrored in the app.');
    } catch (err: any) {
      flash('err', err?.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const quickCreate = () => {
    // Route through the unified step-by-step wizard so every entry point
    // offers the same guided flow (brand, type, title, keywords, confirm).
    // A title typed here pre-fills the wizard's title step.
    onOpenWizard(newTitle.trim());
  };

  const statCards = [
    { label: 'Total posts', value: counts.total, cls: 'text-slate-900', sub: 'in this workspace' },
    { label: 'Live on WordPress', value: counts.live, cls: 'text-emerald-600', sub: 'published & visible' },
    { label: 'Drafts', value: counts.draft, cls: 'text-sky-600', sub: 'saved to WP, hidden' },
    { label: 'Not on WP yet', value: counts.none, cls: 'text-amber-600', sub: 'need a first publish' },
    { label: 'Words written', value: counts.words.toLocaleString(), cls: 'text-slate-900', sub: `avg ${counts.total ? Math.round(counts.words / counts.total).toLocaleString() : 0} / post` },
    { label: 'Last sync', value: timeAgo(lastSynced), cls: 'text-slate-900', sub: 'to WordPress' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Blog Manager</h1>
          <p className="text-[12px] text-slate-500 mt-1">
            Manage every draft and live post, and track each blog's permanent reference number in the
            register — publish, unpublish, refresh and pull history straight from WordPress.
          </p>
        </div>
        <button
          onClick={() => onNavigateTab?.('pipeline')}
          className="shrink-0 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 text-[12px] font-bold transition"
        >
          Open dashboard →
        </button>
      </div>

      {/* View switcher: Posts | Register */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setView('posts')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-bold transition ${
            view === 'posts' ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Library className="w-4 h-4" /> Posts
          <span className={`ml-1 tabular-nums ${view === 'posts' ? 'text-slate-300' : 'text-slate-400'}`}>{scoped.length}</span>
        </button>
        <button
          onClick={() => setView('register')}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-[12px] font-bold transition ${
            view === 'register' ? 'bg-emerald-700 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Hash className="w-4 h-4" /> Blog Register
          <span className={`ml-1 tabular-nums ${view === 'register' ? 'text-emerald-100' : 'text-slate-400'}`}>
            {brandScoped ? register.filter((r) => r.brandId === selectedBrandId).length : register.length}
          </span>
        </button>
      </div>

      {view === 'register' ? (
        <BlogRegister
          register={register}
          items={items}
          brands={brands}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          onEditItem={onEditItem}
          onDeleteItem={onDeleteItem}
          onDeleteEntry={onDeleteEntry}
        />
      ) : (
      <>
      {/* Notice */}
      {notice && (
        <div
          className={`flex items-start gap-2 px-4 py-3 rounded-2xl border text-[12px] font-semibold ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {notice.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* Quick create + brand */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Brand</span>
          <select
            value={selectedBrandId}
            onChange={(e) => onSelectBrand(e.target.value)}
            className="text-[13px] font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 flex gap-2">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && quickCreate()}
            placeholder="New post title… (opens the step-by-step wizard)"
            className="flex-1 min-w-0 text-[13px] px-3.5 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            onClick={quickCreate}
            className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-bold transition"
          >
            <Plus className="w-4 h-4" /> New post
          </button>
        </div>
        <button
          onClick={handlePull}
          disabled={pulling || !brandScoped}
          title={!brandScoped ? 'Select a single brand to pull its WordPress history.' : undefined}
          className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[12px] font-bold transition disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> {pulling ? 'Pulling…' : 'Pull from WordPress'}
        </button>
      </div>

      {/* WP history panel */}
      {brandScoped && wpPosts !== null && (
        <div className="bg-white rounded-2xl border border-slate-200/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-4 h-4 text-slate-400" /> WordPress history — {brand?.name}
            </h2>
            <button onClick={() => setWpPosts(null)} className="text-[11px] font-bold text-slate-400 hover:text-slate-700">
              Hide
            </button>
          </div>
          {unmirrored.length === 0 ? (
            <p className="text-[12px] text-slate-500">
              All {wpPosts.length} post{wpPosts.length === 1 ? '' : 's'} on WordPress are already mirrored in the app.
            </p>
          ) : (
            <>
              <p className="text-[12px] text-slate-500">
                {unmirrored.length} historic post{unmirrored.length === 1 ? '' : 's'} found on WordPress but not in the app.
                Import them into the pipeline to manage them here (drafts import as drafts, live ones as published).
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {unmirrored.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-slate-800 truncate">{p.title?.rendered || '(untitled)'}</div>
                      <div className="text-[11px] text-slate-400 truncate">
                        #{p.id} · {p.status} · {p.link || ''}
                      </div>
                    </div>
                    <button
                      onClick={() => void onImportWPPosts([p], brand!).then((n) => { setWpPosts(null); flash('ok', n > 0 ? `Imported "${p.title?.rendered || 'post'}" into the pipeline.` : 'Already mirrored.'); })}
                      disabled={importing}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold transition disabled:opacity-40"
                    >
                      Import
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => void handleImportAll()}
                disabled={importing}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-[12px] font-bold transition disabled:opacity-40"
              >
                {importing ? 'Importing…' : `Import all ${unmirrored.length} into the pipeline`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-200/70 p-3.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{s.label}</div>
            <div className={`text-xl font-bold tabular-nums mt-1 ${s.cls}`}>{s.value}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters + search */}
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
        <div className="flex items-center gap-1.5 flex-wrap">
          {([
            ['all', 'All'],
            ['live', 'Live'],
            ['draft', 'Drafts'],
            ['none', 'Not on WP'],
          ] as [Filter, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition ${
                filter === id ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {label}
              <span className={`ml-1.5 tabular-nums ${filter === id ? 'text-slate-300' : 'text-slate-400'}`}>
                {id === 'all' ? counts.total : id === 'live' ? counts.live : id === 'draft' ? counts.draft : counts.none}
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, slug, keyphrase…"
            className="w-full sm:w-64 text-[12px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
        </div>
      </div>

      {/* List */}
      <div className="space-y-2.5">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/70 p-8 text-center">
            <p className="text-[13px] font-semibold text-slate-600">No posts match this view.</p>
            <p className="text-[12px] text-slate-400 mt-1">
              Pull your WordPress history above, or create a new post to get started.
            </p>
          </div>
        ) : (
          filtered.map(({ item, state }) => {
            const isBusy = busy.has(item.id);
            const meta = wpStateMeta[state];
            const gate = brand ? publishGate(item, brand, state === 'live') : { ok: false, reason: 'Select a brand first.' };
            const liveUrl = item.wpLiveUrl || (state === 'live' && brand?.wpUrl ? `${brand.wpUrl.replace(/\/+$/, '')}/?p=${item.wpPostId}` : '');
            const previewUrl = item.wpPreviewUrl || (brand?.wpUrl && item.wpPostId ? `${brand.wpUrl.replace(/\/+$/, '')}/?p=${item.wpPostId}&preview=true` : '');
            return (
              <div key={item.id} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3 p-4">
                  {/* Identity */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} /> {meta.label}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${stageChip[item.status] || 'bg-slate-100 text-slate-600'}`}>
                        {item.status}
                      </span>
                      {item.wpPostId ? <span className="text-[10px] font-semibold text-slate-400">post #{item.wpPostId}</span> : null}
                    </div>
                    <button onClick={() => onEditItem(item)} className="mt-1.5 block text-left">
                      <span className="text-[14px] font-bold text-slate-900 hover:text-indigo-700 hover:underline line-clamp-1">{item.title}</span>
                    </button>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400 flex-wrap">
                      <span className="inline-flex items-center gap-1"><PenLine className="w-3 h-3" /> {countWords(item.bodyHtml || '').toLocaleString()} words</span>
                      <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> synced {timeAgo(item.lastSyncedAt)}</span>
                      {/* Inline publish date picker — works at any stage */}
                      {item.status !== 'Published' && (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          <input
                            type="date"
                            defaultValue={item.scheduledPublishAt ? new Date(item.scheduledPublishAt).toISOString().split('T')[0] : ''}
                            onChange={(e) => {
                              if (e.target.value) {
                                const time = item.scheduledPublishAt
                                  ? new Date(item.scheduledPublishAt).toTimeString().slice(0, 5)
                                  : '09:00';
                                const dt = new Date(`${e.target.value}T${time}:00`);
                                if (dt.getTime() <= Date.now()) return; // ignore past dates
                                onSaveItem({ ...item, scheduledPublishAt: dt.toISOString(), updatedAt: new Date().toISOString() });
                              }
                            }}
                            className="px-1 py-0.5 border border-slate-200 rounded text-[10px] focus:ring-2 focus:ring-violet-500 outline-none bg-white"
                            title="Set publish date"
                          />
                        </span>
                      )}
                      {item.scheduledPublishAt && item.status !== 'Published' && (
                        <button
                          onClick={() => onSaveItem({ ...item, scheduledPublishAt: undefined, updatedAt: new Date().toISOString() })}
                          className="text-[10px] text-slate-400 hover:text-red-500 transition"
                          title="Clear publish date"
                        >
                          ✕
                        </button>
                      )}
                      {item.slug && <span className="hidden md:inline truncate max-w-[240px]">/{item.slug}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                    {state !== 'none' && (liveUrl || previewUrl) && (
                      <a
                        href={liveUrl || previewUrl}
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800 border border-transparent transition"
                        title={liveUrl ? 'Open the live post' : 'Open the WordPress draft preview'}
                      >
                        {liveUrl ? <ExternalLink className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />} View
                      </a>
                    )}
                    <button
                      onClick={() => handleRefresh(item)}
                      disabled={isBusy || state === 'none'}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-800 border border-transparent transition disabled:opacity-40"
                      title="Re-check the real status on WordPress"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    <button
                      onClick={() => handleSaveDraft(item)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-sky-200 text-sky-700 hover:bg-sky-50 transition disabled:opacity-40"
                    >
                      {state === 'live' ? 'Switch to draft' : 'Save draft'}
                    </button>
                    <button
                      onClick={() => handlePublish(item)}
                      disabled={isBusy || !gate.ok}
                      title={gate.ok ? undefined : gate.reason}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Send className="w-3.5 h-3.5" /> {state === 'live' ? 'Update live' : 'Publish live'}
                    </button>
                    {trashArmId === item.id ? (
                      <button
                        onClick={() => void handleTrash(item)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white transition"
                      >
                        Confirm trash?
                      </button>
                    ) : (
                      <button
                        onClick={() => { setTrashArmId(item.id); window.setTimeout(() => setTrashArmId((v) => (v === item.id ? null : v)), 3500); }}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-red-400 hover:bg-red-50 hover:text-red-600 border border-transparent transition"
                        title="Trash the WordPress post (recoverable) and remove it from the app"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Trash
                      </button>
                    )}
                  </div>
                </div>
                {state !== 'live' && !gate.ok && gate.reason && (
                  <div className="px-4 pb-3 -mt-1 flex items-start gap-2 flex-wrap">
                    <p className="text-[11px] text-amber-600 font-medium flex-1 min-w-0 pt-0.5">
                      Publish blocked: {gate.reason}
                      {!aiFixable(gate.reason) ? ' — fix in Brand DNA & Vault / Settings.' : ''}
                    </p>
                    {aiFixable(gate.reason) && (
                      <button
                        onClick={() => void handleSeoFix(item)}
                        disabled={fixingId !== null}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition disabled:opacity-40"
                        title="Audit the noted issues, fix them with AI using best practices, humanise, re-test and unlock publishing"
                      >
                        <Wand2 className={`w-3.5 h-3.5 ${fixingId === item.id ? 'animate-pulse' : ''}`} />
                        {fixingId === item.id ? 'Fixing with AI…' : 'Fix with AI + humanise'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      </>
      )}
    </div>
  );
};
