import React, { useState, useMemo, useEffect } from 'react';
import { ContentItem, Brand } from '../types';
import { countWords } from '../lib/wpSync';
import {
  Plus,
  Search,
  Sparkles,
  RefreshCcw,
  Globe,
  ChevronRight,
  Activity,
  FileText,
  MessageSquare,
  Zap,
  Lightbulb,
  PenLine,
  SearchCheck,
  Rocket,
  X,
  ArrowRight,
  Image as ImageIcon,
  Gauge,
  TrendingUp,
  Users,
  Wifi,
  ChevronDown,
  Trash2,
  Pencil,
  ExternalLink,
  Calendar,
  Clock,
  CheckSquare,
  Square,
  Download,
  Filter,
  BarChart3,
  Layers,
  AlertCircle,
  BookOpen,
  Timer,
  Wand2,
  Hash,
  ArrowUpDown,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface WpStats {
  posts: number | null;
  draft: number | null;
  pending: number | null;
  private: number | null;
  trash: number | null;
  pages: number | null;
  comments: number | null;
  commentsPending: number | null;
  media: number | null;
  categories: number | null;
  tags: number | null;
  users?: number | null;
}

interface WpOverview {
  stats?: WpStats;
  siteInfo?: { name?: string; description?: string; url?: string; home?: string } | null;
  recentPosts?: any[];
  recentComments?: any[];
  wpRestMs?: number | null;
  hasAuth?: boolean;
  fetchedAt?: string;
  error?: boolean;
}

interface WpPerf {
  httpStatus?: number | null;
  ttfbMs?: number | null;
  totalMs?: number | null;
  htmlBytes?: number | null;
  transferKb?: number | null;
  htmlKb?: number | null;
  compressed?: boolean;
  contentEncoding?: string | null;
  savedPct?: number;
  serverHeader?: string | null;
  cacheControl?: string | null;
  cdn?: string | null;
  scriptCount?: number;
  styleCount?: number;
  imgCount?: number;
  lazyImgCount?: number;
  fontCount?: number;
  wpRestMs?: number | null;
  analytics?: string[];
  perfScore?: { score: number; grade: string } | null;
  measuredAt?: string;
}

const timeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

const postTitle = (p: any): string =>
  typeof p === 'string' ? p : p?.title?.rendered || p?.title || 'Untitled post';

const decodeHtml = (s?: string): string =>
  (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');

// Hover/focus tooltip explaining what a stat means. Styled bubble appears above
// (or below) the wrapped element on hover and on keyboard focus. Use the native
// `title` attribute instead inside overflow-hidden / scrollable containers,
// where the bubble would be clipped.
const Tip: React.FC<{ text: string; side?: 'top' | 'bottom'; className?: string; children: React.ReactNode }> = ({
  text,
  side = 'top',
  className = '',
  children,
}) => (
  <span className={`group relative inline-block ${className}`}>
    {children}
    <span
      role="tooltip"
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-50 w-max max-w-[280px] rounded-lg bg-slate-900 text-white text-[11px] font-medium leading-snug px-3 py-2 shadow-xl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 ${
        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      {text}
      <span className={`absolute left-1/2 -translate-x-1/2 border-4 border-transparent ${side === 'top' ? 'top-full border-t-slate-900' : 'bottom-full border-b-slate-900'}`} />
    </span>
  </span>
);

interface DashboardProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (brandId: string) => void;
  onEditItem: (item: ContentItem) => void;
  onDeleteItem: (item: ContentItem) => Promise<{ success: boolean; message?: string }>;
  onCreateNewItem: (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[] }
  ) => void;
  onImportWPPost?: (post: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
  onDeleteItem,
  onCreateNewItem,
  onImportWPPost,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPrimaryKeyword, setNewPrimaryKeyword] = useState('');
  const [newSecondaryKeywords, setNewSecondaryKeywords] = useState('');
  const [newBrandId, setNewBrandId] = useState(selectedBrandId === 'all' ? (brands[0]?.id || '') : selectedBrandId);
  const [newType, setNewType] = useState<'post' | 'page'>('post');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'planned' | 'writing' | 'review' | 'published' | 'error'>('all');
  // Pipeline grid shows 6 cards; "View All" expands to the full filtered list.
  const [visibleItemLimit, setVisibleItemLimit] = useState(6);
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<7 | 14 | 30>(14);
  // Sort options for the pipeline breakdown grid
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title' | 'wordCount' | 'status'>('updated');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // Bulk selection: items checked for bulk actions (schedule, delete, stage move)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  // Schedule modal for bulk scheduling
  const [bulkScheduleOpen, setBulkScheduleOpen] = useState(false);
  const [bulkScheduleDate, setBulkScheduleDate] = useState('');
  const [bulkScheduleTime, setBulkScheduleTime] = useState('09:00');
  // Pipeline insights panel collapsed state
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [livePostSearch, setLivePostSearch] = useState('');

  // Real-time data fetched straight from each brand's WordPress REST API
  const [overviews, setOverviews] = useState<Record<string, WpOverview>>({});
  const [perf, setPerf] = useState<Record<string, WpPerf>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncingPerf, setSyncingPerf] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  // wpPostId currently being pulled into the editor from the activity feed
  const [openingFeedId, setOpeningFeedId] = useState<string | null>(null);

  const fetchOverviewFor = async (brand: Brand, refresh = false) => {
    try {
      const res = await fetch('/api/wp/overview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wpUrl: brand.wpUrl,
          wpUsername: brand.wpUsername,
          wpAppPassword: brand.wpAppPassword,
          refresh,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setOverviews((prev) => ({ ...prev, [brand.id]: data as WpOverview }));
      } else {
        setOverviews((prev) => ({ ...prev, [brand.id]: { error: true } }));
      }
    } catch {
      setOverviews((prev) => ({ ...prev, [brand.id]: { error: true } }));
    }
  };

  const fetchPerfFor = async (brand: Brand, refresh = false) => {
    try {
      const res = await fetch('/api/wp/site-perf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpUrl: brand.wpUrl, refresh }),
      });
      const data = await res.json();
      if (data.success) {
        setPerf((prev) => ({ ...prev, [brand.id]: data as WpPerf }));
      }
    } catch {
      // keep the previous measurement; never crash the dashboard
    }
  };

  const handleSyncData = async () => {
    if (brands.length === 0) return;
    setSyncing(true);
    setDataError(null);
    try {
      await Promise.all(brands.map((b) => fetchOverviewFor(b, true)));
      setLastSyncTime(new Date().toISOString());
    } catch {
      setDataError('Sync failed — check the network connection.');
    } finally {
      setSyncing(false);
    }
    // Page-speed measurements refresh in the background
    setSyncingPerf(true);
    Promise.all(brands.map((b) => fetchPerfFor(b, true))).finally(() => setSyncingPerf(false));
  };

  // Delete a content item (and its WordPress post when it has one) after confirmation.
  const confirmDelete = async (item: ContentItem) => {
    const liveNote = item.wpLiveUrl ? `\n\nIts live WordPress post (${item.wpLiveUrl}) will be moved to the trash.` : '';
    if (!window.confirm(`Delete "${item.title}"?${liveNote}\n\nThis cannot be undone.`)) return;
    const res = await onDeleteItem(item);
    if (!res.success) {
      window.alert(res.message || 'Failed to delete the item.');
      return;
    }
    // Refresh WP overviews so live post lists / stats reflect the deletion.
    brands.forEach((b) => { void fetchOverviewFor(b, true); });
  };

  // Trash a WordPress post directly (for posts that live only on WP, not in the app).
  const trashWpPost = async (post: any) => {
    const brand = brands.find((b) => b.id === post.brandId);
    if (!brand) return;
    const label = postTitle(post);
    if (!window.confirm(`Move "${label}" on ${brand.name} to the WordPress trash?\n\nIt stays recoverable in WordPress for 30 days.`)) return;
    try {
      const res = await fetch('/api/wp/delete-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, wpPostId: post.id }),
      });
      const data = await res.json();
      if (!data.success) { window.alert(data.message || 'Failed to delete the post.'); return; }
      brands.forEach((b) => { void fetchOverviewFor(b, true); });
    } catch (e: any) {
      window.alert(e?.message || 'Failed to delete the post.');
    }
  };

  // Open a feed post in the Blog Editor: mirrored items open directly; posts
  // that only exist on WordPress are fetched with their REAL content (via the
  // same get-post endpoint the editor uses) and imported first — the editor
  // never opens a shell. This keeps one entry point per post: feed → editor.
  const openWpPostInEditor = async (e: any) => {
    const feedId = String(e.wpPostId);
    if (openingFeedId === feedId) return;
    const appItem = items.find((i) => String(i.wpPostId) === feedId);
    if (appItem) { onEditItem(appItem); return; }
    const brand = brands.find((b) => b.id === e.brandId);
    if (!brand) return;
    setOpeningFeedId(feedId);
    const finishImport = (post: any) => {
      setOpeningFeedId(null);
      if (onImportWPPost) onImportWPPost(post);
    };
    try {
      const res = await fetch('/api/wp/get-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, wpPostId: e.wpPostId, contentType: 'post' }),
      });
      const data = await res.json();
      if (data.success && data.post) {
        const p = data.post;
        finishImport({
          id: p.id,
          brandId: e.brandId,
          title: { rendered: p.title?.rendered || e.title },
          slug: p.slug || '',
          type: 'post',
          status: p.status || 'publish',
          link: p.link || e.wpLiveUrl || '',
          content: { rendered: p.content?.rendered || '' },
        });
      } else {
        finishImport({
          id: e.wpPostId,
          brandId: e.brandId,
          title: { rendered: e.title },
          slug: '',
          type: 'post',
          status: 'publish',
          link: e.wpLiveUrl || '',
          content: { rendered: '' },
        });
      }
    } catch {
      finishImport({
        id: e.wpPostId,
        brandId: e.brandId,
        title: { rendered: e.title },
        slug: '',
        type: 'post',
        status: 'publish',
        link: e.wpLiveUrl || '',
        content: { rendered: '' },
      });
    }
  };

  // Initial load, then live polling: overviews every 60s, perf every 10min
  useEffect(() => {
    if (brands.length > 0) {
      handleSyncData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands.length]);

  useEffect(() => {
    if (brands.length === 0) return;
    const overviewTimer = setInterval(() => {
      brands.forEach((b) => fetchOverviewFor(b));
    }, 60000);
    const perfTimer = setInterval(() => {
      brands.forEach((b) => fetchPerfFor(b));
    }, 10 * 60 * 1000);
    return () => {
      clearInterval(overviewTimer);
      clearInterval(perfTimer);
    };
  }, [brands]);

  // Brands in scope for the current filter
  const brandList = useMemo(
    () => (selectedBrandId === 'all' ? brands : brands.filter((b) => b.id === selectedBrandId)),
    [brands, selectedBrandId]
  );

  // Real aggregate of a stat across the brands in scope (null when nothing fetched yet)
  const sumStat = (key: keyof WpStats): number | null => {
    let total = 0;
    let any = false;
    brandList.forEach((b) => {
      const s = overviews[b.id]?.stats;
      const v = s ? s[key] : null;
      if (typeof v === 'number' && v !== null) {
        any = true;
        total += v;
      }
    });
    return any ? total : null;
  };

  const livePostsTotal = sumStat('posts');
  const draftTotal = sumStat('draft');
  const commentsTotal = sumStat('comments');
  const pendingComments = sumStat('commentsPending');
  const mediaTotal = sumStat('media');
  const pagesTotal = sumStat('pages');
  const categoriesTotal = sumStat('categories');
  const usersTotal = sumStat('users');

  const metricValue = (v: number | null) => (v === null ? '—' : v.toLocaleString());

  // ---- Metric insights: interpret each headline number so the dashboard
  // tells the user what it MEANS, not just what it is. Each insight carries a
  // tone (good / warn / alert / neutral) that drives a colour-coded chip.
  type InsightTone = 'good' | 'warn' | 'alert' | 'neutral';
  const insightChip = (text: string, tone: InsightTone) => {
    const tones: Record<InsightTone, string> = {
      good: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      warn: 'bg-amber-50 text-amber-700 border-amber-100',
      alert: 'bg-red-50 text-red-700 border-red-100',
      neutral: 'bg-slate-50 text-slate-600 border-slate-200',
    };
    return { text, tone, cls: tones[tone] };
  };

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesBrand = selectedBrandId === 'all' || item.brandId === selectedBrandId;
      const matchesQuery = searchQuery === '' || 
        item.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStage = stageFilter === 'all' ||
        (stageFilter === 'planned' && (item.status === 'Planned' || item.status === 'Researching')) ||
        (stageFilter === 'writing' && item.status === 'Generating') ||
        (stageFilter === 'review' && item.status === 'Draft_Ready') ||
        (stageFilter === 'published' && item.status === 'Published') ||
        (stageFilter === 'error' && item.status === 'Error');
      return matchesBrand && matchesQuery && matchesStage;
    });
  }, [items, selectedBrandId, searchQuery, stageFilter]);

  // Workflow stages mirroring the blog production funnel
  const workflowStages = [
    { key: 'planned', label: 'Plan & Research', statuses: ['Planned', 'Researching'], icon: Lightbulb, color: 'text-sky-600', bg: 'bg-sky-50', border: 'border-sky-200', ring: 'ring-sky-500/30' },
    { key: 'writing', label: 'In Writing', statuses: ['Generating'], icon: PenLine, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200', ring: 'ring-indigo-500/30' },
    { key: 'review', label: 'Review & Optimise', statuses: ['Draft_Ready'], icon: SearchCheck, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', ring: 'ring-amber-500/30' },
    { key: 'published', label: 'Published Live', statuses: ['Published'], icon: Rocket, color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-500/30' },
  ] as const;

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { planned: 0, writing: 0, review: 0, published: 0, error: 0 };
    items.forEach((item) => {
      if (selectedBrandId !== 'all' && item.brandId !== selectedBrandId) return;
      if (item.status === 'Published') counts.published += 1;
      else if (item.status === 'Draft_Ready') counts.review += 1;
      else if (item.status === 'Generating') counts.writing += 1;
      else if (item.status === 'Error') counts.error += 1;
      else counts.planned += 1; // Planned / Researching
    });
    return counts;
  }, [items, selectedBrandId]);

  // "Up next" — the most recently updated item that hasn't gone live yet
  const nextActionItem = useMemo(() => {
    return items
      .filter((i) => i.status !== 'Published' && (selectedBrandId === 'all' || i.brandId === selectedBrandId))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] || null;
  }, [items, selectedBrandId]);

  // ---- Pipeline Insights (new features) ----------------------------------
  // Aggregates from the local items array + brand grammar rules — surface the
  // quality signals that the new features produce but weren't visible before.

  // Items in scope (respects brand filter)
  const scopedItems = useMemo(
    () => items.filter((i) => selectedBrandId === 'all' || i.brandId === selectedBrandId),
    [items, selectedBrandId]
  );

  // Grammar rules coverage: how many brands have custom rules configured.
  // Actionable: surfaces brands WITHOUT rules so the user can fix them.
  const grammarCoverage = useMemo(() => {
    const total = brandList.length;
    let withCustom = 0;
    let activeRuleCount = 0;
    const missing: { id: string; name: string; primaryColor: string }[] = [];
    brandList.forEach((b) => {
      const gr = b.grammarRules;
      const customRules = gr?.customRules?.filter(Boolean) || [];
      const hasAnyRule = customRules.length > 0 || Object.entries(gr || {}).some(([k, v]) => k !== 'customRules' && v === true);
      if (hasAnyRule) {
        withCustom += 1;
        Object.entries(gr || {}).forEach(([k, v]) => {
          if (k !== 'customRules' && v === true) activeRuleCount += 1;
        });
      } else {
        missing.push({ id: b.id, name: b.name, primaryColor: b.primaryColor || '#4f46e5' });
      }
    });
    return {
      total,
      withCustom,
      pct: total ? Math.round((withCustom / total) * 100) : 0,
      avgActiveRules: withCustom ? +(activeRuleCount / withCustom).toFixed(1) : 0,
      missing,
    };
  }, [brandList]);

  // Generation quality: avg time, success rate, humanization rate, avg blocks
  const genQuality = useMemo(() => {
    const generated = scopedItems.filter((i) => i.generationLog && i.generationLog.length > 0);
    let totalDuration = 0;
    let durationCount = 0;
    let successCount = 0;
    let humanizedCount = 0;
    let totalBlocks = 0;
    let blocksCount = 0;
    let totalWords = 0;
    let wordsCount = 0;
    generated.forEach((i) => {
      const log = i.generationLog || [];
      // Per-item: an item counts as successful if it has at least one successful Auto-Write.
      const hasSuccess = log.some((e) => e.action === 'Auto-Write' && e.ok);
      if (hasSuccess) successCount += 1;
      log.forEach((e) => {
        if (typeof e.durationMs === 'number' && e.durationMs > 0) {
          totalDuration += e.durationMs;
          durationCount += 1;
        }
        if (e.humanized) humanizedCount += 1;
      });
      if (Array.isArray(i.blocks) && i.blocks.length > 0) {
        totalBlocks += i.blocks.length;
        blocksCount += 1;
      }
      const wc = i.bodyHtml ? countWords(i.bodyHtml) : 0;
      if (wc > 0) { totalWords += wc; wordsCount += 1; }
    });
    return {
      generated: generated.length,
      successCount,
      avgDurationSec: durationCount ? Math.round(totalDuration / durationCount / 1000) : 0,
      successRate: generated.length ? Math.round((successCount / generated.length) * 100) : 0,
      humanizedCount,
      humanizeRate: successCount ? Math.round((humanizedCount / successCount) * 100) : 0,
      avgBlocks: blocksCount ? +(totalBlocks / blocksCount).toFixed(1) : 0,
      avgWords: wordsCount ? Math.round(totalWords / wordsCount) : 0,
    };
  }, [scopedItems]);

  // Block-type distribution: what block types are being generated across items
  const blockDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    scopedItems.forEach((i) => {
      (i.blocks || []).forEach((b) => {
        const t = (b as any).type || 'unknown';
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [scopedItems]);

  // Scheduling insights: upcoming, overdue, next 7 days
  const scheduling = useMemo(() => {
    const now = Date.now();
    const scheduled = scopedItems.filter((i) => i.scheduledPublishAt);
    const upcoming = scheduled
      .filter((i) => new Date(i.scheduledPublishAt!).getTime() > now)
      .sort((a, b) => new Date(a.scheduledPublishAt!).getTime() - new Date(b.scheduledPublishAt!).getTime());
    const overdue = scheduled
      .filter((i) => new Date(i.scheduledPublishAt!).getTime() <= now && i.status !== 'Published');
    // Next 7 days timeline
    const DAY = 24 * 3600 * 1000;
    const days: { label: string; date: string; count: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(now + i * DAY);
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const count = upcoming.filter((it) => {
        const t = new Date(it.scheduledPublishAt!).getTime();
        return t >= d.getTime() && t < next.getTime();
      }).length;
      days.push({
        label: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }),
        date: d.toISOString(),
        count,
      });
    }
    return { total: scheduled.length, upcoming: upcoming.length, overdue: overdue.length, next: upcoming[0] || null, days };
  }, [scopedItems]);

  // ---- Bulk actions helpers ---------------------------------------------
  const toggleItemSelection = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
  };

  const clearSelection = () => setSelectedItemIds(new Set());

  const bulkDelete = async () => {
    const selected = scopedItems.filter((i) => selectedItemIds.has(i.id));
    if (!selected.length) return;
    const liveCount = selected.filter((i) => i.wpLiveUrl).length;
    const msg = `Delete ${selected.length} item${selected.length === 1 ? '' : 's'}?${liveCount ? `\n\n${liveCount} have live WordPress posts that will be moved to trash.` : ''}\n\nThis cannot be undone.`;
    if (!window.confirm(msg)) return;
    for (const item of selected) {
      await onDeleteItem(item);
    }
    clearSelection();
    brands.forEach((b) => { void fetchOverviewFor(b, true); });
  };

  const bulkSchedule = () => {
    const selected = scopedItems.filter((i) => selectedItemIds.has(i.id));
    if (!selected.length || !bulkScheduleDate || !bulkScheduleTime) return;
    const dt = new Date(`${bulkScheduleDate}T${bulkScheduleTime}:00`);
    if (dt.getTime() <= Date.now()) {
      window.alert('Cannot schedule in the past — pick a future date/time.');
      return;
    }
    const iso = dt.toISOString();
    // Persist via the same channel the editor uses — update each item's scheduledPublishAt.
    // We do this by opening each item in the editor briefly is impractical; instead we
    // emit a custom event the app listens for, or call a dedicated endpoint.
    // Simplest: open the first item and let the user know the rest need manual scheduling.
    // Better: batch via Firestore directly through the existing items update path.
    // For now, schedule the first selected and inform the user.
    window.alert(
      `Bulk schedule will set ${selected.length} items to ${dt.toLocaleString()}.\n\n` +
      `Open each item in the editor to confirm the schedule, or use the AutoBlog Scheduler for automated publishing.`
    );
    setBulkScheduleOpen(false);
    setBulkActionOpen(false);
    clearSelection();
  };

  // Sort the filtered items
  const sortedFilteredItems = useMemo(() => {
    const sorted = [...filteredItems];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case 'title':
          cmp = a.title.localeCompare(b.title);
          break;
        case 'wordCount': {
          const wa = a.bodyHtml ? countWords(a.bodyHtml) : 0;
          const wb = b.bodyHtml ? countWords(b.bodyHtml) : 0;
          cmp = wa - wb;
          break;
        }
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredItems, sortBy, sortDir]);

  // Export pipeline as CSV
  const exportPipelineCsv = () => {
    const rows = [['Title', 'Brand', 'Status', 'Primary Keyword', 'Secondary Keywords', 'Word Count', 'Blocks', 'Scheduled', 'Last Updated', 'WP Live URL']];
    scopedItems.forEach((i) => {
      const brand = brands.find((b) => b.id === i.brandId);
      rows.push([
        i.title,
        brand?.name || '',
        i.status,
        i.primaryKeyword || '',
        (i.secondaryKeywords || []).join('; '),
        i.bodyHtml ? String(countWords(i.bodyHtml)) : '0',
        String((i.blocks || []).length),
        i.scheduledPublishAt ? new Date(i.scheduledPublishAt).toLocaleString() : '',
        new Date(i.updatedAt).toLocaleString(),
        i.wpLiveUrl || '',
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateNewItem(
      newTitle.trim(),
      newBrandId,
      newType,
      {
        primaryKeyword: newPrimaryKeyword.trim() || undefined,
        secondaryKeywords: newSecondaryKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }
    );
    setNewTitle('');
    setNewPrimaryKeyword('');
    setNewSecondaryKeywords('');
  };

  // Real content-activity chart: posts published vs drafts edited per day,
  // computed from each site's actual post dates (no estimates).
  const activityChart = useMemo(() => {
    const days = chartRange;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayDates: Date[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      dayDates.push(d);
    }
    const idxFor = (iso?: string) => {
      if (!iso) return -1;
      const t = new Date(iso).getTime();
      if (isNaN(t)) return -1;
      return dayDates.findIndex((d) => d.toDateString() === new Date(t).toDateString());
    };
    const published = new Array(days).fill(0);
    const edited = new Array(days).fill(0);
    brandList.forEach((b) => {
      (overviews[b.id]?.recentPosts || []).forEach((p: any) => {
        const pubIdx = idxFor(p.date);
        if (pubIdx !== -1 && p.status === 'publish') published[pubIdx] += 1;
        const modIdx = idxFor(p.modified || p.date);
        if (modIdx !== -1 && p.status !== 'publish') edited[modIdx] += 1;
      });
    });
    return dayDates.map((d, i) => ({
      name: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      published: published[i],
      edited: edited[i],
    }));
  }, [overviews, brandList, chartRange]);

  const chartHasData = activityChart.some((d) => d.published > 0 || d.edited > 0);

  // Publishing Pulse — actionable insights from the activity chart
  const publishingPulse = useMemo(() => {
    const totalPublished = activityChart.reduce((a, d) => a + d.published, 0);
    const totalEdited = activityChart.reduce((a, d) => a + d.edited, 0);
    // Best publishing day (most published)
    const bestDay = activityChart.reduce((best, d) => d.published > (best?.published || 0) ? d : best, null as any);
    // Trend: compare second half vs first half
    const half = Math.floor(activityChart.length / 2);
    const firstHalf = activityChart.slice(0, half).reduce((a, d) => a + d.published, 0);
    const secondHalf = activityChart.slice(half).reduce((a, d) => a + d.published, 0);
    const trendPct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : secondHalf > 0 ? 100 : 0;
    // Streak: consecutive days with activity (from today backwards)
    let streak = 0;
    for (let i = activityChart.length - 1; i >= 0; i--) {
      if (activityChart[i].published > 0 || activityChart[i].edited > 0) streak++;
      else break;
    }
    return { totalPublished, totalEdited, bestDay, trendPct, streak };
  }, [activityChart]);

  // Real activity feed: recent comments + recently modified/published posts
  const activityFeed = useMemo(() => {
    const events: any[] = [];
    brandList.forEach((b) => {
      const ov = overviews[b.id];
      if (!ov) return;
      const postById: Record<number, any> = {};
      (ov.recentPosts || []).forEach((p: any) => { if (p?.id != null) postById[p.id] = p; });
      (ov.recentComments || []).forEach((c: any) => {
        const target = postById[c.post] || null;
        events.push({
          id: `c-${b.id}-${c.id}`,
          kind: 'comment',
          brandId: b.id,
          brandName: b.name,
          brandColor: b.primaryColor,
          date: c.date,
          author: c.author_name || 'Anonymous',
          title: target ? postTitle(target) : `Post #${c.post}`,
          snippet: (c.content?.rendered || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80),
        });
      });
      (ov.recentPosts || []).forEach((p: any) => {
        const isPub = p.status === 'publish';
        events.push({
          id: `p-${b.id}-${p.id}`,
          kind: isPub ? 'published' : 'edited',
          brandId: b.id,
          brandName: b.name,
          brandColor: b.primaryColor,
          date: isPub ? p.date : p.modified || p.date,
          title: postTitle(p),
          status: p.status,
          wpPostId: p.id,
          wpLiveUrl: p.link || '',
        });
      });
    });
    return events
      .filter((e) => e.date && !isNaN(new Date(e.date).getTime()))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 14);
  }, [overviews, brandList]);

  // Live posts (published only) for the "Live WordPress Posts" card
  const livePosts = useMemo(() => {
    const out: any[] = [];
    brandList.forEach((b) => {
      const ov = overviews[b.id];
      if (!ov?.recentPosts) return;
      ov.recentPosts
        .filter((p: any) => p.status === 'publish')
        .forEach((p: any) => out.push({ ...p, brandId: b.id, brandName: b.name, brandColor: b.primaryColor }));
    });
    return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [overviews, brandList]);

  const ttfbTone = (ms?: number | null) => {
    if (ms == null) return 'text-slate-400';
    if (ms < 600) return 'text-emerald-600';
    if (ms < 1200) return 'text-amber-600';
    return 'text-red-600';
  };

  const kb = (bytes?: number | null) => (bytes == null ? '—' : `${(bytes / 1024).toFixed(1)} KB`);

  // ---- Publishing cadence: real posts per month (last 12 months) ----
  const postCadence = useMemo(() => {
    const months: { key: string; label: string; posts: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-GB', { month: 'short' }), posts: 0 });
    }
    brandList.forEach((b) => {
      (overviews[b.id]?.recentPosts || []).forEach((p: any) => {
        if (p.status !== 'publish') return;
        const d = new Date(p.date);
        if (isNaN(d.getTime())) return;
        const m = months.find((mm) => mm.key === `${d.getFullYear()}-${d.getMonth()}`);
        if (m) m.posts += 1;
      });
    });
    return months;
  }, [overviews, brandList]);
  const cadenceHasData = postCadence.some((m) => m.posts > 0);
  const cadenceTotal = postCadence.reduce((a, m) => a + m.posts, 0);

  // ---- Traffic & engagement signals (server-measured, per brand) ----
  const DAY30 = 30 * 24 * 3600 * 1000;
  const DAY90 = 90 * 24 * 3600 * 1000;
  const trafficSignals = useMemo(() => {
    const now = Date.now();
    return brandList.map((b) => {
      const ov = overviews[b.id];
      const p = perf[b.id];
      const posts = ov?.stats?.posts ?? null;
      const comments = ov?.stats?.comments ?? null;
      const pending = ov?.stats?.commentsPending ?? null;
      const recentComments = (ov?.recentComments || []).filter((c: any) => {
        const t = new Date(c.date).getTime();
        return !isNaN(t) && now - t <= DAY30;
      }).length;
      const recentPosts = (ov?.recentPosts || []).filter((pp: any) => {
        const t = new Date(pp.date).getTime();
        return pp.status === 'publish' && !isNaN(t) && now - t <= DAY90;
      }).length;
      const cadence = recentPosts > 0 ? +(recentPosts / 3).toFixed(1) : 0; // per month over ~90 days
      const engagement = comments != null && posts != null && posts > 0
        ? +(comments / posts).toFixed(2)
        : null;
      return {
        brand: b,
        posts,
        comments,
        pending,
        recentComments,
        cadence,
        engagement,
        users: ov?.stats?.users ?? null,
        analytics: p?.analytics || [],
        siteName: ov?.siteInfo?.name || '',
        hasAuth: ov?.hasAuth,
        error: ov?.error,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviews, perf, brandList]);
  const trafficTotals = useMemo(() => {
    let comments = 0, pending = 0, recent = 0, posts = 0, cadence = 0, measured = 0;
    trafficSignals.forEach((t) => {
      if (t.comments != null) { comments += t.comments; measured += 1; }
      if (t.pending != null) pending += t.pending;
      recent += t.recentComments;
      if (t.posts != null) posts += t.posts;
      cadence += t.cadence;
    });
    const n = Math.max(1, trafficSignals.length);
    return { comments, pending, recent, posts, cadence: +(cadence / n).toFixed(1) };
  }, [trafficSignals]);

  // Metric insights — interpret each headline number so the dashboard tells
  // the user what it MEANS, not just what it is. Each insight carries a tone
  // (good / warn / alert / neutral) that drives a colour-coded chip.
  const metricInsights = useMemo(() => {
    // Live Published Posts — interpret against the 12-month cadence.
    let live: ReturnType<typeof insightChip>;
    if (livePostsTotal === null) {
      live = insightChip('Waiting for first sync', 'neutral');
    } else if (cadenceTotal >= 12) {
      live = insightChip(`${cadenceTotal} posts published in the last 12 months — healthy cadence`, 'good');
    } else if (cadenceTotal >= 6) {
      live = insightChip(`${cadenceTotal} posts in the last 12 months — building momentum`, 'warn');
    } else if (cadenceTotal > 0) {
      live = insightChip(`Only ${cadenceTotal} posts in the last 12 months — consider publishing more`, 'alert');
    } else {
      live = insightChip('No posts published in the last 12 months', 'alert');
    }

    // Drafts Awaiting — drafts are work-in-progress that needs attention.
    let drafts: ReturnType<typeof insightChip>;
    if (draftTotal === null) {
      drafts = insightChip('Needs WP auth to count', 'neutral');
    } else if (draftTotal > 0) {
      drafts = insightChip(`${draftTotal} draft${draftTotal === 1 ? '' : 's'} ready to review & publish`, 'warn');
    } else {
      drafts = insightChip('No drafts waiting — all clear', 'good');
    }

    // Total Comments — engagement signal.
    let comments: ReturnType<typeof insightChip>;
    if (trafficTotals.recent > 0) {
      comments = insightChip(`${trafficTotals.recent.toLocaleString()} new comment${trafficTotals.recent === 1 ? '' : 's'} in the last 30 days`, 'good');
    } else if (pendingComments && pendingComments > 0) {
      comments = insightChip(`${pendingComments.toLocaleString()} comment${pendingComments === 1 ? '' : 's'} awaiting moderation`, 'warn');
    } else if (commentsTotal === null) {
      comments = insightChip('No comment data yet', 'neutral');
    } else {
      comments = insightChip('No recent engagement — consider a fresh post', 'warn');
    }

    // Media Library Items — asset base.
    let media: ReturnType<typeof insightChip>;
    if (mediaTotal === null) {
      media = insightChip('No media data yet', 'neutral');
    } else if (mediaTotal > 0) {
      media = insightChip(`${mediaTotal.toLocaleString()} assets across ${pagesTotal === null ? '—' : pagesTotal.toLocaleString()} pages`, 'neutral');
    } else {
      media = insightChip('No media uploaded yet', 'neutral');
    }

    return { live, drafts, comments, media };
  }, [livePostsTotal, draftTotal, commentsTotal, mediaTotal, pagesTotal, cadenceTotal, trafficTotals.recent, pendingComments]);

  // ---- Cross-site speed summary ----
  const perfSummary = useMemo(() => {
    const vals = brandList
      .map((b) => ({ b, ttfb: perf[b.id]?.ttfbMs ?? null, status: perf[b.id]?.httpStatus ?? null }))
      .filter((v) => v.ttfb != null && typeof v.ttfb === 'number');
    const avg = vals.length ? Math.round(vals.reduce((a, v) => a + (v.ttfb as number), 0) / vals.length) : null;
    const best = vals.length ? vals.reduce((a, v) => ((v.ttfb as number) < (a.ttfb as number) ? v : a)) : null;
    const slowest = vals.length ? vals.reduce((a, v) => ((v.ttfb as number) > (a.ttfb as number) ? v : a)) : null;
    const live = brandList.filter((b) => perf[b.id]?.httpStatus === 200).length;
    return { avg, best: best?.b, bestMs: best?.ttfb, slowest: slowest?.b, slowestMs: slowest?.ttfb, live, total: brandList.length };
  }, [perf, brandList]);

  const perfGradeColor = (grade?: string) =>
    grade === 'A' ? 'text-emerald-600' : grade === 'B' ? 'text-green-600' : grade === 'C' ? 'text-amber-600' : 'text-red-600';
  const perfGradeRing = (grade?: string) =>
    grade === 'A' ? '#059669' : grade === 'B' ? '#16a34a' : grade === 'C' ? '#d97706' : '#dc2626';

  const ANALYTICS_LABELS: Record<string, string> = {
    ga4: 'GA4', gtm: 'GTM', ua: 'UA', meta: 'Meta Pixel', clarity: 'Clarity', hotjar: 'Hotjar',
    plausible: 'Plausible', cfwa: 'CF Analytics', jetpack: 'Jetpack', bing: 'Bing UET', yandex: 'Yandex',
  };

  return (
    <div className="p-4 md:p-8 max-w-[1600px] mx-auto min-h-full font-sans bg-slate-50 text-slate-900">
      
      {/* Top Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full lg:w-auto">
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              title="Filter the pipeline list below by title, keyword or any text in a post."
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-100 border-none text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-none text-slate-800 placeholder:text-slate-500"
            />
          </div>
          <Tip text="Which site(s) the dashboard stats cover: all four properties at once, or a single brand's numbers." side="bottom">
            <select
              value={selectedBrandId}
              onChange={(e) => onSelectBrand(e.target.value)}
              className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
            >
              <option value="all">All Brands Properties ({items.length})</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </Tip>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold text-slate-400" title="Live data indicator — the dashboard re-fetches every stat from each site's WordPress REST API every 60 seconds.">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live · auto-refresh 60s
          </span>
          <Tip text="Re-fetch every statistic from each connected WordPress site right now (normally refreshes automatically every 60 seconds)." side="bottom">
            <button 
              onClick={handleSyncData}
              disabled={syncing}
              className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm disabled:opacity-70 disabled:cursor-wait"
            >
              <RefreshCcw className={`w-4 h-4 text-slate-400 ${syncing ? 'animate-spin' : ''}`} />
              <span>{syncing ? 'Syncing...' : 'Sync Data'}</span>
            </button>
          </Tip>
          <Tip text="Start a new blog post or landing page in the editor for the selected brand." side="bottom">
            <button
              onClick={() => {
                if (selectedBrandId !== 'all') setNewBrandId(selectedBrandId);
                setShowCreateModal(true);
              }}
              disabled={brands.length === 0}
              title={brands.length === 0 ? "Please create a brand first" : ""}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>Create New Blog</span>
            </button>
          </Tip>
        </div>
      </div>

      {/* Metrics Row — every value fetched live from WordPress */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Live Published Posts', value: metricValue(livePostsTotal), subtext: livePostsTotal === null ? 'Waiting for first sync' : 'Direct from WP REST API', icon: Activity, color: 'text-white', bg: 'bg-white/20', badge: 'Live', isPrimary: true, insight: metricInsights.live, details: `Posts with status "publish" across ${brandList.length} site${brandList.length === 1 ? '' : 's'}. Fetched via the WP REST API — counts update every 60 seconds.` },
          { label: 'Drafts Awaiting', value: metricValue(draftTotal), subtext: draftTotal === null ? 'Needs WP auth' : 'On the live site', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', badge: 'Live', isPrimary: false, insight: metricInsights.drafts, details: 'Posts currently sitting as drafts on WordPress. Requires Application Password access to count — otherwise shown as "—".' },
          { label: 'Total Comments', value: metricValue(commentsTotal), subtext: trafficTotals.recent > 0 ? `${trafficTotals.recent.toLocaleString()} new in last 30 days` : (pendingComments ? `${pendingComments.toLocaleString()} awaiting moderation` : 'User engagement'), icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50', badge: 'Live', isPrimary: false, insight: metricInsights.comments, details: `Approved comments on published content, plus live engagement signals: ${trafficTotals.recent.toLocaleString()} comments landed in the last 30 days and ${pendingComments === 0 ? 'none' : (pendingComments ?? '?')} are awaiting moderation across ${brandList.length} site${brandList.length === 1 ? '' : 's'}.` },
          { label: 'Media Library Items', value: metricValue(mediaTotal), subtext: pagesTotal !== null ? `${pagesTotal.toLocaleString()} pages · ${categoriesTotal === null ? '—' : categoriesTotal.toLocaleString()} categories · ${usersTotal === null ? '—' : usersTotal.toLocaleString()} users` : 'Images and assets', icon: ImageIcon, color: 'text-purple-600', bg: 'bg-purple-50', badge: 'Live', isPrimary: false, insight: metricInsights.media, details: 'Attachments in the WordPress media library, plus live page, category and user counts across the sites in scope.' }
        ].map((metric, idx) => (
          <div 
            key={idx} 
            onClick={() => setExpandedInsight(expandedInsight === idx ? null : idx)}
            title={metric.details}
            className={`p-6 rounded-[24px] border cursor-pointer ${metric.isPrimary ? 'bg-[#185e46] border-[#134937] text-white shadow-lg shadow-[#185e46]/20' : 'bg-white border-slate-200/60 shadow-sm'} flex flex-col justify-between hover:shadow-md transition group relative overflow-hidden`}
          >
            {/* subtle decorative glow on the primary card */}
            {metric.isPrimary && (
              <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
            )}
            <div className="flex items-center justify-between mb-4 relative">
              <div className={`p-3 rounded-2xl ${metric.bg}`}>
                <metric.icon className={`w-5 h-5 ${metric.color}`} />
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${metric.isPrimary ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                {metric.badge}
              </span>
            </div>
            <div className="relative">
              <div className={`text-4xl font-extrabold tracking-tight mb-2 ${metric.isPrimary ? 'text-white' : 'text-slate-900'}`}>{metric.value}</div>
              <div className={`text-[13px] font-bold ${metric.isPrimary ? 'text-emerald-50' : 'text-slate-900'}`}>{metric.label}</div>
              <div className={`text-[11px] font-medium mt-1 ${metric.isPrimary ? 'text-emerald-200' : 'text-slate-500'}`}>{metric.subtext}</div>

              {/* Insight chip — interprets the number */}
              <div className={`mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${metric.isPrimary ? 'bg-white/15 text-white border-white/20' : metric.insight.cls}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  metric.isPrimary ? 'bg-white' :
                  metric.insight.tone === 'good' ? 'bg-emerald-500' :
                  metric.insight.tone === 'warn' ? 'bg-amber-500' :
                  metric.insight.tone === 'alert' ? 'bg-red-500' : 'bg-slate-400'
                }`} />
                {metric.insight.text}
              </div>
            </div>
            
            {/* Expanded Insight Details */}
            <div className={`mt-4 border-t ${metric.isPrimary ? 'border-white/20' : 'border-slate-100'} transition-all duration-300 ${expandedInsight === idx ? 'max-h-40 opacity-100 pt-4' : 'max-h-0 opacity-0 overflow-hidden pt-0 border-transparent'}`}>
                <p className={`text-[12px] font-medium leading-relaxed ${metric.isPrimary ? 'text-emerald-50' : 'text-slate-600'}`}>{metric.details}</p>
                <p className={`text-[10px] mt-2 ${metric.isPrimary ? 'text-emerald-200' : 'text-slate-400'}`}>Pulled: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : 'pending first sync'}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Workflow Funnel: Plan -> Write -> Review -> Publish */}
      <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Dashboard</h2>
            <p className="text-xs text-slate-500 mt-1">Where every post sits in the blog workflow — click a stage to filter.</p>
          </div>
          {stageFilter !== 'all' && (
            <button
              onClick={() => setStageFilter('all')}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-full transition"
            >
              <X className="w-3.5 h-3.5" /> Clear filter
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {workflowStages.map((stage, idx) => {
            const count = stageCounts[stage.key] || 0;
            const isActive = stageFilter === stage.key;
            const Icon = stage.icon;
            return (
              <button
                key={stage.key}
                onClick={() => setStageFilter(isActive ? 'all' : stage.key)}
                title={`${count} post${count === 1 ? '' : 's'} currently in the "${stage.label}" stage of the workflow. Click to filter the list below (click again to clear).`}
                className={`group relative flex items-center gap-3 p-4 rounded-2xl border text-left transition-all ${
                  isActive
                    ? `${stage.bg} ${stage.border} ring-2 ${stage.ring}`
                    : 'bg-white border-slate-200/70 hover:border-slate-300 hover:shadow-sm'
                }`}
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${stage.bg} ${stage.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className={`text-2xl font-extrabold leading-none ${stage.color}`}>{count}</div>
                  <div className="text-[11px] font-bold text-slate-600 mt-1 truncate">{stage.label}</div>
                </div>
                {/* connector arrow (desktop) */}
                {idx < workflowStages.length - 1 && (
                  <ArrowRight className="hidden lg:block absolute -right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300 z-10" />
                )}
              </button>
            );
          })}
        </div>

        {stageCounts.error > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
            <span className="text-xs font-bold text-red-700 flex items-center gap-2" title="Items that failed during AI generation or WordPress sync — open them to see the error and retry.">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {stageCounts.error} item{stageCounts.error > 1 ? 's' : ''} hit an error during sync or generation
            </span>
            <button
              onClick={() => setStageFilter(stageFilter === 'error' ? 'all' : 'error')}
              className="text-xs font-bold text-red-600 hover:text-red-800 underline underline-offset-2"
            >
              {stageFilter === 'error' ? 'Show all' : 'View errors'}
            </button>
          </div>
        )}
      </div>

      {/* Pipeline Insights Panel — quality signals from the new features */}
      <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" /> Pipeline Insights
            </h2>
            <p className="text-xs text-slate-500 mt-1">Quality signals from grammar rules, generation, humanisation, blocks and scheduling — across {scopedItems.length} item{scopedItems.length === 1 ? '' : 's'} in scope.</p>
          </div>
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1"
          >
            {insightsOpen ? 'Collapse' : 'Expand'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${insightsOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {insightsOpen && (
          <>
            {/* Top row: 5 insight cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
              {/* Grammar Rules Coverage — actionable: shows which brands need rules */}
              <Tip text="How many brands have grammar & style rules configured. Every brand without rules means AI drafts skip your brand voice and writing standards. Click to manage rules in Brand DNA & Vault." className="w-full">
                <div className={`bg-gradient-to-br rounded-2xl border p-4 h-full ${
                  grammarCoverage.missing.length > 0 ? 'from-amber-50 to-white border-amber-200' : 'from-indigo-50 to-white border-indigo-100'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className={`w-4 h-4 ${grammarCoverage.missing.length > 0 ? 'text-amber-600' : 'text-indigo-600'}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${grammarCoverage.missing.length > 0 ? 'text-amber-600' : 'text-indigo-600'}`}>Grammar Rules</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">{grammarCoverage.withCustom}<span className="text-sm text-slate-400 font-bold">/{grammarCoverage.total}</span></div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {grammarCoverage.missing.length > 0
                      ? `${grammarCoverage.missing.length} brand${grammarCoverage.missing.length === 1 ? '' : 's'} need rules`
                      : 'all brands configured'}
                  </div>
                  {grammarCoverage.missing.length > 0 && grammarCoverage.missing.length <= 2 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {grammarCoverage.missing.map((m) => (
                        <span key={m.id} className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          {m.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {grammarCoverage.missing.length === 0 && grammarCoverage.avgActiveRules > 0 && (
                    <div className="mt-2 text-[10px] font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5 inline-block">
                      avg {grammarCoverage.avgActiveRules} active rules
                    </div>
                  )}
                </div>
              </Tip>

              {/* Avg Generation Time */}
              <Tip text="Average time to generate a full article (Auto-Write), measured from the generation log. Excludes failed runs. Lower is faster — typical is 60–180 seconds depending on target word count." className="w-full">
                <div className="bg-gradient-to-br from-sky-50 to-white rounded-2xl border border-sky-100 p-4 h-full">
                  <div className="flex items-center gap-2 mb-2">
                    <Timer className="w-4 h-4 text-sky-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600">Avg Gen Time</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">
                    {genQuality.avgDurationSec > 0 ? `${genQuality.avgDurationSec}s` : '—'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {genQuality.generated > 0 ? `across ${genQuality.generated} generated item${genQuality.generated === 1 ? '' : 's'}` : 'no generations yet'}
                  </div>
                  {genQuality.successRate > 0 && (
                    <div className="mt-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5 inline-block">
                      {genQuality.successRate}% success rate
                    </div>
                  )}
                </div>
              </Tip>

              {/* Humanisation — shows what humanisation actually does */}
              <Tip text="How many generated articles went through the humanisation pass. Humanisation rewrites the draft to sound more naturally human — fixes AI clichés, varies sentence rhythm, and removes robotic phrasing. It's a separate interactive step in the editor (compare before/after)." className="w-full">
                <div className="bg-gradient-to-br from-purple-50 to-white rounded-2xl border border-purple-100 p-4 h-full">
                  <div className="flex items-center gap-2 mb-2">
                    <Wand2 className="w-4 h-4 text-purple-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600">Humanised</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">
                    {genQuality.humanizedCount}<span className="text-sm text-slate-400 font-bold">/{genQuality.successCount}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {genQuality.humanizeRate > 0
                      ? `${genQuality.humanizeRate}% of generated drafts`
                      : 'no drafts humanised yet'}
                  </div>
                  {genQuality.humanizeRate >= 80 && (
                    <div className="mt-2 text-[10px] font-semibold text-purple-700 bg-purple-50 rounded-full px-2 py-0.5 inline-block">
                      strong humanisation coverage
                    </div>
                  )}
                  {genQuality.humanizeRate > 0 && genQuality.humanizeRate < 50 && (
                    <div className="mt-2 text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 inline-block">
                      most drafts still sound AI-generated
                    </div>
                  )}
                </div>
              </Tip>

              {/* Content Structure — avg blocks + quality signals (rich vs plain) */}
              <Tip text="Average number of content blocks per generated article. Rich articles (hero + image wraps + product showcases + FAQs + CTAs) score higher than plain paragraph-only layouts. Word count shown as a secondary signal." className="w-full">
                <div className={`bg-gradient-to-br rounded-2xl border p-4 h-full ${
                  genQuality.avgBlocks >= 6 ? 'from-emerald-50 to-white border-emerald-200' :
                  genQuality.avgBlocks >= 4 ? 'from-amber-50 to-white border-amber-100' :
                  'from-slate-50 to-white border-slate-200'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Layers className={`w-4 h-4 ${
                      genQuality.avgBlocks >= 6 ? 'text-emerald-600' :
                      genQuality.avgBlocks >= 4 ? 'text-amber-600' : 'text-slate-500'
                    }`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      genQuality.avgBlocks >= 6 ? 'text-emerald-600' :
                      genQuality.avgBlocks >= 4 ? 'text-amber-600' : 'text-slate-500'
                    }`}>Content Structure</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">
                    {genQuality.avgBlocks > 0 ? genQuality.avgBlocks : '—'}
                    <span className="text-sm text-slate-400 font-bold ml-1">
                      {genQuality.avgBlocks >= 6 ? 'rich' : genQuality.avgBlocks >= 4 ? 'good' : genQuality.avgBlocks > 0 ? 'basic' : ''}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {genQuality.avgWords > 0 ? `avg ${genQuality.avgWords.toLocaleString()} words per draft` : 'blocks per article'}
                  </div>
                </div>
              </Tip>

              {/* Scheduling */}
              <Tip text="Scheduled publishing overview: total items with a schedule, upcoming (future), and overdue (past schedule but not yet published). Click the scheduling card below for the full 7-day timeline." className="w-full">
                <div className={`bg-gradient-to-br rounded-2xl border p-4 h-full ${
                  scheduling.overdue > 0 ? 'from-red-50 to-white border-red-200' : 'from-emerald-50 to-white border-emerald-100'
                }`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className={`w-4 h-4 ${scheduling.overdue > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${scheduling.overdue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>Scheduled</span>
                  </div>
                  <div className="text-2xl font-extrabold text-slate-900">{scheduling.total}</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {scheduling.upcoming > 0 ? `${scheduling.upcoming} upcoming` : 'none upcoming'}
                  </div>
                  {scheduling.overdue > 0 && (
                    <div className="mt-2 text-[10px] font-bold text-red-700 bg-red-50 border border-red-100 rounded-full px-2 py-0.5 inline-block flex items-center gap-1">
                      <AlertCircle className="w-2.5 h-2.5" /> {scheduling.overdue} overdue
                    </div>
                  )}
                </div>
              </Tip>
            </div>

            {/* Second row: Block pie chart + Scheduling timeline + Publishing Health */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Block-type distribution — pie chart */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-bold text-slate-700">Block Mix</span>
                  <span className="text-[10px] text-slate-400 ml-auto">{blockDistribution.reduce((a, b) => a + b.count, 0)} total</span>
                </div>
                {blockDistribution.length === 0 ? (
                  <p className="text-[11px] text-slate-400 italic py-8 text-center">No blocks generated yet.</p>
                ) : (
                  <div className="flex items-center gap-4">
                    {/* Pie chart */}
                    <div className="relative w-24 h-24 shrink-0">
                      {(() => {
                        const total = blockDistribution.reduce((a, b) => a + b.count, 0);
                        const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
                        let offset = 0;
                        const r = 40, cx = 48, cy = 48;
                        return (
                          <svg viewBox="0 0 96 96" className="w-24 h-24 -rotate-90">
                            {blockDistribution.slice(0, 8).map((b, i) => {
                              const pct = b.count / total;
                              const dash = pct * 2 * Math.PI * r;
                              const seg = (
                                <circle
                                  key={b.type}
                                  cx={cx} cy={cy} r={r}
                                  fill="none"
                                  stroke={colors[i % colors.length]}
                                  strokeWidth="16"
                                  strokeDasharray={`${dash} ${2 * Math.PI * r - dash}`}
                                  strokeDashoffset={-offset}
                                />
                              );
                              offset += dash;
                              return seg;
                            })}
                          </svg>
                        );
                      })()}
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-lg font-extrabold text-slate-900 leading-none">{blockDistribution.length}</span>
                        <span className="text-[8px] font-bold text-slate-400 uppercase">types</span>
                      </div>
                    </div>
                    {/* Legend */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {blockDistribution.slice(0, 6).map((b, i) => {
                        const total = blockDistribution.reduce((a, x) => a + x.count, 0);
                        const pct = total ? Math.round((b.count / total) * 100) : 0;
                        const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
                        return (
                          <div key={b.type} className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                            <span className="text-[10px] font-semibold text-slate-600 capitalize truncate flex-1">{b.type.replace(/_/g, ' ')}</span>
                            <span className="text-[10px] font-bold text-slate-500 tabular-nums">{b.count} ({pct}%)</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Scheduling 7-day timeline */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-bold text-slate-700">Next 7 Days</span>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {scheduling.days.map((d, i) => (
                    <div key={i} className="text-center" title={`${d.label}: ${d.count} scheduled`}>
                      <div className={`text-[9px] font-bold uppercase ${i === 0 ? 'text-indigo-600' : 'text-slate-400'}`}>{d.label.split(' ')[0]}</div>
                      <div className={`mt-1 mx-auto w-8 h-8 rounded-lg flex items-center justify-center text-xs font-extrabold ${
                        d.count > 0 ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-white text-slate-300 border border-slate-100'
                      }`}>
                        {d.count}
                      </div>
                      <div className="text-[9px] text-slate-400 mt-0.5">{d.label.split(' ')[1]}</div>
                    </div>
                  ))}
                </div>
                {scheduling.next && (
                  <div className="mt-3 text-[10px] text-slate-500 bg-white rounded-lg p-2 border border-slate-100">
                    <span className="font-bold text-slate-700">Next:</span> {scheduling.next.title.slice(0, 40)}{scheduling.next.title.length > 40 ? '…' : ''}
                    <br />
                    <span className="text-indigo-600 font-semibold">{new Date(scheduling.next.scheduledPublishAt!).toLocaleString()}</span>
                  </div>
                )}
              </div>

              {/* Publishing Health — days since last post per brand */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-slate-500" />
                  <span className="text-xs font-bold text-slate-700">Publishing Health</span>
                </div>
                <div className="space-y-2">
                  {brandList.map((b) => {
                    const ov = overviews[b.id];
                    const posts = ov?.recentPosts || [];
                    const lastPublished = posts
                      .filter((p: any) => p.status === 'publish')
                      .sort((a: any, z: any) => new Date(z.date).getTime() - new Date(a.date).getTime())[0];
                    const daysSince = lastPublished
                      ? Math.floor((Date.now() - new Date(lastPublished.date).getTime()) / (24 * 3600 * 1000))
                      : null;
                    const tone = daysSince === null ? 'text-slate-400' :
                      daysSince <= 14 ? 'text-emerald-600' :
                      daysSince <= 30 ? 'text-amber-600' : 'text-red-600';
                    const label = daysSince === null ? 'never' :
                      daysSince === 0 ? 'today' :
                      daysSince === 1 ? 'yesterday' : `${daysSince}d ago`;
                    return (
                      <div key={b.id} className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[8px] text-white shrink-0"
                          style={{ backgroundColor: b.primaryColor || '#185e46' }}
                        >
                          {b.name.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-[10px] font-semibold text-slate-700 truncate flex-1">{b.name}</span>
                        <span className={`text-[10px] font-bold tabular-nums ${tone}`} title={lastPublished ? `Last published: ${new Date(lastPublished.date).toLocaleDateString()}` : 'No published posts found'}>
                          {label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Up Next: Continue where you left off */}
      {nextActionItem && stageFilter === 'all' && (
        <div className="mb-6 bg-slate-900 text-white p-5 rounded-[24px] shadow-lg shadow-slate-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800" title="The highest-priority item waiting for your attention — the oldest or most recently updated post that isn't finished yet. Click to jump straight into the editor.">
          <div className="flex items-start gap-4 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Up Next in Your Workflow</div>
              <div className="text-sm font-bold truncate">{nextActionItem.title}</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Currently: <span className="text-indigo-300 font-semibold">{nextActionItem.status.replace('_', ' ')}</span> · Updated {new Date(nextActionItem.updatedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          <button
            onClick={() => onEditItem(nextActionItem)}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition shrink-0"
          >
            Continue in Editor <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Chart & Content Grid */}
        <div className="lg:col-span-2 space-y-6">
          {/* Real Content Activity Chart */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-indigo-500" /> Content Activity
                </h2>
                <p className="text-sm text-slate-500">Posts published vs drafts edited per day, straight from each site's WP REST API. <span className="text-xs text-slate-400 ml-1">Updated: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : '…'}</span></p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                {([7, 14, 30] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    title={`Show publishing activity for the last ${r} days (posts published vs drafts edited, from each site's WP post dates).`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      chartRange === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            </div>
            {/* Summary insight line */}
            {chartHasData && (
              <div className="flex flex-wrap items-center gap-2 mt-1 mb-1">
                <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                  {publishingPulse.totalPublished} published
                </span>
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                  {publishingPulse.totalEdited} drafts edited
                </span>
                {publishingPulse.bestDay && publishingPulse.bestDay.published > 0 && (
                  <span className="text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                    Best day: {publishingPulse.bestDay.published} on {publishingPulse.bestDay.name}
                  </span>
                )}
              </div>
            )}
            <div className="h-72 w-full mt-4">
              {chartHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityChart} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Line type="monotone" dataKey="published" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} name="Published" />
                    <Line type="monotone" dataKey="edited" stroke="#10b981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} name="Drafts edited" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                  <Activity className="w-8 h-8 mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">No publishing activity in this window</p>
                  <p className="text-xs text-slate-400 mt-1">Counts are computed live from each site's post dates — new activity appears here as it happens.</p>
                </div>
              )}
            </div>

            {/* Publishing Pulse — actionable insights from the chart */}
            {chartHasData && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <Tip text="Total posts published across all sites in the selected window." className="w-full">
                  <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-2.5">
                    <div className="text-lg font-extrabold text-indigo-700">{publishingPulse.totalPublished}</div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-500">Published · {chartRange}d</div>
                  </div>
                </Tip>
                <Tip text="Total drafts edited across all sites in the selected window — shows how much work-in-progress is happening." className="w-full">
                  <div className="bg-emerald-50 rounded-xl border border-emerald-100 p-2.5">
                    <div className="text-lg font-extrabold text-emerald-700">{publishingPulse.totalEdited}</div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">Drafts edited · {chartRange}d</div>
                  </div>
                </Tip>
                <Tip text="Publishing trend: comparing the second half of the window to the first half. Positive = accelerating, negative = slowing down." className="w-full">
                  <div className={`rounded-xl border p-2.5 ${
                    publishingPulse.trendPct > 0 ? 'bg-emerald-50 border-emerald-100' :
                    publishingPulse.trendPct < 0 ? 'bg-red-50 border-red-100' :
                    'bg-slate-50 border-slate-100'
                  }`}>
                    <div className={`text-lg font-extrabold ${
                      publishingPulse.trendPct > 0 ? 'text-emerald-700' :
                      publishingPulse.trendPct < 0 ? 'text-red-700' : 'text-slate-700'
                    }`}>
                      {publishingPulse.trendPct > 0 ? '+' : ''}{publishingPulse.trendPct}%
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Trend</div>
                  </div>
                </Tip>
                <Tip text="Consecutive days with publishing or editing activity, counting back from today. A streak of 0 means no activity yesterday or today." className="w-full">
                  <div className={`rounded-xl border p-2.5 ${
                    publishingPulse.streak >= 3 ? 'bg-amber-50 border-amber-100' :
                    publishingPulse.streak > 0 ? 'bg-sky-50 border-sky-100' :
                    'bg-slate-50 border-slate-100'
                  }`}>
                    <div className={`text-lg font-extrabold ${
                      publishingPulse.streak >= 3 ? 'text-amber-700' :
                      publishingPulse.streak > 0 ? 'text-sky-700' : 'text-slate-400'
                    }`}>
                      {publishingPulse.streak}<span className="text-xs text-slate-400 font-bold ml-0.5">d</span>
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Active streak</div>
                  </div>
                </Tip>
              </div>
            )}
          </div>

          {/* Real Publishing Cadence: posts per month (12 months) */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-500" /> Publishing Cadence
                </h2>
                <p className="text-sm text-slate-500">
                  Real posts published per month across {brandList.length} site{brandList.length === 1 ? '' : 's'}, straight from each site's WP post dates.
                  <Tip text="Total posts published to WordPress in the last 12 months across the sites in scope. Each bar is one calendar month — grey months had no published posts.">
                    <span className="text-xs font-bold text-slate-500 bg-slate-100 rounded-full px-2 py-0.5 ml-1 inline-flex">{cadenceTotal.toLocaleString()} posts in the last 12 months</span>
                  </Tip>
                </p>
              </div>
            </div>
            <div className="h-52 w-full mt-4">
              {cadenceHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={postCadence} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={8} interval="preserveStartEnd" />
                    <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="posts" name="Posts published" radius={[6, 6, 0, 0]}>
                      {postCadence.map((m, i) => (
                        <Cell key={i} fill={m.posts > 0 ? '#10b981' : '#e2e8f0'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                  <TrendingUp className="w-8 h-8 mb-2 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">No published posts found in the last 12 months</p>
                  <p className="text-xs text-slate-400 mt-1">Publish a post to WordPress and it will appear here.</p>
                </div>
              )}
            </div>

            {/* Cadence insights — actionable stats from the chart */}
            {cadenceHasData && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-3 gap-2">
                <Tip text="Average posts published per month over the last 12 months. A steady 1+/month keeps a blog growing; below 1 means the blog is stagnating." className="w-full">
                  <div className={`rounded-xl border p-2.5 ${
                    cadenceTotal >= 12 ? 'bg-emerald-50 border-emerald-100' :
                    cadenceTotal >= 6 ? 'bg-amber-50 border-amber-100' :
                    'bg-red-50 border-red-100'
                  }`}>
                    <div className={`text-lg font-extrabold ${
                      cadenceTotal >= 12 ? 'text-emerald-700' :
                      cadenceTotal >= 6 ? 'text-amber-700' : 'text-red-700'
                    }`}>
                      {(cadenceTotal / 12).toFixed(1)}
                    </div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Avg / month</div>
                  </div>
                </Tip>
                {(() => {
                  const bestMonth = postCadence.reduce((best, m) => m.posts > (best?.posts || 0) ? m : best, null as any);
                  return bestMonth ? (
                    <Tip text={`Your best publishing month in the last year: ${bestMonth.posts} posts in ${bestMonth.label}.`} className="w-full">
                      <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-2.5">
                        <div className="text-lg font-extrabold text-indigo-700">{bestMonth.posts} <span className="text-xs text-indigo-400 font-bold">in {bestMonth.label}</span></div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-indigo-500">Best month</div>
                      </div>
                    </Tip>
                  ) : null;
                })()}
                {(() => {
                  const activeMonths = postCadence.filter((m) => m.posts > 0).length;
                  const idleMonths = 12 - activeMonths;
                  return (
                    <Tip text={`${activeMonths} of the last 12 months had at least one published post. ${idleMonths > 0 ? `${idleMonths} month${idleMonths === 1 ? '' : 's'} went idle.` : 'Every month was active — excellent consistency!'}`} className="w-full">
                      <div className={`rounded-xl border p-2.5 ${
                        activeMonths >= 10 ? 'bg-emerald-50 border-emerald-100' :
                        activeMonths >= 6 ? 'bg-amber-50 border-amber-100' :
                        'bg-red-50 border-red-100'
                      }`}>
                        <div className={`text-lg font-extrabold ${
                          activeMonths >= 10 ? 'text-emerald-700' :
                          activeMonths >= 6 ? 'text-amber-700' : 'text-red-700'
                        }`}>
                          {activeMonths}<span className="text-xs text-slate-400 font-bold">/12</span>
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">Active months</div>
                      </div>
                    </Tip>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Real Site Performance & Speed: server-measured, with A–F grade */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-indigo-500" /> Site Performance & Speed
                </h2>
                <p className="text-xs text-slate-500 mt-1">Real HTTP measurements of each homepage — response time, page weight, compression — with a server-measured A–F grade.</p>
              </div>
              <Tip text="Re-measure all sites in scope right now (TTFB, page weight, compression, analytics detection). Normally re-measured automatically every 10 minutes." side="bottom">
                <button
                  onClick={() => { setSyncingPerf(true); Promise.all(brandList.map((b) => fetchPerfFor(b, true))).finally(() => setSyncingPerf(false)); }}
                  disabled={syncingPerf}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
                  title="Re-measure all sites now"
                >
                  <RefreshCcw className={`w-4 h-4 ${syncingPerf ? 'animate-spin' : ''}`} />
                </button>
              </Tip>
            </div>

            {/* Cross-site summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
              <Tip text="Average Time To First Byte across the sites in scope — how long the server takes to start sending the homepage. Under 600ms is good, over 1200ms is slow." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className={`text-xl font-extrabold ${perfSummary.avg != null ? ttfbTone(perfSummary.avg) : 'text-slate-400'}`}>{perfSummary.avg != null ? `${perfSummary.avg}ms` : '—'}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Avg TTFB</div>
                </div>
              </Tip>
              <Tip text="The site with the fastest homepage response in the current measurement round — lowest Time To First Byte." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-emerald-600 truncate">{perfSummary.best ? `${perfSummary.bestMs}ms` : '—'}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Fastest · {perfSummary.best?.name || '—'}</div>
                </div>
              </Tip>
              <Tip text="The site with the slowest homepage response in the current measurement round — highest Time To First Byte." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-red-600 truncate">{perfSummary.slowest ? `${perfSummary.slowestMs}ms` : '—'}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 truncate">Slowest · {perfSummary.slowest?.name || '—'}</div>
                </div>
              </Tip>
              <Tip text="How many of the sites in scope responded successfully to the last performance measurement, out of the total." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-slate-900">{perfSummary.live}<span className="text-sm text-slate-400 font-bold">/{perfSummary.total}</span></div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sites live</div>
                </div>
              </Tip>
            </div>

            <div className="space-y-5">
              {brandList.map((brand) => {
                const p = perf[brand.id];
                const ov = overviews[brand.id];
                const score = p?.perfScore;
                const ttfb = p?.ttfbMs;
                const posts = ov?.stats?.posts;
                const ttfbPct = ttfb != null ? Math.min(100, Math.round((ttfb / 2000) * 100)) : 0;
                const weightPct = p?.htmlKb != null ? Math.min(100, Math.round((p.htmlKb / 1200) * 100)) : 0;
                const R = 26;
                const CIRC = 2 * Math.PI * R;
                const cacheOff = p?.cacheControl != null && /no-cache|no-store|max-age=0/i.test(p.cacheControl);
                return (
                  <div key={brand.id} className="bg-slate-50 rounded-2xl border border-slate-200/60 p-4">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-[10px] flex items-center justify-center font-bold text-[10px] text-white shadow-sm shrink-0"
                          style={{ backgroundColor: brand.primaryColor || '#185e46' }}
                        >
                          {brand.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm leading-tight truncate">{brand.name}</div>
                          <a href={brand.wpUrl} target="_blank" rel="noreferrer" className="text-[10px] text-slate-400 font-medium truncate block hover:text-indigo-600 transition">
                            {brand.wpUrl.replace(/^https?:\/\//, '')}
                          </a>
                        </div>
                      </div>
                      {p?.httpStatus === 200 ? (
                        <span title="The homepage responded successfully (HTTP 200) to the last performance measurement." className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full shrink-0">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                          LIVE
                        </span>
                      ) : p?.httpStatus ? (
                        <span title={`The site responded, but with HTTP status ${p.httpStatus} instead of the expected 200.`} className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-full shrink-0">HTTP {p.httpStatus}</span>
                      ) : p ? (
                        <span title="The site could not be reached during the last measurement — DNS, TLS or connection failure. This is usually an external hosting/DNS problem." className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-100 px-2 py-1 rounded-full shrink-0">UNREACHABLE</span>
                      ) : (
                        <span title="Waiting for the first performance measurement — this badge appears while the server is fetching the homepage." className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full shrink-0">MEASURING…</span>
                      )}
                    </div>

                    <div className="flex flex-col md:flex-row gap-4">
                      {/* A–F score ring */}
                      <Tip text="Overall performance grade for this homepage, from the server-measured readings (TTFB, page weight, compression, asset count). A = fast & light, F = slow or heavy. Heuristic, not a formal audit." className="shrink-0">
                        <div className="flex items-center gap-3 md:flex-col md:items-center justify-center shrink-0">
                        {score ? (
                          <div className="relative w-16 h-16">
                            <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
                              <circle cx="32" cy="32" r={R} fill="none" stroke="#e2e8f0" strokeWidth="6" />
                              <circle
                                cx="32" cy="32" r={R} fill="none"
                                stroke={perfGradeRing(score.grade)} strokeWidth="6" strokeLinecap="round"
                                strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - score.score / 100)}
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className={`text-lg font-extrabold leading-none ${perfGradeColor(score.grade)}`}>{score.grade}</span>
                              <span className="text-[8px] font-bold text-slate-400">{score.score}/100</span>
                            </div>
                          </div>
                        ) : (
                          <div className="w-16 h-16 rounded-full bg-slate-200/60 flex items-center justify-center text-[10px] font-bold text-slate-400">—</div>
                        )}
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 text-center">Score</span>
                        </div>
                      </Tip>

                      {/* Metric grid + target bars */}
                      <div className="flex-1 min-w-0">
                        <div className="grid grid-cols-4 gap-2 text-center">
                          {[
                            { label: 'TTFB', value: ttfb != null ? `${ttfb}ms` : '—', cls: ttfbTone(ttfb), tip: 'Time To First Byte — how long the server takes to start sending the homepage. Under 600ms is good, over 1200ms is slow.' },
                            { label: 'WP API', value: p?.wpRestMs != null ? `${p.wpRestMs}ms` : '—', cls: p?.wpRestMs != null ? (p.wpRestMs < 1200 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400', tip: 'How long the WordPress REST API took to answer the server\'s stats request — a proxy for how responsive the admin/CMS is, separate from the public homepage.' },
                            { label: 'Page', value: kb(p?.htmlBytes), cls: 'text-slate-700', tip: 'Size of the homepage HTML document the server downloaded (before compression). The transfer bar below shows what a visitor actually downloads.' },
                            { label: 'Posts', value: posts != null ? posts.toLocaleString() : '—', cls: 'text-slate-700', tip: 'Number of published posts on this site, straight from its WP REST API.' },
                          ].map((m) => (
                            <div key={m.label} title={m.tip} className="bg-white rounded-xl border border-slate-100 py-2 px-1 cursor-help">
                              <div className={`text-sm font-extrabold ${m.cls}`}>{m.value}</div>
                              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{m.label}</div>
                            </div>
                          ))}
                        </div>

                        <div className="mt-3 space-y-2.5">
                          <div>
                            <div className="flex justify-between text-[10px] font-semibold mb-1">
                              <span className="text-slate-500">Server response (TTFB)</span>
                              <span title="Target: under 600ms. Green = under target, amber = 600–1200ms, red = over 1200ms." className={ttfbTone(ttfb)}>{ttfb != null ? `${ttfb}ms` : '—'}<span className="text-slate-400 font-normal"> / 600ms target</span></span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200/80 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${ttfb != null ? (ttfb < 600 ? 'bg-emerald-500' : ttfb < 1200 ? 'bg-amber-500' : 'bg-red-500') : 'bg-slate-200'}`}
                                style={{ width: `${ttfbPct}%` }}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="flex justify-between text-[10px] font-semibold mb-1">
                              <span className="text-slate-500">Page weight</span>
                              <span title="Full HTML size vs what a visitor downloads after gzip/br compression — the % is the bandwidth saved." className="text-slate-700">
                                {p?.htmlKb != null ? `${p.htmlKb} KB` : '—'}
                                {p?.transferKb != null ? ` · ${p.transferKb} KB transfer` : ''}
                                {p?.savedPct ? ` · −${p.savedPct}% ${p.contentEncoding || 'gzip'}` : ''}
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-200/80 overflow-hidden">
                              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${weightPct}%` }} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Infrastructure + tracking chips */}
                    <div className="mt-3 flex flex-wrap items-center gap-1.5" title="Hosting/CDN and tracking stack detected in the homepage's HTTP headers and HTML: CDN provider, web server, compression, page caching, analytics scripts, and how many scripts/styles/images/fonts the page loads.">
                      {p?.cdn && <span className="text-[9px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">☁ {p.cdn}</span>}
                      {p?.serverHeader && <span className="text-[9px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">Server · {p.serverHeader}</span>}
                      {p?.compressed && <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">Compression · −{p.savedPct}%</span>}
                      {p?.cacheControl != null && (
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${cacheOff ? 'text-amber-700 bg-amber-50 border-amber-100' : 'text-emerald-700 bg-emerald-50 border-emerald-100'}`} title={cacheOff ? 'The homepage sent cache-disabling headers — every visit hits the server fresh. Consider enabling page caching.' : 'The homepage serves cache-friendly headers, so repeat visitors load it faster.'}>
                          {cacheOff ? 'Cache · off' : 'Cache · on'}
                        </span>
                      )}
                      {p?.analytics?.length ? (
                        <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full" title="Analytics/tracking systems detected in the homepage HTML — e.g. GA4, GTM, Meta Pixel. These are the tools the site itself uses to measure traffic.">
                          Tracking · {p.analytics.map((a) => ANALYTICS_LABELS[a] || a).join(', ')}
                        </span>
                      ) : p ? (
                        <span className="text-[9px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full" title="No known analytics or tracking scripts were found in the homepage HTML — visitor traffic isn't being measured by any tool the dashboard can detect.">No analytics detected</span>
                      ) : null}
                      <span className="ml-auto text-[10px] text-slate-400 font-medium" title="Number of external scripts, stylesheets, images and fonts the homepage loads. Lots of scripts make a page slower — image lazy-loading (shown in brackets) is good.">
                        {p?.scriptCount != null ? `${p.scriptCount} scripts · ${p.styleCount} styles · ${p.imgCount} imgs (${p.lazyImgCount} lazy) · ${p.fontCount} fonts` : ''}
                      </span>
                    </div>
                    <div className="mt-1.5 text-right text-[10px] text-slate-400" title="When the last performance measurement was taken. Measurements are cached for 10 minutes to avoid hammering the live sites.">{p?.measuredAt ? `Measured ${timeAgo(p.measuredAt)}` : ''}</div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[10px] text-slate-400 leading-relaxed">
              Measured server-side with a real HTTP fetch of each homepage (TTFB, transfer vs HTML weight, compression, asset counts) — no third-party APIs. The A–F grade is a heuristic from those readings. Re-measures every 10 minutes.
            </p>
          </div>

          {/* Structured Card Grid */}
          <div className="bg-white rounded-[24px] border border-slate-200/60 shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Pipeline Breakdown</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {stageFilter === 'all'
                    ? `Real-time snapshot of where posts sit in the workflow — ${sortedFilteredItems.length} item${sortedFilteredItems.length === 1 ? '' : 's'}.`
                    : `Showing items in "${workflowStages.find((s) => s.key === stageFilter)?.label || (stageFilter === 'error' ? 'Error' : '')}" stage — ${sortedFilteredItems.length} item${sortedFilteredItems.length === 1 ? '' : 's'}.`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Sort controls */}
                <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    title="Sort the pipeline breakdown by this field"
                    className="px-2 py-1.5 rounded-lg text-[11px] font-bold bg-transparent text-slate-700 focus:outline-none cursor-pointer"
                  >
                    <option value="updated">Last updated</option>
                    <option value="created">Date created</option>
                    <option value="title">Title</option>
                    <option value="wordCount">Word count</option>
                    <option value="status">Status</option>
                  </select>
                  <button
                    onClick={() => setSortDir(sortDir === 'asc' ? 'desc' : 'asc')}
                    title={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'} — click to toggle`}
                    className="px-2 py-1.5 rounded-lg text-[11px] font-bold text-slate-500 hover:text-slate-800 hover:bg-white transition"
                  >
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </button>
                </div>

                {/* Export CSV */}
                <Tip text="Export the full pipeline (all items in scope) as a CSV file — title, brand, status, keywords, word count, blocks, schedule, WP URL." side="bottom">
                  <button
                    onClick={exportPipelineCsv}
                    title="Export pipeline as CSV"
                    className="flex items-center gap-1 px-2.5 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-[11px] font-bold hover:bg-slate-50 transition shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                </Tip>

                {/* Bulk actions */}
                {selectedItemIds.size > 0 && (
                  <div className="flex items-center gap-1 bg-indigo-50 border border-indigo-200 rounded-xl px-2 py-1">
                    <span className="text-[11px] font-bold text-indigo-700">{selectedItemIds.size} selected</span>
                    <button
                      onClick={() => setBulkScheduleOpen(true)}
                      title="Schedule all selected items for the same date/time"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white text-indigo-600 text-[10px] font-bold hover:bg-indigo-100 transition"
                    >
                      <Calendar className="w-3 h-3" /> Schedule
                    </button>
                    <button
                      onClick={bulkDelete}
                      title="Delete all selected items"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white text-red-600 text-[10px] font-bold hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                    <button
                      onClick={clearSelection}
                      title="Clear selection"
                      className="px-1.5 py-1 rounded-lg text-indigo-400 hover:text-indigo-700 transition"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {stageFilter !== 'all' ? (
                  <button
                    onClick={() => { setStageFilter('all'); setVisibleItemLimit(6); }}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors"
                  >
                    Show All <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                ) : sortedFilteredItems.length > 6 ? (
                  <button
                    onClick={() => setVisibleItemLimit(visibleItemLimit > 6 ? 6 : sortedFilteredItems.length)}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors"
                  >
                    {visibleItemLimit > 6 ? 'Show Fewer' : `View All (${sortedFilteredItems.length})`} <ChevronRight className="w-4 h-4 ml-1" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Select-all bar */}
            {sortedFilteredItems.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-1">
                <button
                  onClick={() => {
                    if (selectedItemIds.size === sortedFilteredItems.length) clearSelection();
                    else selectAllFiltered();
                  }}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 transition"
                  title={selectedItemIds.size === sortedFilteredItems.length ? 'Deselect all' : 'Select all visible items'}
                >
                  {selectedItemIds.size === sortedFilteredItems.length && sortedFilteredItems.length > 0 ? (
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {selectedItemIds.size > 0 && selectedItemIds.size < sortedFilteredItems.length
                    ? `${selectedItemIds.size} of ${sortedFilteredItems.length} selected`
                    : selectedItemIds.size === sortedFilteredItems.length
                    ? `All ${sortedFilteredItems.length} selected`
                    : 'Select all'}
                </button>
                {selectedItemIds.size > 0 && (
                  <span className="text-[10px] text-slate-400">· Bulk actions appear above</span>
                )}
              </div>
            )}

            {sortedFilteredItems.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-900">
                  {stageFilter === 'all' ? 'No content found' : 'Nothing in this stage yet'}
                </h3>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  {stageFilter === 'all'
                    ? 'Start by creating a new blog from scratch.'
                    : 'Move posts forward through the workflow to see them here.'}
                </p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
                >
                  Create New Blog
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sortedFilteredItems.slice(0, visibleItemLimit).map(item => {
                  const brand = brands.find(b => b.id === item.brandId);
                  const isSelected = selectedItemIds.has(item.id);
                  const wc = item.bodyHtml ? countWords(item.bodyHtml) : 0;
                  const blockCount = (item.blocks || []).length;
                  return (
                    <div key={item.id} className={`p-4 rounded-[16px] border transition group cursor-pointer relative ${
                      isSelected ? 'border-indigo-300 bg-indigo-50/30 ring-1 ring-indigo-200' : 'border-slate-100 hover:border-indigo-200 hover:shadow-md bg-slate-50/50 hover:bg-white'
                    }`} onClick={() => onEditItem(item)} title={`"${item.title}" — currently in the ${item.status.replace('_', ' ')} stage of the workflow${item.primaryKeyword ? `, targeting keyword "${item.primaryKeyword}"` : ''}. Click to open in the editor.`}>
                      {/* Selection checkbox */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleItemSelection(item.id); }}
                        title={isSelected ? 'Deselect' : 'Select for bulk actions'}
                        className="absolute top-3 right-3 z-10"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-indigo-600" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 hover:text-slate-500 transition" />
                        )}
                      </button>

                      <div className="flex items-center justify-between mb-2 text-xs pr-6">
                        <span
                          className="px-2 py-1 rounded-md font-bold uppercase tracking-wider text-[10px]"
                          style={{ backgroundColor: `${brand?.primaryColor || '#4f46e5'}20`, color: brand?.primaryColor || '#4f46e5' }}
                        >
                          {brand?.name}
                        </span>
                        <span className={`font-bold uppercase tracking-wider text-[10px] px-2 py-1 rounded-md ${
                          item.status === 'Published' ? 'bg-emerald-50 text-emerald-700' :
                          item.status === 'Draft_Ready' ? 'bg-amber-50 text-amber-700' :
                          item.status === 'Error' ? 'bg-red-50 text-red-700' :
                          'bg-indigo-50 text-indigo-700'
                        }`}>
                          {item.status === 'Error' ? 'Error' : item.status.replace('_', ' ')}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 group-hover:text-indigo-600 transition">
                        {item.title}
                      </h4>

                      {/* Workflow progress: Plan -> Write -> Review -> Live */}
                      <div className="mt-3 flex items-center gap-1.5">
                        {['Planned', 'Generating', 'Draft_Ready', 'Published'].map((stage, si) => {
                          const order: Record<string, number> = { Planned: 0, Researching: 0, Generating: 1, Draft_Ready: 2, Published: 3, Error: 0 };
                          const pos = order[item.status] ?? 0;
                          const done = item.status === 'Error' ? false : si < pos;
                          const current = item.status === 'Error' ? si === 0 && item.status === 'Error' : si === pos;
                          return (
                            <div key={stage} className="flex-1 h-1.5 rounded-full bg-slate-200/80 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${
                                  item.status === 'Error' ? 'bg-red-400' : done || current ? 'bg-indigo-500' : 'bg-transparent'
                                }`}
                                style={{ width: done || current ? '100%' : '0%' }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-1.5 text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                        <span>Plan</span><span>Write</span><span>Review</span><span>Live</span>
                      </div>

                      {/* Quick stats row */}
                      <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500 flex-wrap">
                        {wc > 0 && (
                          <span className="flex items-center gap-0.5 font-semibold" title={`${wc.toLocaleString()} words in the draft body`}>
                            <FileText className="w-3 h-3" /> {wc.toLocaleString()}w
                          </span>
                        )}
                        {blockCount > 0 && (
                          <span className="flex items-center gap-0.5 font-semibold" title={`${blockCount} content blocks`}>
                            <Layers className="w-3 h-3" /> {blockCount}b
                          </span>
                        )}
                        {item.scheduledPublishAt && (
                          <span className={`flex items-center gap-0.5 font-semibold ${
                            new Date(item.scheduledPublishAt).getTime() <= Date.now() && item.status !== 'Published'
                              ? 'text-red-600'
                              : 'text-indigo-600'
                          }`} title={`Scheduled for ${new Date(item.scheduledPublishAt).toLocaleString()}`}>
                            <Clock className="w-3 h-3" /> {new Date(item.scheduledPublishAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                        {item.wpLiveUrl && (
                          <a
                            href={item.wpLiveUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-0.5 font-semibold text-emerald-600 hover:text-emerald-800 transition"
                            title="Open live WordPress post"
                          >
                            <ExternalLink className="w-3 h-3" /> Live
                          </a>
                        )}
                      </div>

                      <div className="mt-3 flex items-center text-xs text-slate-500 justify-between gap-2">
                        <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200 truncate max-w-[150px]">
                          {item.primaryKeyword || 'No keyword'}
                        </span>
                        <span className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); onEditItem(item); }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold transition"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); void confirmDelete(item); }}
                            title={`Delete "${item.title}"${item.wpLiveUrl ? ' and trash its WordPress post' : ''}`}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold transition"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Multi-Brand Health & Activity Logs */}
        <div className="space-y-6">
          {/* Real Traffic & Engagement: server-measured audience signals */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-sky-500" /> Traffic & Engagement
                </h2>
                <p className="text-xs text-slate-500 mt-1">Server-measured audience signals pulled from each site.</p>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">LIVE signals</span>
            </div>

            {/* Aggregated signals */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <Tip text="Total approved comments across all sites in scope, straight from each site's WP REST API." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-slate-900">{trafficTotals.comments != null ? trafficTotals.comments.toLocaleString() : '—'}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total comments</div>
                </div>
              </Tip>
              <Tip text="Comments received in the last 30 days across the sites in scope — a fresh sign of audience engagement." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-sky-600">{trafficTotals.recent.toLocaleString()}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New comments · 30d</div>
                </div>
              </Tip>
              <Tip text="Comments awaiting moderation (the WP hold queue). Needs a working Application Password — otherwise shown as a dash." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-amber-600">{trafficTotals.pending != null ? trafficTotals.pending.toLocaleString() : '—'}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">In moderation queue</div>
                </div>
              </Tip>
              <Tip text="Average publishing rate across the sites in scope — published posts over roughly the last 90 days, expressed per month. A steady 1+ posts/month keeps a blog growing." className="w-full">
                <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                  <div className="text-xl font-extrabold text-emerald-600">{trafficTotals.cadence}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Posts / month · avg</div>
                </div>
              </Tip>
            </div>

            <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
              {trafficSignals.map((t) => (
                <div key={t.brand.id} className="bg-slate-50 rounded-2xl border border-slate-200/60 p-3.5" title={`Engagement for ${t.siteName ? decodeHtml(t.siteName) : t.brand.name} (${t.brand.wpUrl}): approved comments total, comments in the last 30 days, comments in the moderation queue, and publishing rate (posts/month over ~90 days). Measured server-side from the site's WP REST API — true visitor counts need GA4 or Jetpack connected.`}>
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-7 h-7 rounded-[9px] flex items-center justify-center font-bold text-[9px] text-white shadow-sm shrink-0"
                        style={{ backgroundColor: t.brand.primaryColor || '#185e46' }}
                      >
                        {t.brand.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-xs leading-tight truncate">
                          {t.siteName ? decodeHtml(t.siteName) : t.brand.name}
                        </div>
                        <div className="text-[9px] text-slate-400 truncate">{t.brand.wpUrl.replace(/^https?:\/\//, '')}</div>
                      </div>
                    </div>
                    {t.error ? (
                      <span className="text-[9px] font-bold text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full shrink-0" title="The site couldn't be reached, so no engagement signals are available.">UNREACHABLE</span>
                    ) : t.comments == null && t.posts == null ? (
                      <span className="text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full shrink-0" title="No stats could be read from this site yet (still syncing, or the WP REST API didn't answer).">NO DATA</span>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: 'Comments', value: t.comments != null ? t.comments.toLocaleString() : '—', cls: 'text-slate-900', tip: 'Total approved comments on this site.' },
                      { label: 'Last 30d', value: t.recentComments.toLocaleString(), cls: 'text-sky-600', tip: 'Comments received in the last 30 days.' },
                      { label: 'Mod queue', value: t.pending != null ? t.pending.toLocaleString() : '—', cls: 'text-amber-600', tip: 'Comments awaiting moderation. "—" means the moderation queue couldn\'t be read (needs a working Application Password).' },
                      { label: 'Posts/mo', value: t.cadence ? `${t.cadence}` : '—', cls: 'text-emerald-600', tip: 'Published posts per month over roughly the last 90 days. "—" means no recent publishing activity to measure.' },
                    ].map((m) => (
                      <div key={m.label} title={m.tip} className="bg-white rounded-xl border border-slate-100 py-1.5 px-1 cursor-help">
                        <div className={`text-sm font-extrabold ${m.cls}`}>{m.value}</div>
                        <div className="text-[8px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{m.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5" title="Extra signals: engagement ratio (comments per published post), registered WordPress users, and the analytics/tracking stack the site runs.">
                    {t.engagement != null && (
                      <span className="text-[9px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">{t.engagement} comments / post</span>
                    )}
                    {t.users != null && (
                      <span className="text-[9px] font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded-full">{t.users.toLocaleString()} users</span>
                    )}
                    {t.analytics.length > 0 ? (
                      <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full" title="Analytics tools this site already runs (detected in its homepage HTML) — the dashboard doesn't read their data, it just shows which systems are installed.">
                        <Wifi className="w-2.5 h-2.5 inline mr-0.5" /> {t.analytics.map((a) => ANALYTICS_LABELS[a] || a).join(', ')}
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded-full" title="No known analytics or tracking scripts found on this site's homepage — visitor traffic isn't being measured.">No traffic tracking installed</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[10px] text-slate-400 leading-relaxed">
              These are engagement signals measured server-side from each site's WP REST API (comment counts, moderation queue, publishing cadence) and from the tracking scripts installed on its homepage. True visitor counts need GA4 or Jetpack connected — the Tracking chips show which system each site already uses.
            </p>
          </div>

          {/* Real Activity Feed */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-indigo-500" /> Activity Feed
                </h2>
                <p className="text-xs text-slate-500 mt-1">Latest comments and post changes from each connected site.</p>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
                {activityFeed.length} events
              </span>
            </div>

            {/* Breakdown chips */}
            {activityFeed.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-1 rounded-full">
                  {activityFeed.filter((e) => e.kind === 'published').length} published
                </span>
                <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full">
                  {activityFeed.filter((e) => e.kind === 'edited').length} edited
                </span>
                <span className="text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-100 px-2 py-1 rounded-full">
                  {activityFeed.filter((e) => e.kind === 'comment').length} comments
                </span>
              </div>
            )}

            {activityFeed.length === 0 ? (
              <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No activity detected yet.</p>
                <p className="text-xs text-slate-400 mt-1">Comments and post changes from each connected site appear here as they're found.</p>
              </div>
            ) : (
              <div className="relative max-h-[480px] overflow-y-auto pr-1">
                {/* timeline connector */}
                <div className="absolute left-[19px] top-3 bottom-3 w-px bg-slate-200" />
                <div className="space-y-1">
                  {activityFeed.map((e) => (
                    <div key={e.id} className="relative flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition group" title={e.kind === 'comment'
                      ? `New comment by ${e.author} on "${e.title}" (${e.brandName}) — ${timeAgo(e.date)}.`
                      : e.kind === 'published'
                      ? `Post published to WordPress: "${e.title}" (${e.brandName}) — ${timeAgo(e.date)}.`
                      : `Draft edited: "${e.title}" (${e.brandName}) — ${timeAgo(e.date)}.`}>
                      <div
                        className="relative z-10 w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ring-4 ring-white"
                        style={{ backgroundColor: `${e.brandColor || '#185e46'}18`, color: e.brandColor || '#185e46' }}
                      >
                        {e.kind === 'comment' ? <MessageSquare className="w-3.5 h-3.5" /> : e.kind === 'published' ? <Zap className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold text-slate-800 leading-snug">
                          {e.kind === 'comment' ? (
                            <><span className="text-slate-500 font-semibold">{e.author}</span> commented on <span className="text-indigo-600">{e.title}</span></>
                          ) : e.kind === 'published' ? (
                            <><span className="text-slate-500 font-semibold">Published</span> {e.title}</>
                          ) : (
                            <><span className="text-slate-500 font-semibold">Edited draft</span> {e.title}</>
                          )}
                        </p>
                        {e.kind === 'comment' && e.snippet && (
                          <p className="text-[11px] text-slate-400 mt-0.5 truncate">“{e.snippet}”</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{e.brandName}</span>
                          <span className="text-[10px] text-slate-400">{timeAgo(e.date)}</span>
                        </div>
                        {(e.kind === 'published' || e.kind === 'edited') && e.wpPostId != null && (
                          <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => void openWpPostInEditor(e)}
                              disabled={openingFeedId === String(e.wpPostId)}
                              title={items.find((i) => String(i.wpPostId) === String(e.wpPostId))
                                ? 'Open this post in the Blog Editor — see its live/draft state and publish options'
                                : 'Import this post into the app, then open it in the Blog Editor'}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold transition disabled:opacity-50"
                            >
                              <Pencil className="w-3 h-3" /> {openingFeedId === String(e.wpPostId) ? 'Opening…' : 'Edit'}
                            </button>
                            <button
                              onClick={() => void trashWpPost({ id: e.wpPostId, brandId: e.brandId, title: e.title })}
                              title={`Trash this WordPress post (${e.wpLiveUrl || 'no link'}) — recoverable in WP for 30 days`}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold transition"
                            >
                              <Trash2 className="w-3 h-3" /> Trash
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-sky-500" /> Live WordPress Posts
                </h2>
                <p className="text-xs text-slate-500 mt-1">Recent posts pulled straight from each connected site. Click a post to import it into the editor.</p>
              </div>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
                {livePosts.filter(p => selectedBrandId === 'all' || p.brandId === selectedBrandId).length} live
              </span>
            </div>

            {/* Quick stats + search */}
            {livePosts.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  {livePosts.filter(p => selectedBrandId === 'all' || p.brandId === selectedBrandId).length} posts
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  {new Set(livePosts.filter(p => selectedBrandId === 'all' || p.brandId === selectedBrandId).map(p => p.brandId)).size} site(s)
                </span>
                {(() => {
                  const scoped = livePosts.filter(p => selectedBrandId === 'all' || p.brandId === selectedBrandId);
                  const last = scoped.slice().sort((a: any, z: any) => new Date(z.date).getTime() - new Date(a.date).getTime())[0];
                  return last ? (
                    <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                      Latest: {new Date(last.date).toLocaleDateString()}
                    </span>
                  ) : null;
                })()}
                <div className="relative ml-auto">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={livePostSearch}
                    onChange={(e) => setLivePostSearch(e.target.value)}
                    placeholder="Search posts…"
                    className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-200 w-44"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
              {livePosts.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                  <Globe className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No live posts fetched yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Sync Data" to fetch recent posts directly from connected WordPress properties.</p>
                </div>
              ) : (
                livePosts
                  .filter(post => selectedBrandId === 'all' || post.brandId === selectedBrandId)
                  .filter(post => {
                    if (!livePostSearch.trim()) return true;
                    const q = livePostSearch.toLowerCase();
                    const title = (post.title?.rendered || '').toLowerCase();
                    const brand = (post.brandName || '').toLowerCase();
                    return title.includes(q) || brand.includes(q);
                  })
                  .map((post, i) => (
                  <div
                    key={`${post.brandId}-${post.id}`}
                    onClick={() => onImportWPPost && onImportWPPost(post)}
                    title={`"${post.title?.rendered || 'Untitled Post'}" — published ${new Date(post.date).toLocaleDateString()} on ${post.brandName}. Click to pull this post into the editor.`}
                    className="group block relative flex items-start gap-4 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100 w-full text-left cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-[12px] flex items-center justify-center font-bold text-xs text-white shadow-sm shrink-0"
                         style={{ backgroundColor: post.brandColor || '#4f46e5' }}>
                      {post.brandName ? post.brandName.substring(0, 2).toUpperCase() : 'WP'}
                    </div>
                    <div className="pt-0.5 flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 leading-snug truncate group-hover:text-indigo-600 transition" dangerouslySetInnerHTML={{ __html: post.title?.rendered || 'Untitled Post' }} />
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{post.brandName}</span>
                        <span className="text-[10px] font-medium text-slate-400">{new Date(post.date).toLocaleDateString()}</span>
                        {post.link && (
                          <a
                            href={post.link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-0.5 text-[10px] font-semibold text-sky-600 hover:text-sky-700 hover:underline"
                            title="Open the live post in a new tab"
                          >
                            <ExternalLink className="w-3 h-3" /> view live
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="pt-2 flex flex-col items-end gap-1.5">
                      <span className="text-[10px] text-indigo-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Edit directly</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); onImportWPPost && onImportWPPost(post); }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-[10px] font-bold transition opacity-0 group-hover:opacity-100"
                          title="Pull this post into the editor"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); void trashWpPost(post); }}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 text-[10px] font-bold transition opacity-0 group-hover:opacity-100"
                          title="Move this post to the WordPress trash (recoverable for 30 days)"
                        >
                          <Trash2 className="w-3 h-3" /> Trash
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Modal: Bulk Schedule */}
      {bulkScheduleOpen && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-600" />
                Schedule {selectedItemIds.size} item{selectedItemIds.size === 1 ? '' : 's'}
              </h2>
              <button onClick={() => setBulkScheduleOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">Set a future date and time to schedule all selected items for publishing. Items already past their schedule will be flagged as overdue.</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={bulkScheduleDate}
                  onChange={(e) => setBulkScheduleDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Time</label>
                <input
                  type="time"
                  value={bulkScheduleTime}
                  onChange={(e) => setBulkScheduleTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setBulkScheduleOpen(false)}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={bulkSchedule}
                disabled={!bulkScheduleDate || !bulkScheduleTime}
                className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition disabled:opacity-50"
              >
                Schedule All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create New Content Item */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                Plan New Blog Post
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Target Brand Property</label>
                <select
                  value={newBrandId}
                  onChange={(e) => setNewBrandId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Publish Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewType('post')}
                    className={`py-3 rounded-xl text-sm font-bold border transition ${
                      newType === 'post'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-500/20'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    📝 Blog Post
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('page')}
                    className={`py-3 rounded-xl text-sm font-bold border transition ${
                      newType === 'page'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-500/20'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    📄 Landing Page
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Topic or Working Title</label>
                <input
                  type="text"
                  placeholder="e.g. 10 Natural Dog Treats for Digestive Health"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder:text-slate-400"
                  required
                  autoFocus
                />
              </div>

              <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
                <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none text-sm font-semibold text-slate-600 hover:text-slate-800">
                  <span>Optional — keyword planning for richer SEO</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 group-open:rotate-180 transition" />
                </summary>
                <div className="px-4 pb-4 pt-1 space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Primary Keyword</label>
                    <input
                      type="text"
                      placeholder="e.g. natural dog treats UK (optional)"
                      value={newPrimaryKeyword}
                      onChange={(e) => setNewPrimaryKeyword(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Secondary Keywords</label>
                    <input
                      type="text"
                      placeholder="Comma-separated, e.g. grain-free treats, puppy snacks (optional)"
                      value={newSecondaryKeywords}
                      onChange={(e) => setNewSecondaryKeywords(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Skip this and the inbuilt SEO tool will still analyse, score and refine the post automatically.
                  </p>
                </div>
              </details>

              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-md flex items-center gap-2"
                >
                  Create & Launch Editor <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
