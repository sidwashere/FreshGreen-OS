import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ContentItem, Brand, AutoBlogOverrides } from '../types';
import {
  FileSpreadsheet,
  RefreshCw,
  Calendar,
  Clock,
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Settings2,
  Link2,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Sparkles,
  Eye,
  ArrowRight,
  Zap,
  CalendarClock,
  Layers,
  Download,
} from 'lucide-react';

interface AutoBlogSchedulerProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSaveItem: (item: ContentItem) => void;
  onCreateNewItem: (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[]; sheetContext?: any; seoBrief?: string; initialPrompt?: string }
  ) => void;
  onDeleteItem: (item: ContentItem) => Promise<{ success: boolean; message?: string }>;
  onEditItem: (item: ContentItem) => void;
}

interface SheetRow {
  [key: string]: string;
}

interface SheetTab {
  name: string;
  gid: string;
  rowCount?: number;
}

type ViewMode = 'queue' | 'calendar' | 'settings';

const statusColors: Record<string, string> = {
  Planned: 'bg-slate-100 text-slate-600',
  Researching: 'bg-violet-100 text-violet-700',
  Generating: 'bg-amber-100 text-amber-700',
  Draft_Ready: 'bg-sky-100 text-sky-700',
  Published: 'bg-emerald-100 text-emerald-700',
  Error: 'bg-red-100 text-red-700',
};

// ── Calendar Grid Component ─────────────────────────────────────────────────
interface CalendarGridProps {
  year: number;
  month: number;
  items: ContentItem[];
  onEditItem: (item: ContentItem) => void;
  onGenerate: (item: ContentItem) => void;
  generating: Set<string>;
  brands: Brand[];
}

