import React, { useState, useMemo, useEffect } from 'react';
import { ContentItem, Brand } from '../types';
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
  Image as ImageIcon
} from 'lucide-react';
import {
  LineChart,
  Line,
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
}

interface WpOverview {
  stats?: WpStats;
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
  scriptCount?: number;
  styleCount?: number;
  imgCount?: number;
  lazyImgCount?: number;
  wpRestMs?: number | null;
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

interface DashboardProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (brandId: string) => void;
  onEditItem: (item: ContentItem) => void;
  onCreateNewItem: (title: string, brandId: string, contentType: 'post' | 'page') => void;
  onImportWPPost?: (post: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
  onCreateNewItem,
  onImportWPPost,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBrandId, setNewBrandId] = useState(selectedBrandId === 'all' ? (brands[0]?.id || '') : selectedBrandId);
  const [newType, setNewType] = useState<'post' | 'page'>('post');
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'planned' | 'writing' | 'review' | 'published' | 'error'>('all');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<7 | 14 | 30>(14);

  // Real-time data fetched straight from each brand's WordPress REST API
  const [overviews, setOverviews] = useState<Record<string, WpOverview>>({});
  const [perf, setPerf] = useState<Record<string, WpPerf>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncingPerf, setSyncingPerf] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

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

  const metricValue = (v: number | null) => (v === null ? '—' : v.toLocaleString());

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

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateNewItem(newTitle.trim(), newBrandId, newType);
    setNewTitle('');
    setShowCreateModal(false);
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
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-100 border-none text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-none text-slate-800 placeholder:text-slate-500"
            />
          </div>
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
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="hidden md:flex items-center gap-1.5 text-[11px] font-semibold text-slate-400">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            Live · auto-refresh 60s
          </span>
          <button 
            onClick={handleSyncData}
            disabled={syncing}
            className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm disabled:opacity-70 disabled:cursor-wait"
          >
            <RefreshCcw className={`w-4 h-4 text-slate-400 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Data'}</span>
          </button>
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
        </div>
      </div>

      {/* Metrics Row — every value fetched live from WordPress */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Live Published Posts', value: metricValue(livePostsTotal), subtext: livePostsTotal === null ? 'Waiting for first sync' : 'Direct from WP REST API', icon: Activity, color: 'text-white', bg: 'bg-white/20', badge: 'Live', isPrimary: true, details: `Posts with status "publish" across ${brandList.length} site${brandList.length === 1 ? '' : 's'}. Fetched via the WP REST API — counts update every 60 seconds.` },
          { label: 'Drafts Awaiting', value: metricValue(draftTotal), subtext: draftTotal === null ? 'Needs WP auth' : 'On the live site', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', badge: 'Live', details: 'Posts currently sitting as drafts on WordPress. Requires Application Password access to count — otherwise shown as "—".' },
          { label: 'Total Comments', value: metricValue(commentsTotal), subtext: pendingComments ? `${pendingComments.toLocaleString()} awaiting moderation` : 'User engagement', icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50', badge: 'Live', details: 'Approved comments on published content. Pending/hold comments are tracked separately.' },
          { label: 'Media Library Items', value: metricValue(mediaTotal), subtext: pagesTotal !== null ? `${pagesTotal.toLocaleString()} pages · ${categoriesTotal === null ? '—' : categoriesTotal.toLocaleString()} categories` : 'Images and assets', icon: ImageIcon, color: 'text-purple-600', bg: 'bg-purple-50', badge: 'Live', details: 'Attachments in the WordPress media library, plus live page and category counts.' }
        ].map((metric, idx) => (
          <div 
            key={idx} 
            onClick={() => setExpandedInsight(expandedInsight === idx ? null : idx)}
            className={`p-6 rounded-[24px] border cursor-pointer ${metric.isPrimary ? 'bg-[#185e46] border-[#134937] text-white shadow-lg shadow-[#185e46]/20' : 'bg-white border-slate-200/60 shadow-sm'} flex flex-col justify-between hover:shadow-md transition group relative overflow-hidden`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${metric.bg}`}>
                <metric.icon className={`w-5 h-5 ${metric.color}`} />
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${metric.isPrimary ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'}`}>
                {metric.badge}
              </span>
            </div>
            <div>
              <div className={`text-4xl font-extrabold tracking-tight mb-2 ${metric.isPrimary ? 'text-white' : 'text-slate-900'}`}>{metric.value}</div>
              <div className={`text-[13px] font-bold ${metric.isPrimary ? 'text-emerald-50' : 'text-slate-900'}`}>{metric.label}</div>
              <div className={`text-[11px] font-medium mt-1 ${metric.isPrimary ? 'text-emerald-200' : 'text-slate-500'}`}>{metric.subtext}</div>
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
            <h2 className="text-lg font-bold text-slate-900">Production Pipeline</h2>
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
            <span className="text-xs font-bold text-red-700 flex items-center gap-2">
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

      {/* Up Next: Continue where you left off */}
      {nextActionItem && stageFilter === 'all' && (
        <div className="mb-6 bg-slate-900 text-white p-5 rounded-[24px] shadow-lg shadow-slate-900/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800">
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
                <h2 className="text-lg font-bold text-slate-900">Content Activity</h2>
                <p className="text-sm text-slate-500">Posts published vs drafts edited per day, straight from each site's WP REST API. <span className="text-xs text-slate-400 ml-1">Updated: {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString() : '…'}</span></p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
                {([7, 14, 30] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => setChartRange(r)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                      chartRange === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {r}D
                  </button>
                ))}
              </div>
            </div>
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
          </div>

          {/* Structured Card Grid */}
          <div className="bg-white rounded-[24px] border border-slate-200/60 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Pipeline Breakdown</h2>
                <p className="text-xs text-slate-500 mt-1">
                  {stageFilter === 'all'
                    ? 'Real-time snapshot of where posts sit in the workflow.'
                    : `Showing items in "${workflowStages.find((s) => s.key === stageFilter)?.label || (stageFilter === 'error' ? 'Error' : '')}" stage.`}
                </p>
              </div>
              {stageFilter !== 'all' ? (
                <button
                  onClick={() => setStageFilter('all')}
                  className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors"
                >
                  Show All <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              ) : (
                <button className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors">
                  View All <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              )}
            </div>
            
            {filteredItems.length === 0 ? (
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
                {filteredItems.slice(0, 6).map(item => {
                  const brand = brands.find(b => b.id === item.brandId);
                  return (
                    <div key={item.id} className="p-4 rounded-[16px] border border-slate-100 hover:border-indigo-200 hover:shadow-md transition bg-slate-50/50 hover:bg-white group cursor-pointer" onClick={() => onEditItem(item)}>
                      <div className="flex items-center justify-between mb-2 text-xs">
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

                      <div className="mt-3 flex items-center text-xs text-slate-500 justify-between">
                        <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200 truncate max-w-[150px]">
                          {item.primaryKeyword || 'No keyword'}
                        </span>
                        <span className="flex items-center gap-1 text-indigo-500 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                          Open <ChevronRight className="w-3.5 h-3.5" />
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
          {/* Real Site Performance */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Site Performance</h2>
              <button
                onClick={() => { setSyncingPerf(true); Promise.all(brandList.map((b) => fetchPerfFor(b, true))).finally(() => setSyncingPerf(false)); }}
                disabled={syncingPerf}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-50 transition disabled:opacity-60"
                title="Re-measure all sites now"
              >
                <RefreshCcw className={`w-4 h-4 ${syncingPerf ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="space-y-5">
              {brandList.map((brand) => {
                const p = perf[brand.id];
                const ov = overviews[brand.id];
                const ok = p && p.success !== false;
                const posts = ov?.stats?.posts;
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
                        <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-full shrink-0">
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                          LIVE
                        </span>
                      ) : p?.httpStatus ? (
                        <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-full shrink-0">HTTP {p.httpStatus}</span>
                      ) : p ? (
                        <span className="text-[10px] font-bold text-red-700 bg-red-50 border border-red-100 px-2 py-1 rounded-full shrink-0">UNREACHABLE</span>
                      ) : (
                        <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-1 rounded-full shrink-0">MEASURING…</span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: 'TTFB', value: p?.ttfbMs != null ? `${p.ttfbMs}ms` : '—', cls: ttfbTone(p?.ttfbMs) },
                        { label: 'WP API', value: p?.wpRestMs != null ? `${p.wpRestMs}ms` : '—', cls: p?.wpRestMs != null ? (p.wpRestMs < 1200 ? 'text-emerald-600' : 'text-amber-600') : 'text-slate-400' },
                        { label: 'Page', value: kb(p?.htmlBytes), cls: 'text-slate-700' },
                        { label: 'Posts', value: posts != null ? posts.toLocaleString() : '—', cls: 'text-slate-700' },
                      ].map((m) => (
                        <div key={m.label} className="bg-white rounded-xl border border-slate-100 py-2 px-1">
                          <div className={`text-sm font-extrabold ${m.cls}`}>{m.value}</div>
                          <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">{m.label}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 font-medium">
                      <span>
                        {p?.scriptCount != null ? `${p.scriptCount} scripts · ${p.styleCount} styles · ${p.imgCount} imgs (${p.lazyImgCount} lazy)` : 'No measurements yet'}
                      </span>
                      <span>{p?.measuredAt ? timeAgo(p.measuredAt) : '—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[10px] text-slate-400 leading-relaxed">
              Measured server-side with a real HTTP fetch of each homepage (TTFB, payload size, asset counts) — no third-party APIs. Re-measures every 10 minutes.
            </p>
          </div>

          {/* Real Activity Feed */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Activity Feed</h2>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
                {activityFeed.length} events
              </span>
            </div>
            {activityFeed.length === 0 ? (
              <div className="text-center py-10">
                <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No activity detected yet.</p>
                <p className="text-xs text-slate-400 mt-1">Comments and post changes from each connected site appear here as they're found.</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
                {activityFeed.map((e) => (
                  <div key={e.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition group">
                    <div
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Live WordPress Posts</h2>
              <button className="text-slate-400 hover:text-slate-600">
                <Globe className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {livePosts.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500">No live posts fetched yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Sync Data" to fetch recent posts directly from connected WordPress properties.</p>
                </div>
              ) : (
                livePosts
                  .filter(post => selectedBrandId === 'all' || post.brandId === selectedBrandId)
                  .map((post, i) => (
                  <button 
                    key={`${post.brandId}-${post.id}`} 
                    onClick={() => onImportWPPost && onImportWPPost(post)}
                    className="group block relative flex items-start gap-4 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100 w-full text-left"
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
                      </div>
                    </div>
                    <div className="pt-2 flex flex-col items-end gap-1">
                       <span className="text-[10px] text-indigo-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Edit directly</span>
                       <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

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