const CalendarGrid: React.FC<CalendarGridProps> = ({
  year, month, items, onEditItem, onGenerate, generating, brands,
}) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Build the calendar days for the month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  // Monday=0 ... Sunday=6
  const startDow = (firstDay.getDay() + 6) % 7;

  // Map items by scheduled date
  const itemsByDate = useMemo(() => {
    const map: Record<string, ContentItem[]> = {};
    for (const item of items) {
      if (!item.scheduledPublishAt) continue;
      const d = new Date(item.scheduledPublishAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }, [items]);

  const cells: { day: number | null; key: string }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null, key: `empty-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, key });
  }
  // Pad trailing cells to complete the last row
  while (cells.length % 7 !== 0) cells.push({ day: null, key: `end-${cells.length}` });

  return (
    <div className="grid grid-cols-7 gap-1">
      {cells.map((cell) => {
        if (!cell.day) {
          return <div key={cell.key} className="min-h-[90px] bg-slate-50/50 rounded-xl" />;
        }

        const isToday = cell.key === todayStr;
        const dayItems = itemsByDate[cell.key] || [];
        const isWeekend = (cells.indexOf(cell) % 7) >= 5;

        return (
          <div
            key={cell.key}
            className={`min-h-[90px] rounded-xl border p-1.5 transition ${
              isToday
                ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200'
                : isWeekend
                  ? 'border-slate-100 bg-slate-50/30'
                  : 'border-slate-150 bg-white hover:border-slate-300'
            }`}
          >
            <div className={`text-[11px] font-bold mb-1 ${isToday ? 'text-violet-600' : 'text-slate-500'}`}>
              {cell.day}
            </div>
            <div className="space-y-1">
              {dayItems.slice(0, 3).map((item) => {
                const isGen = generating.has(item.id);
                const isPublished = item.status === 'Published';
                return (
                  <div
                    key={item.id}
                    onClick={() => onEditItem(item)}
                    className={`group relative rounded-lg px-1.5 py-1 cursor-pointer transition ${
                      isPublished
                        ? 'bg-emerald-50 border border-emerald-200 hover:border-emerald-300'
                        : 'bg-sky-50 border border-sky-200 hover:border-sky-300'
                    }`}
                    title={item.title}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        isPublished ? 'bg-emerald-500' : 'bg-sky-500'
                      }`} />
                      <span className="text-[10px] font-semibold text-slate-700 truncate leading-tight">
                        {item.title}
                      </span>
                    </div>
                    {item.primaryKeyword && (
                      <div className="text-[8px] text-slate-400 truncate mt-0.5 leading-tight">
                        🔑 {item.primaryKeyword}
                      </div>
                    )}
                    {/* Write Article button on hover */}
                    {!isPublished && item.status === 'Planned' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onGenerate(item); }}
                        disabled={isGen}
                        className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-sm disabled:opacity-50"
                        title="Write Article"
                      >
                        {isGen ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Sparkles className="w-2.5 h-2.5" />}
                      </button>
                    )}
                  </div>
                );
              })}
              {dayItems.length > 3 && (
                <div className="text-[9px] text-slate-400 text-center font-medium">
                  +{dayItems.length - 3} more
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const AutoBlogScheduler: React.FC<AutoBlogSchedulerProps> = ({
  items,
  brands,
  selectedBrandId,
  onSaveItem,
  onCreateNewItem,
  onDeleteItem,
  onEditItem,
}) => {
  // ── Sheet connection state ──────────────────────────────────────────
  const [sheetUrl, setSheetUrl] = useState(() => {
    try { return localStorage.getItem('fgos_autoblog_sheet_url') || ''; } catch { return ''; }
  });
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Schedule config ────────────────────────────────────────────────
  const [cadenceDays, setCadenceDays] = useState(() => {
    try { return parseInt(localStorage.getItem('fgos_autoblog_cadence') || '3', 10); } catch { return 3; }
  });
  const [startDate, setStartDate] = useState(() => {
    try { return localStorage.getItem('fgos_autoblog_start_date') || new Date().toISOString().split('T')[0]; } catch { return new Date().toISOString().split('T')[0]; }
  });
  const [autoPublish, setAutoPublish] = useState(() => {
    try { return localStorage.getItem('fgos_autoblog_auto_publish') !== '0'; } catch { return true; }
  });
  const [defaultTone, setDefaultTone] = useState<string>('professional');
  const [defaultWordCount, setDefaultWordCount] = useState<number>(1500);
  const [autoGenerateImages, setAutoGenerateImages] = useState(true);
  const [autoSeoAnalysis, setAutoSeoAnalysis] = useState(true);
  const [autoHumanize, setAutoHumanize] = useState(false);

  // ── UI state ───────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>('queue');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ── Calendar state ────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  // Persist config to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('fgos_autoblog_sheet_url', sheetUrl);
      localStorage.setItem('fgos_autoblog_cadence', String(cadenceDays));
      localStorage.setItem('fgos_autoblog_start_date', startDate);
      localStorage.setItem('fgos_autoblog_auto_publish', autoPublish ? '1' : '0');
    } catch { /* ignore */ }
  }, [sheetUrl, cadenceDays, startDate, autoPublish]);

  // ── Auto-publish check (runs every 60s when enabled) ───────────────
  useEffect(() => {
    if (!autoPublish) return;
    const interval = setInterval(async () => {
      const now = new Date();
      const dueItems = items.filter(
        (i) =>
          i.scheduledPublishAt &&
          i.status === 'Draft_Ready' &&
          !i.lastAutoPublishedAt &&
          new Date(i.scheduledPublishAt) <= now
      );
      if (dueItems.length === 0) return;
      try {
        const resp = await fetch('/api/autoblog/check-publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dueItems, brands }),
        });
        const data = await resp.json();
        if (data.published > 0) {
          for (const r of data.results || []) {
            if (r.success) {
              const item = dueItems.find((i) => i.id === r.itemId);
              if (item) {
                onSaveItem({
                  ...item,
                  status: 'Published',
                  wpPostId: r.wpPostId,
                  lastAutoPublishedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            }
          }
          setNotice({ kind: 'ok', text: `Auto-published ${data.published} post(s)` });
        }
      } catch {
        // Silently retry next interval
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [autoPublish, items, brands, onSaveItem]);

  // ── AutoBlog items (imported from sheet) ────────────────────────────
  const autoBlogItems = useMemo(
    () => items.filter((i) => i.sourceSheetId || i.scheduledPublishAt),
    [items]
  );

  const scheduledItems = useMemo(
    () =>
      autoBlogItems
        .filter((i) => i.scheduledPublishAt)
        .sort((a, b) => new Date(a.scheduledPublishAt!).getTime() - new Date(b.scheduledPublishAt!).getTime()),
    [autoBlogItems]
  );

  // ── Sheet actions ──────────────────────────────────────────────────
  const handleFetchSheet = async () => {
    if (!sheetUrl.trim()) { setError('Enter a Google Sheet URL'); return; }
    setLoading(true); setError(null); setSheetRows([]); setTabs([]);
    try {
      // Step 1: Discover all tabs with real names
      const tabResp = await fetch('/api/autoblog/list-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl }),
      });
      const tabData = await tabResp.json();
      if (tabData.error) throw new Error(tabData.error);

      const discoveredTabs: SheetTab[] = tabData.tabs || [];
      setTabs(discoveredTabs);

      if (discoveredTabs.length === 0) {
        throw new Error('No sheets found in this Google Sheet');
      }

      // Step 2: Fetch data from the first tab
      const firstTab = discoveredTabs[0];
      setSelectedTab(firstTab.gid);

      const resp = await fetch('/api/autoblog/fetch-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, gid: firstTab.gid }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSheetRows(data.rows || []);
      setSheetHeaders(data.headers || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch sheet');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchTab = async (gid: string) => {
    if (!sheetUrl.trim()) return;
    setLoading(true); setError(null);
    try {
      setSelectedTab(gid);
      const resp = await fetch('/api/autoblog/fetch-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, gid }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSheetRows(data.rows || []);
      setSheetHeaders(data.headers || []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch tab');
    } finally {
      setLoading(false);
    }
  };

  const handleImportRows = async () => {
    if (sheetRows.length === 0) return;
    setImporting(true); setError(null);
    try {
      const resp = await fetch('/api/autoblog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: sheetRows,
          brandId: selectedBrandId,
          sheetId: sheetUrl,
          sheetName: tabs.find((t) => t.gid === selectedTab)?.name || 'Sheet1',
          existingItems: items.map((i) => ({ title: i.title })),
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      // Create content items from imported rows
      const startDateMs = new Date(startDate).getTime();
      let createdCount = 0;
      for (let i = 0; i < data.imported.length; i++) {
        const row = data.imported[i];
        const schedDate = new Date(startDateMs + i * cadenceDays * 86_400_000).toISOString();

        await onCreateNewItem(
          row.title,
          selectedBrandId,
          'post',
          {
            primaryKeyword: row.primaryKeyword,
            secondaryKeywords: row.secondaryKeywords,
            seoBrief: row.seoBrief,
            initialPrompt: row.initialPrompt,
            sheetContext: row.sheetContext,
          }
        );

        createdCount++;
      }

      setNotice({
        kind: 'ok',
        text: `Imported ${createdCount} post(s) • ${data.skipped.length} skipped (duplicates/empty)`,
      });
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  // ── Generate content for a single item ─────────────────────────────
  const handleGenerate = async (item: ContentItem) => {
    setGenerating((prev) => new Set(prev).add(item.id));
    try {
      // Step 1: Generate SEO keywords
      const kwResp = await fetch('/api/ai/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.initialPrompt || item.title,
          brand: brands.find((b) => b.id === item.brandId),
        }),
      });
      const kwData = await kwResp.json();

      // Step 2: Generate article via streaming endpoint (non-streaming fetch for simplicity)
      const genResp = await fetch('/api/ai/generate-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.initialPrompt || item.title,
          contentType: 'post',
          brand: brands.find((b) => b.id === item.brandId),
          primaryKeyword: kwData.primaryKeyword || item.primaryKeyword,
          secondaryKeywords: kwData.secondaryKeywords || item.secondaryKeywords,
          seoBrief: item.seoBrief || kwData.seoBrief,
          sheetContext: item.sheetContext || null,
          targetWordCount: defaultWordCount,
          byokKeys: JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}'),
        }),
      });
      const genData = await genResp.json();

      if (genData.error) throw new Error(genData.error);

      // Update the item with generated content
      const updatedItem: ContentItem = {
        ...item,
        bodyHtml: genData.articleHtml || genData.bodyHtml || item.bodyHtml,
        blocks: genData.blocks || item.blocks,
        primaryKeyword: kwData.primaryKeyword || item.primaryKeyword,
        secondaryKeywords: kwData.secondaryKeywords || item.secondaryKeywords,
        seoBrief: kwData.seoBrief || item.seoBrief,
        metaTitle: genData.metaTitle || item.metaTitle,
        metaDescription: genData.metaDescription || item.metaDescription,
        featuredImageUrl: genData.heroImg || item.featuredImageUrl,
        nanoBananaPrompt: genData.nanoBananaPrompt || item.nanoBananaPrompt,
        status: 'Draft_Ready',
        updatedAt: new Date().toISOString(),
      };

      onSaveItem(updatedItem);
      setNotice({ kind: 'ok', text: `Generated: "${item.title}"` });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Generation failed: ${err.message}` });
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // ── Schedule a single item ─────────────────────────────────────────
  const handleSchedule = (item: ContentItem, date: string, time: string) => {
    const dt = new Date(`${date}T${time || '09:00'}:00`);
    if (isNaN(dt.getTime())) { setNotice({ kind: 'err', text: 'Invalid date/time' }); return; }
    onSaveItem({
      ...item,
      scheduledPublishAt: dt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setNotice({ kind: 'ok', text: `Scheduled "${item.title}" for ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
  };

  // ── Schedule all draft items at once ───────────────────────────────
  const handleScheduleAll = () => {
    const drafts = autoBlogItems.filter((i) => i.status === 'Draft_Ready' && !i.scheduledPublishAt);
    if (drafts.length === 0) return;
    const startDateMs = new Date(startDate).getTime();
    drafts.forEach((item, i) => {
      const schedDate = new Date(startDateMs + i * cadenceDays * 86_400_000);
      onSaveItem({
        ...item,
        scheduledPublishAt: schedDate.toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    setNotice({ kind: 'ok', text: `Scheduled ${drafts.length} posts starting ${startDate}` });
  };

  // ── Remove schedule ────────────────────────────────────────────────
  const handleUnschedule = (item: ContentItem) => {
    onSaveItem({
      ...item,
      scheduledPublishAt: undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  // ── Delete item ────────────────────────────────────────────────────
  const handleDelete = async (item: ContentItem) => {
    await onDeleteItem(item);
    setNotice({ kind: 'ok', text: `Deleted "${item.title}"` });
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatTime = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-violet-100 flex items-center justify-center">
              <CalendarClock className="w-5 h-5 text-violet-600" />
            </div>
            AutoBlog Scheduler
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Google Sheet → AI Generate → Schedule → Auto-Publish
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setView('queue')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              view === 'queue' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Layers className="w-4 h-4 inline mr-1.5" />
            Queue ({autoBlogItems.length})
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              view === 'calendar' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <CalendarClock className="w-4 h-4 inline mr-1.5" />
            Calendar
          </button>
          <button
            onClick={() => setView('settings')}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
              view === 'settings' ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Settings2 className="w-4 h-4 inline mr-1.5" />
            Settings
          </button>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
          notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {notice.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {notice.text}
          <button onClick={() => setNotice(null)} className="ml-auto text-slate-400 hover:text-slate-600">×</button>
        </div>
      )}

      {/* ── SETTINGS VIEW ──────────────────────────────────────────── */}
      {view === 'settings' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sheet Connection */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-violet-500" />
              Google Sheet Connection
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Sheet URL or ID</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sheetUrl}
                  onChange={(e) => setSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none"
                />
                <button
                  onClick={handleFetchSheet}
                  disabled={loading || !sheetUrl.trim()}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Connect
                </button>
              </div>
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
              <p className="text-[11px] text-slate-400 mt-1">
                The sheet must be publicly accessible (Anyone with link can view).
              </p>
            </div>

            {tabs.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">Select Sheet Tab</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {tabs.map((tab) => (
                    <button
                      key={tab.gid}
                      onClick={() => handleFetchTab(tab.gid)}
                      disabled={loading}
                      className={`p-3 rounded-xl text-left transition border ${
                        selectedTab === tab.gid
                          ? 'bg-violet-600 text-white border-violet-600 shadow-md'
                          : 'bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50'
                      } disabled:opacity-50`}
                    >
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className={`w-4 h-4 shrink-0 ${selectedTab === tab.gid ? 'text-violet-200' : 'text-slate-400'}`} />
                        <span className={`text-sm font-bold truncate ${selectedTab === tab.gid ? 'text-white' : 'text-slate-900'}`}>
                          {tab.name}
                        </span>
                      </div>
                      {tab.rowCount !== undefined && (
                        <div className={`text-[11px] mt-1 ${selectedTab === tab.gid ? 'text-violet-200' : 'text-slate-400'}`}>
                          {tab.rowCount} rows available
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sheetRows.length > 0 && (
              <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {tabs.find((t) => t.gid === selectedTab)?.name || 'Sheet'} — {sheetRows.length} rows
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Columns: {sheetHeaders.join(' · ')}
                    </p>
                  </div>
                </div>
                {/* Preview table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] border-collapse">
                    <thead>
                      <tr>
                        {sheetHeaders.slice(0, 6).map((h) => (
                          <th key={h} className="text-left px-2 py-1.5 bg-slate-100 text-slate-600 font-bold border-b border-slate-200 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                        {sheetHeaders.length > 6 && (
                          <th className="text-left px-2 py-1.5 bg-slate-100 text-slate-400 font-bold border-b border-slate-200">
                            +{sheetHeaders.length - 6} more
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetRows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          {sheetHeaders.slice(0, 6).map((h) => (
                            <td key={h} className="px-2 py-1.5 text-slate-700 max-w-[150px] truncate whitespace-nowrap">
                              {row[h] || '—'}
                            </td>
                          ))}
                          {sheetHeaders.length > 6 && (
                            <td className="px-2 py-1.5 text-slate-400">…</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sheetRows.length > 3 && (
                  <p className="text-[10px] text-slate-400 text-center">Showing 3 of {sheetRows.length} rows</p>
                )}
                <button
                  onClick={handleImportRows}
                  disabled={importing}
                  className="w-full px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Import {sheetRows.length} Rows as Planned Posts
                </button>
              </div>
            )}
          </div>

          {/* Schedule Settings */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="font-bold text-slate-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-violet-500" />
              Schedule Settings
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Cadence (days)</label>
                <input
                  type="number"
                  value={cadenceDays}
                  onChange={(e) => setCadenceDays(parseInt(e.target.value) || 1)}
                  min={1}
                  max={90}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Default Brand</label>
              <select
                value={selectedBrandId}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                disabled
              >
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tone</label>
                <select
                  value={defaultTone}
                  onChange={(e) => setDefaultTone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                >
                  <option value="professional">Professional</option>
                  <option value="warm">Warm</option>
                  <option value="playful">Playful</option>
                  <option value="formal">Formal</option>
                  <option value="casual">Casual</option>
                  <option value="brand">Brand Default</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Word Count</label>
                <input
                  type="number"
                  value={defaultWordCount}
                  onChange={(e) => setDefaultWordCount(parseInt(e.target.value) || 1000)}
                  min={500}
                  max={5000}
                  step={100}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPublish}
                  onChange={(e) => setAutoPublish(e.target.checked)}
                  className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                Auto-publish when scheduled date arrives
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoGenerateImages}
                  onChange={(e) => setAutoGenerateImages(e.target.checked)}
                  className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                Auto-generate AI images
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSeoAnalysis}
                  onChange={(e) => setAutoSeoAnalysis(e.target.checked)}
                  className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                Auto-run SEO analysis
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoHumanize}
                  onChange={(e) => setAutoHumanize(e.target.checked)}
                  className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                />
                Auto-humanize drafts
              </label>
            </div>
          </div>

          {/* How It Works */}
          <div className="lg:col-span-2 bg-gradient-to-br from-violet-50 to-purple-50 rounded-2xl border border-violet-200 p-6">
            <h3 className="font-bold text-slate-900 mb-3">How the AutoBlog Pipeline Works</h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
              {[
                { icon: FileSpreadsheet, label: 'Connect Sheet', desc: 'Paste your Google Sheet URL and select the tab containing blog topics' },
                { icon: Layers, label: 'Import Rows', desc: 'Import rows as Planned posts with keywords, intent, and metadata from the sheet' },
                { icon: Sparkles, label: 'AI Generate', desc: 'Click Generate on each post — the AI writes the full article with SEO optimization' },
                { icon: CalendarClock, label: 'Schedule', desc: 'Set publish dates manually or auto-schedule with configurable cadence' },
                { icon: Send, label: 'Auto-Publish', desc: 'When the date arrives, FGOS pushes the draft to WordPress automatically' },
              ].map((step, i) => (
                <div key={i} className="flex flex-col items-center text-center gap-2">
                  <div className="w-10 h-10 rounded-xl bg-white border border-violet-200 flex items-center justify-center">
                    <step.icon className="w-5 h-5 text-violet-600" />
                  </div>
                  <div className="font-semibold text-slate-900 text-xs">{step.label}</div>
                  <div className="text-[11px] text-slate-500 leading-relaxed">{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── CALENDAR VIEW ──────────────────────────────────────────── */}
      {view === 'calendar' && (
        <div className="space-y-4">
          {/* Month navigation */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <button
                onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
                className="p-2 hover:bg-slate-100 rounded-xl transition"
              >
                <ChevronLeft className="w-5 h-5 text-slate-600" />
              </button>
              <h2 className="text-lg font-bold text-slate-900">
                {new Date(calYear, calMonth).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </h2>
              <button
                onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
                className="p-2 hover:bg-slate-100 rounded-xl transition"
              >
                <ChevronRight className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            {/* Calendar grid */}
            <div className="p-4">
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                  <div key={d} className="text-center text-[11px] font-bold text-slate-400 uppercase py-1">
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <CalendarGrid
                year={calYear}
                month={calMonth}
                items={autoBlogItems}
                onEditItem={onEditItem}
                onGenerate={handleGenerate}
                generating={generating}
                brands={brands}
              />
            </div>
          </div>

          {/* Unscheduled items (no date yet) */}
          {autoBlogItems.filter((i) => !i.scheduledPublishAt).length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                Unscheduled ({autoBlogItems.filter((i) => !i.scheduledPublishAt).length})
              </h3>
              <div className="space-y-2">
                {autoBlogItems.filter((i) => !i.scheduledPublishAt).map((item) => {
                  const isGen = generating.has(item.id);
                  return (
                    <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${statusColors[item.status] || 'bg-slate-100 text-slate-600'}`}>
                        {item.status.replace('_', ' ')}
                      </span>
                      <span className="flex-1 text-sm text-slate-800 truncate font-medium">{item.title}</span>
                      {item.primaryKeyword && (
                        <span className="text-[11px] text-slate-400 hidden md:block">🔑 {item.primaryKeyword}</span>
                      )}
                      {item.status === 'Planned' && (
                        <button
                          onClick={() => handleGenerate(item)}
                          disabled={isGen}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
                        >
                          {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          Write Article
                        </button>
                      )}
                      <button
                        onClick={() => {
                          // Schedule for next available slot
                          const today = new Date();
                          const nextDate = new Date(today);
                          nextDate.setDate(nextDate.getDate() + 1);
                          nextDate.setHours(9, 0, 0, 0);
                          handleSchedule(item, nextDate.toISOString().split('T')[0], '09:00');
                        }}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition"
                      >
                        <Calendar className="w-3 h-3 inline mr-1" />
                        Schedule
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── QUEUE VIEW ─────────────────────────────────────────────── */}
      {view === 'queue' && (
        <div className="space-y-4">
          {/* Quick actions bar */}
          {autoBlogItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleScheduleAll}
                className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
              >
                <CalendarClock className="w-4 h-4" />
                Auto-Schedule All Drafts
              </button>
              <button
                onClick={() => setView('settings')}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition flex items-center gap-1.5"
              >
                <Settings2 className="w-4 h-4" />
                Sheet Settings
              </button>
            </div>
          )}

          {/* Empty state */}
          {autoBlogItems.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
              <div className="w-16 h-16 bg-violet-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
                <CalendarClock className="w-8 h-8 text-violet-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">No AutoBlog posts yet</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                Connect a Google Sheet to import blog topics, then generate and schedule them for automatic publishing.
              </p>
              <button
                onClick={() => setView('settings')}
                className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition inline-flex items-center gap-2"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Connect Google Sheet
              </button>
            </div>
          )}

          {/* Items list */}
          {autoBlogItems.map((item) => {
            const isExpanded = expandedItem === item.id;
            const isGenerating = generating.has(item.id);
            const isPublishing = publishing.has(item.id);
            const brand = brands.find((b) => b.id === item.brandId);
            const isScheduled = !!item.scheduledPublishAt;
            const isPast = isScheduled && new Date(item.scheduledPublishAt!) < new Date();

            return (
              <div
                key={item.id}
                className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition ${
                  isPast ? 'border-amber-300 bg-amber-50/30' : isScheduled ? 'border-violet-200' : 'border-slate-200'
                }`}
              >
                {/* Main row */}
                <div className="flex items-center gap-4 p-4">
                  {/* Status badge */}
                  <div className="shrink-0">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${statusColors[item.status] || 'bg-slate-100 text-slate-600'}`}>
                      {item.status === 'Generating' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      {item.status.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-900 truncate">{item.title}</div>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                      {item.primaryKeyword && <span>🔑 {item.primaryKeyword}</span>}
                      {brand && <span>🏷️ {brand.name}</span>}
                      {item.scheduledPublishAt && (
                        <span className={`flex items-center gap-1 ${isPast ? 'text-amber-600 font-bold' : 'text-violet-600'}`}>
                          <Clock className="w-3 h-3" />
                          {formatDate(item.scheduledPublishAt)} {formatTime(item.scheduledPublishAt)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {item.status === 'Planned' && (
                      <button
                        onClick={() => handleGenerate(item)}
                        disabled={isGenerating}
                        className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
                      >
                        {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        Generate
                      </button>
                    )}

                    {item.status === 'Draft_Ready' && !isScheduled && (
                      <button
                        onClick={() => handleSchedule(item, startDate, '09:00')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                      >
                        <Calendar className="w-3 h-3" />
                        Schedule
                      </button>
                    )}

                    <button
                      onClick={() => onEditItem(item)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                      title="Edit in editor"
                    >
                      <Eye className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50/50 space-y-3">
                    {/* Keywords */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="font-medium text-slate-500">Primary Keyword</span>
                        <p className="text-slate-900 mt-0.5">{item.primaryKeyword || '—'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">Secondary Keywords</span>
                        <p className="text-slate-900 mt-0.5">{item.secondaryKeywords?.join(', ') || '—'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">SEO Brief</span>
                        <p className="text-slate-900 mt-0.5 line-clamp-2">{item.seoBrief || '—'}</p>
                      </div>
                      <div>
                        <span className="font-medium text-slate-500">Source</span>
                        <p className="text-slate-900 mt-0.5">{item.sourceSheetName || '—'} Row {item.sourceRow || '—'}</p>
                      </div>
                    </div>

                    {/* Schedule controls */}
                    {item.status === 'Draft_Ready' && (
                      <div className="flex items-end gap-3 pt-2 border-t border-slate-200">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Publish Date</label>
                          <input
                            type="date"
                            defaultValue={item.scheduledPublishAt ? new Date(item.scheduledPublishAt).toISOString().split('T')[0] : startDate}
                            onChange={(e) => {
                              if (e.target.value) {
                                const time = item.scheduledPublishAt
                                  ? new Date(item.scheduledPublishAt).toTimeString().slice(0, 5)
                                  : '09:00';
                                handleSchedule(item, e.target.value, time);
                              }
                            }}
                            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Time</label>
                          <input
                            type="time"
                            defaultValue={item.scheduledPublishAt ? new Date(item.scheduledPublishAt).toTimeString().slice(0, 5) : '09:00'}
                            onChange={(e) => {
                              const date = item.scheduledPublishAt
                                ? new Date(item.scheduledPublishAt).toISOString().split('T')[0]
                                : startDate;
                              if (e.target.value) handleSchedule(item, date, e.target.value);
                            }}
                            className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                          />
                        </div>
                        {isScheduled && (
                          <button
                            onClick={() => handleUnschedule(item)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition"
                          >
                            Clear Schedule
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(item)}
                          className="ml-auto px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </div>
                    )}

                    {/* Last publish status */}
                    {item.lastAutoPublishedAt && (
                      <div className="text-xs text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Last published: {formatDate(item.lastAutoPublishedAt)} {formatTime(item.lastAutoPublishedAt)}
                      </div>
                    )}
                    {item.lastAutoPublishError && (
                      <div className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        Publish error: {item.lastAutoPublishError}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Timeline preview */}
          {scheduledItems.length > 1 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 text-sm mb-4 flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-violet-500" />
                Publishing Timeline
              </h3>
              <div className="space-y-2">
                {scheduledItems.map((item, i) => (
                  <div key={item.id} className="flex items-center gap-3 text-sm">
                    <div className="w-16 text-right text-xs text-slate-400 shrink-0">
                      {formatDate(item.scheduledPublishAt)}
                    </div>
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      item.status === 'Published' ? 'bg-emerald-500' : item.status === 'Draft_Ready' ? 'bg-violet-500' : 'bg-slate-300'
                    }`} />
                    <div className="flex-1 truncate text-slate-700 text-xs">{item.title}</div>
                    <div className="text-[10px] text-slate-400 shrink-0">{item.status.replace('_', ' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
