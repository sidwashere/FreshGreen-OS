import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ContentItem, Brand, AutoBlogOverrides } from '../types';
import { GenerationInfoPanel } from './GenerationInfoPanel';
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
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[]; sheetContext?: any; seoBrief?: string; initialPrompt?: string; sourceSheetId?: string }
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
  onScheduleItem: (item: ContentItem, date: string, time: string) => void;
  generating: Set<string>;
  brands: Brand[];
}

// green = published, orange = scheduled, red = draft/planned
const calStatusColor = (item: ContentItem) => {
  if (item.status === 'Published') return { bg: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500', text: 'text-emerald-800' };
  if (item.scheduledPublishAt) return { bg: 'bg-orange-50 border-orange-200', dot: 'bg-orange-500', text: 'text-orange-800' };
  return { bg: 'bg-red-50 border-red-200', dot: 'bg-red-400', text: 'text-red-800' };
};

const CalendarGrid: React.FC<CalendarGridProps> = ({
  year, month, items, onEditItem, onGenerate, onScheduleItem, generating, brands,
}) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

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

  // Unscheduled items — shown below calendar
  const unscheduledItems = useMemo(() => items.filter((i) => !i.scheduledPublishAt), [items]);

  const cells: { day: number | null; key: string }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ day: null, key: `empty-${i}` });
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, key });
  }
  // Pad trailing cells to complete the last row
  while (cells.length % 7 !== 0) cells.push({ day: null, key: `end-${cells.length}` });

  return (
    <div className="space-y-4">
    <div className="grid grid-cols-7 gap-1">
      {cells.map((cell, cellIdx) => {
        if (!cell.day) {
          return <div key={cell.key} className="min-h-[90px] bg-slate-50/50 rounded-xl" />;
        }

        const isToday = cell.key === todayStr;
        const dayItems = itemsByDate[cell.key] || [];
        const isWeekend = (cellIdx % 7) >= 5;
        const isExpanded = expandedDays.has(cell.key);
        const visibleItems = isExpanded ? dayItems : dayItems.slice(0, 4);

        return (
          <div
            key={cell.key}
            className={`min-h-[90px] rounded-xl border p-1.5 transition ${
              isToday
                ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200'
                : isWeekend
                  ? 'border-slate-100 bg-slate-50/30'
                  : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className={`text-[11px] font-bold mb-1 ${isToday ? 'text-violet-600' : 'text-slate-500'}`}>
              {cell.day}
            </div>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const colors = calStatusColor(item);
                const isGen = generating.has(item.id);
                return (
                  <div
                    key={item.id}
                    onClick={() => onEditItem(item)}
                    className={`group relative rounded-md px-1.5 py-0.5 cursor-pointer transition border ${colors.bg}`}
                    title={`${item.title} — ${item.status.replace('_', ' ')}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
                      <span className={`text-[9px] font-semibold truncate leading-tight ${colors.text}`}>
                        {item.title}
                      </span>
                    </div>
                    {item.status === 'Planned' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onGenerate(item); }}
                        disabled={isGen}
                        className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-sm disabled:opacity-50"
                        title="Write Article"
                      >
                        {isGen ? <Loader2 className="w-2 h-2 animate-spin" /> : <Sparkles className="w-2 h-2" />}
                      </button>
                    )}
                  </div>
                );
              })}
              {dayItems.length > 4 && (
                <button
                  onClick={() => setExpandedDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(cell.key)) next.delete(cell.key);
                    else next.add(cell.key);
                    return next;
                  })}
                  className="w-full text-[8px] text-violet-500 font-semibold hover:text-violet-700 transition cursor-pointer"
                >
                  {isExpanded ? 'Show less' : `+${dayItems.length - 4} more`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>

    {/* Unscheduled items — inline date picker to place on calendar */}
    {unscheduledItems.length > 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" />
          Unscheduled ({unscheduledItems.length})
          <span className="text-[11px] font-normal text-slate-400 ml-1">— set a publish date to place on calendar</span>
        </h3>
        <div className="space-y-1.5">
          {unscheduledItems.map((item) => {
            const isGen = generating.has(item.id);
            const colors = calStatusColor(item);
            return (
              <div key={item.id} className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-100">
                <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
                <span className={`flex-1 text-sm font-medium truncate ${colors.text}`}>{item.title}</span>
                {item.primaryKeyword && (
                  <span className="text-[10px] text-slate-400 hidden md:block">🔑 {item.primaryKeyword}</span>
                )}
                <input
                  type="date"
                  className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                  defaultValue={new Date().toISOString().split('T')[0]}
                  onChange={(e) => {
                    if (e.target.value) onScheduleItem(item, e.target.value, '09:00');
                  }}
                />
                {item.status === 'Planned' && (
                  <button
                    onClick={() => onGenerate(item)}
                    disabled={isGen}
                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
                  >
                    {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    )}
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
  // Sheet URL is per-brand to prevent cross-brand leakage
  const sheetUrlKey = `fgos_autoblog_sheet_url_${selectedBrandId || 'none'}`;
  const [sheetUrl, setSheetUrl] = useState(() => {
    try { return localStorage.getItem(sheetUrlKey) || ''; } catch { return ''; }
  });
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>('');
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Connection health ──────────────────────────────────────────────
  const [connStatus, setConnStatus] = useState<{ ok: boolean; message: string; latencyMs?: number; lastChecked?: number } | null>(null);
  const [pinging, setPinging] = useState(false);

  // ── When brand changes, reload the sheet URL + clear stale state ───
  useEffect(() => {
    const newKey = `fgos_autoblog_sheet_url_${selectedBrandId || 'none'}`;
    const newUrl = localStorage.getItem(newKey) || '';
    setSheetUrl(newUrl);
    setTabs([]);
    setSelectedTab('');
    setSheetRows([]);
    setSheetHeaders([]);
    setSelectedRows(new Set());
    setConnStatus(null);
    setError(null);
  }, [selectedBrandId]);

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
  // Live generation info per item id (for the streaming status panel)
  const [genState, setGenState] = useState<Record<string, any>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const [resyncResult, setResyncResult] = useState<{ newRows: number; changedRows: number } | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const batchCancelRef = React.useRef(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ── Calendar state ────────────────────────────────────────────────
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());

  // Persist config to localStorage (sheet URL is per-brand)
  useEffect(() => {
    try {
      localStorage.setItem(sheetUrlKey, sheetUrl);
      localStorage.setItem('fgos_autoblog_cadence', String(cadenceDays));
      localStorage.setItem('fgos_autoblog_start_date', startDate);
      localStorage.setItem('fgos_autoblog_auto_publish', autoPublish ? '1' : '0');
    } catch { /* ignore */ }
  }, [sheetUrl, sheetUrlKey, cadenceDays, startDate, autoPublish]);

  // ── Brand-scoped items: ONLY items belonging to the selected brand ─
  const brandItems = useMemo(
    () => selectedBrandId ? items.filter((i) => i.brandId === selectedBrandId) : items,
    [items, selectedBrandId]
  );

  // ── AutoBlog items (imported from sheet, brand-scoped) ─────────────
  const autoBlogItems = useMemo(
    () => brandItems.filter((i) => i.sourceSheetId || i.scheduledPublishAt),
    [brandItems]
  );

  const scheduledItems = useMemo(
    () =>
      autoBlogItems
        .filter((i) => i.scheduledPublishAt)
        .sort((a, b) => new Date(a.scheduledPublishAt!).getTime() - new Date(b.scheduledPublishAt!).getTime()),
    [autoBlogItems]
  );

  // ── Auto-publish check (runs every 60s when enabled) ───────────────
  useEffect(() => {
    if (!autoPublish) return;
    const interval = setInterval(async () => {
      const now = new Date();
      const dueItems = brandItems.filter(
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
          body: JSON.stringify({ dueItems, brands: brands.filter((b) => b.id === selectedBrandId) }),
        });
        const data = await resp.json();
        // Record results (both success and failure) for every item
        for (const r of data.results || []) {
          const item = dueItems.find((i) => i.id === r.itemId);
          if (!item) continue;
          if (r.success) {
            onSaveItem({
              ...item,
              status: 'Published',
              wpPostId: r.wpPostId,
              lastAutoPublishedAt: new Date().toISOString(),
              lastAutoPublishError: undefined,
              updatedAt: new Date().toISOString(),
            });
          } else {
            onSaveItem({
              ...item,
              status: 'Error',
              lastAutoPublishError: r.message || 'Publish failed',
              updatedAt: new Date().toISOString(),
            });
          }
        }
        if (data.published > 0) {
          setNotice({ kind: 'ok', text: `Auto-published ${data.published} post(s)` });
        }
        const errCount = data.errors?.length || 0;
        if (errCount > 0) {
          setNotice({ kind: 'err', text: `${errCount} post(s) failed to publish — check queue for details` });
        }
      } catch {
        // Silently retry next interval
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [autoPublish, brandItems, brands, selectedBrandId, onSaveItem]);

  // ── Sheet actions ──────────────────────────────────────────────────
  // AbortController for cancelling in-flight sheet fetches when switching tabs
  const sheetFetchRef = React.useRef<AbortController | null>(null);

  const handleFetchSheet = async () => {
    if (!sheetUrl.trim()) { setError('Enter a Google Sheet URL'); return; }
    // Cancel any in-flight request
    sheetFetchRef.current?.abort();
    const controller = new AbortController();
    sheetFetchRef.current = controller;

    setLoading(true); setError(null); setSheetRows([]); setTabs([]);
    try {
      // Step 1: Discover all tabs with real names
      const tabResp = await fetch('/api/autoblog/list-tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl }),
        signal: controller.signal,
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
        signal: controller.signal,
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSheetRows(data.rows || []);
      setSheetHeaders(data.headers || []);
      setSelectedRows(new Set());
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // Swallowed — new request superseded this one
      setError(err.message || 'Failed to fetch sheet');
    } finally {
      setLoading(false);
    }
  };

  const handleFetchTab = async (gid: string) => {
    if (!sheetUrl.trim()) return;
    // Cancel any in-flight request
    sheetFetchRef.current?.abort();
    const controller = new AbortController();
    sheetFetchRef.current = controller;

    setLoading(true); setError(null);
    const prevRows = sheetRows; // keep previous rows in case fetch fails
    const prevHeaders = sheetHeaders;
    try {
      setSelectedTab(gid);
      const resp = await fetch('/api/autoblog/fetch-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl, gid }),
        signal: controller.signal,
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setSheetRows(data.rows || []);
      setSheetHeaders(data.headers || []);
      setSelectedRows(new Set());
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // On failure, restore previous data so the UI doesn't go blank
      setSheetRows(prevRows);
      setSheetHeaders(prevHeaders);
      setError(err.message || 'Failed to fetch tab — showing previous tab data');
    } finally {
      setLoading(false);
    }
  };

  // ── Connection health ping ──────────────────────────────────────────
  const handlePing = async () => {
    if (!sheetUrl.trim()) return;
    setPinging(true);
    try {
      const resp = await fetch('/api/autoblog/ping-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheetUrl }),
      });
      const data = await resp.json();
      setConnStatus({ ...data, lastChecked: Date.now() });
    } catch (err: any) {
      setConnStatus({ ok: false, message: 'Network error — server may be offline', lastChecked: Date.now() });
    } finally {
      setPinging(false);
    }
  };

  // Auto-ping on mount if sheet URL is saved, and re-ping every 5 minutes
  useEffect(() => {
    if (sheetUrl.trim()) handlePing();
    const interval = setInterval(() => { if (sheetUrl.trim()) handlePing(); }, 5 * 60_000);
    return () => clearInterval(interval);
  }, [sheetUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load sheet tabs on mount if a sheet URL is already saved, so the
  // preview + row checklist are ready without re-clicking Connect.
  const autoLoadedRef = React.useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (sheetUrl.trim() && tabs.length === 0 && !loading) {
      autoLoadedRef.current = true;
      handleFetchSheet();
    }
  }, [sheetUrl, tabs.length, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-retry: if connection was lost, attempt recovery every 30s ──
  useEffect(() => {
    if (!sheetUrl.trim()) return;
    const interval = setInterval(() => {
      if (connStatus && !connStatus.ok && !loading) {
        console.log('[FGOS] Auto-retrying sheet connection…');
        handlePing().then(() => {
          if (tabs.length > 0 && selectedTab) {
            // We had data before — try to re-fetch the selected tab
            handleFetchTab(selectedTab);
          }
        });
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [sheetUrl, connStatus, loading, tabs.length, selectedTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImportRows = async () => {
    if (sheetRows.length === 0) return;
    // Import only the user-selected rows (fall back to all rows if none selected)
    const rowsToImport = selectedRows.size > 0
      ? sheetRows.filter((_, idx) => selectedRows.has(idx))
      : sheetRows;
    if (rowsToImport.length === 0) return;
    setImporting(true); setError(null); setImportProgress({ done: 0, total: 0 });
    try {
      const resp = await fetch('/api/autoblog/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: rowsToImport,
          brandId: selectedBrandId,
          sheetId: sheetUrl,
          sheetName: tabs.find((t) => t.gid === selectedTab)?.name || 'Sheet1',
          existingItems: autoBlogItems.map((i) => ({ title: i.title })),
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      // Create content items from imported rows — show progress
      const startDateMs = new Date(startDate).getTime();
      const totalCount = data.imported.length;
      setImportProgress({ done: 0, total: totalCount });
      let createdCount = 0;
      for (let i = 0; i < data.imported.length; i++) {
        const row = data.imported[i];

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
            sourceSheetId: sheetUrl,
          }
        );

        createdCount++;
        setImportProgress({ done: createdCount, total: totalCount });
      }

      setNotice({
        kind: 'ok',
        text: `Imported ${createdCount} post(s) • ${data.skipped.length} skipped (duplicates/empty)`,
      });
      // Clear the selection after a successful import
      setSelectedRows(new Set());
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  // ── Re-sync: detect new/changed rows from the sheet ─────────────
  const handleResync = async () => {
    if (sheetRows.length === 0) return;
    setResyncing(true); setResyncResult(null); setError(null);
    try {
      const resp = await fetch('/api/autoblog/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows: sheetRows,
          existingItems: autoBlogItems.map((i) => ({ title: i.title, seoBrief: i.seoBrief, primaryKeyword: i.primaryKeyword })),
        }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setResyncResult({ newRows: data.newRows?.length || 0, changedRows: data.changedRows?.length || 0 });

      // Import new rows only
      if (data.newRows && data.newRows.length > 0) {
        const startDateMs = new Date(startDate).getTime();
        const startOffset = autoBlogItems.length; // continue after existing items
        let createdCount = 0;
        setImportProgress({ done: 0, total: data.newRows.length });
        for (let i = 0; i < data.newRows.length; i++) {
          const row = data.newRows[i];
          await onCreateNewItem(
            row['Blog Title'] || row['Title'] || 'Untitled',
            selectedBrandId,
            'post',
            {
              primaryKeyword: row['Primary Keyword'] || '',
              secondaryKeywords: (row['Secondary Keywords'] || '').split(/[,;|]/).map((s: string) => s.trim()).filter(Boolean),
              seoBrief: row['Search Intent'] || row['One Line Summary'] || '',
              initialPrompt: row['One Line Summary'] || row['Blog Title'] || '',
              sheetContext: row,
              sourceSheetId: sheetUrl,
            }
          );
          createdCount++;
          setImportProgress({ done: createdCount, total: data.newRows.length });
        }
        setNotice({ kind: 'ok', text: `Re-synced: ${createdCount} new post(s) imported, ${data.changedRows?.length || 0} existing row(s) with changes detected` });
      } else {
        setNotice({ kind: 'ok', text: `Sheet is up to date — no new rows. ${data.changedRows?.length || 0} existing row(s) may have changes.` });
      }
    } catch (err: any) {
      setError(err.message || 'Re-sync failed');
    } finally {
      setResyncing(false);
      setImportProgress(null);
    }
  };

  // ── Generate content for a single item ─────────────────────────────
  const handleGenerate = async (item: ContentItem) => {
    setGenerating((prev) => new Set(prev).add(item.id));
    // Auto-expand so the live status panel is visible
    setExpandedItem(item.id);
    // Reset live generation state for this item
    setGenState((prev) => ({
      ...prev,
      [item.id]: { phase: 'Connecting to the model…', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] },
    }));
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

      // Step 2: Generate article via streaming endpoint (NDJSON)
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

      if (!genResp.body) throw new Error('No response body');

      const reader = genResp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamedText = '';
      let completed = false;
      let streamError: string | null = null;
      let genData: any = null;

      const patch = (fn: (prev: any) => any) => {
        setGenState((prev) => ({ ...prev, [item.id]: fn(prev[item.id] || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] }) }));
      };

      const handleEvent = (evt: any) => {
        if (evt.type === 'generationInfo') {
          patch((prev) => ({ ...prev, generationInfo: evt, history: prev.history || [] }));
        } else if (evt.type === 'status') {
          patch((prev) => ({
            ...prev,
            phase: evt.message || evt.phase || '',
            percent: evt.percent ?? prev.percent,
            stalled: false,
            history: [...(prev.history || []), { message: evt.message || '', percent: evt.percent ?? prev.percent, at: Date.now() }],
          }));
        } else if (evt.type === 'stream') {
          streamedText += evt.text || '';
          patch((prev) => ({
            ...prev,
            phase: evt.phase || prev.phase || 'Writing…',
            percent: evt.percent ?? prev.percent,
            words: evt.words ?? streamedText.split(/\s+/).filter(Boolean).length,
            text: streamedText,
            stalled: false,
            history: evt.phase ? [...(prev.history || []), { message: evt.phase, percent: evt.percent ?? prev.percent, at: Date.now() }] : prev.history,
          }));
        } else if (evt.type === 'heartbeat') {
          patch((prev) => ({ ...prev, elapsed: evt.elapsed ?? prev.elapsed, stalled: false }));
        } else if (evt.type === 'image') {
          patch((prev) => ({ ...prev, phase: evt.role === 'hero' ? 'Hero image ready…' : 'Both images ready.', percent: evt.role === 'hero' ? 90 : 92, stalled: false }));
        } else if (evt.type === 'error') {
          streamError = evt.error || 'Generation failed.';
        } else if (evt.type === 'done') {
          completed = true;
          genData = evt.data || {};
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try { handleEvent(JSON.parse(line)); } catch { /* skip malformed */ }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!completed || !genData) throw new Error('Generation ended without completing.');

      let bodyHtml = genData.articleHtml || genData.bodyHtml || item.bodyHtml;
      let blocks = genData.blocks || item.blocks;

      // Step 3: Auto-humanise the draft (only when the setting is enabled)
      if (autoHumanize && bodyHtml) {
        patch((prev) => ({
          ...prev,
          phase: 'Humanising the draft…',
          percent: 97,
          stalled: false,
          history: [...(prev.history || []), { message: 'Humanising the draft…', percent: 97, at: Date.now() }],
        }));
        try {
          const hResp = await fetch('/api/ai/humanize-draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              html: bodyHtml,
              brand: brands.find((b) => b.id === item.brandId),
              byokKeys: JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}'),
            }),
          });
          const hData = await hResp.json();
          if (hData.success && hData.humanized && hData.changed) {
            bodyHtml = hData.humanized;
            if (hData.blocks && hData.blocks.length) blocks = hData.blocks;
            patch((prev) => ({
              ...prev,
              phase: 'Draft humanised.',
              percent: 98,
              stalled: false,
              history: [...(prev.history || []), { message: 'Draft humanised.', percent: 98, at: Date.now() }],
            }));
          } else if (hData.success) {
            patch((prev) => ({
              ...prev,
              phase: 'Humaniser made no changes.',
              percent: 98,
              stalled: false,
              history: [...(prev.history || []), { message: 'Humaniser made no changes.', percent: 98, at: Date.now() }],
            }));
          } else {
            patch((prev) => ({
              ...prev,
              phase: 'Humanisation skipped (no change).',
              percent: 98,
              stalled: false,
              history: [...(prev.history || []), { message: 'Humanisation skipped.', percent: 98, at: Date.now() }],
            }));
          }
        } catch (hErr: any) {
          // Humanisation is best-effort — don't fail the whole generation if it errors
          patch((prev) => ({
            ...prev,
            phase: 'Humanisation failed — keeping raw draft.',
            percent: 98,
            stalled: false,
            history: [...(prev.history || []), { message: 'Humanisation failed — keeping raw draft.', percent: 98, at: Date.now() }],
          }));
        }
      }

      // Update the item with generated content
      const updatedItem: ContentItem = {
        ...item,
        bodyHtml,
        blocks,
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
      setNotice({ kind: 'ok', text: autoHumanize ? `Generated & humanised: "${item.title}"` : `Generated: "${item.title}"` });
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Generation failed: ${err.message}` });
    } finally {
      setGenerating((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      // Keep the final genState briefly so the panel can show completion, then clear
      setTimeout(() => {
        setGenState((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      }, 3000);
    }
  };

  // ── Schedule a single item ─────────────────────────────────────────
  const handleSchedule = (item: ContentItem, date: string, time: string) => {
    const dt = new Date(`${date}T${time || '09:00'}:00`);
    if (isNaN(dt.getTime())) { setNotice({ kind: 'err', text: 'Invalid date/time' }); return; }
    // ENFORCE the schedule: never allow scheduling in the past — otherwise the
    // auto-publish interval would fire immediately and the post goes live early.
    if (dt.getTime() <= Date.now()) {
      setNotice({ kind: 'err', text: `Cannot schedule "${item.title}" in the past — pick a future date/time.` });
      return;
    }
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
    // Parse the start date as LOCAL midnight (not UTC) so the first post lands on
    // the intended calendar day regardless of timezone.
    const startDateMs = new Date(`${startDate}T00:00:00`).getTime();
    if (isNaN(startDateMs)) { setNotice({ kind: 'err', text: 'Invalid start date' }); return; }
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

  // ── Publish now (manual push to WordPress) ────────────────────────
  const handlePublishNow = async (item: ContentItem) => {
    const brand = brands.find((b) => b.id === item.brandId);
    if (!brand?.wpUrl || !brand?.wpUsername) {
      setNotice({ kind: 'err', text: `"${item.title}" — brand has no WordPress credentials configured. Go to Settings → Brand DNA to add them.` });
      return;
    }
    setPublishing((prev) => new Set(prev).add(item.id));
    try {
      const resp = await fetch('/api/autoblog/check-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dueItems: [{ ...item, scheduledPublishAt: new Date().toISOString() }],
          brands: [brand],
        }),
      });
      const data = await resp.json();
      const result = data.results?.[0];
      if (result?.success) {
        onSaveItem({
          ...item,
          status: 'Published',
          wpPostId: result.wpPostId,
          lastAutoPublishedAt: new Date().toISOString(),
          lastAutoPublishError: undefined,
          updatedAt: new Date().toISOString(),
        });
        setNotice({ kind: 'ok', text: `Published "${item.title}" to WordPress` });
      } else {
        onSaveItem({
          ...item,
          status: 'Error',
          lastAutoPublishError: result?.message || 'Publish failed',
          updatedAt: new Date().toISOString(),
        });
        setNotice({ kind: 'err', text: `Publish failed: ${result?.message || 'Unknown error'}` });
      }
    } catch (err: any) {
      setNotice({ kind: 'err', text: `Publish error: ${err.message}` });
    } finally {
      setPublishing((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // ── Delete item ────────────────────────────────────────────────────
  const handleDelete = async (item: ContentItem) => {
    await onDeleteItem(item);
    setNotice({ kind: 'ok', text: `Deleted "${item.title}"` });
  };

  // ── Batch generate all Planned items (with cancel) ────────────────
  const handleGenerateAll = async () => {
    const planned = autoBlogItems.filter((i) => i.status === 'Planned');
    if (planned.length === 0) return;
    batchCancelRef.current = false;
    setBatchGenerating(true);
    setNotice({ kind: 'ok', text: `Generating ${planned.length} articles sequentially — click Stop to cancel…` });
    let done = 0;
    for (const item of planned) {
      if (batchCancelRef.current) {
        setNotice({ kind: 'ok', text: `Stopped after ${done} / ${planned.length} articles` });
        break;
      }
      await handleGenerate(item);
      done++;
    }
    if (!batchCancelRef.current) {
      setNotice({ kind: 'ok', text: `All done — ${done} articles generated` });
    }
    setBatchGenerating(false);
  };

  const handleCancelBatch = () => {
    batchCancelRef.current = true;
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

  // Local-time helpers for the date/time inputs — keeps the displayed value in
  // the user's own timezone so the stored schedule matches what they see.
  const localDateInput = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const localTimeInput = (iso?: string) => {
    if (!iso) return '09:00';
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
              {/* Connection health indicator */}
              {connStatus && (
                <div className={`mt-2 flex items-center gap-2 text-xs px-3 py-2 rounded-xl border ${
                  connStatus.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${connStatus.ok ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
                  <span className="flex-1">{connStatus.message}</span>
                  {connStatus.latencyMs != null && (
                    <span className="text-[10px] opacity-60">{connStatus.latencyMs}ms</span>
                  )}
                  <button
                    onClick={handlePing}
                    disabled={pinging}
                    className="px-2 py-0.5 rounded-lg bg-white border border-current/10 text-[10px] font-semibold hover:opacity-80 transition disabled:opacity-50"
                    title="Test connection now"
                  >
                    {pinging ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Test'}
                  </button>
                </div>
              )}
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
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {tabs.find((t) => t.gid === selectedTab)?.name || 'Sheet'} — {sheetRows.length} rows
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Columns: {sheetHeaders.join(' · ')}
                    </p>
                  </div>
                  {/* Row selection controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-violet-700 bg-violet-100 px-2 py-1 rounded-lg">
                      {selectedRows.size} selected
                    </span>
                    <button
                      onClick={() => setSelectedRows(new Set(sheetRows.map((_, i) => i)))}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedRows(new Set())}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                {/* Preview table — all rows, scrollable */}
                <div className="overflow-auto max-h-[420px] border border-slate-200 rounded-lg">
                  <table className="w-full text-[11px] border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-2 py-1.5 bg-slate-100 text-slate-600 font-bold border-b border-slate-200 w-8">
                          <input
                            type="checkbox"
                            checked={selectedRows.size === sheetRows.length && sheetRows.length > 0}
                            onChange={(e) => setSelectedRows(e.target.checked ? new Set(sheetRows.map((_, i) => i)) : new Set())}
                            className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                            title="Select all rows"
                          />
                        </th>
                        {sheetHeaders.map((h) => (
                          <th key={h} className="text-left px-2 py-1.5 bg-slate-100 text-slate-600 font-bold border-b border-slate-200 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetRows.map((row, i) => {
                        const title = row['Blog Title'] || row['Title'] || row['Headline'] || '';
                        const alreadyImported = autoBlogItems.some((it) => it.title === title);
                        const rowStatus = row['Status'] || '';
                        const isSelected = selectedRows.has(i);
                        return (
                          <tr
                            key={i}
                            onClick={() => {
                              const next = new Set(selectedRows);
                              if (next.has(i)) next.delete(i); else next.add(i);
                              setSelectedRows(next);
                            }}
                            className={`border-b border-slate-100 cursor-pointer transition ${
                              isSelected ? 'bg-violet-50' : 'hover:bg-slate-50'
                            } ${alreadyImported ? 'opacity-60' : ''}`}
                          >
                            <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {
                                  const next = new Set(selectedRows);
                                  if (next.has(i)) next.delete(i); else next.add(i);
                                  setSelectedRows(next);
                                }}
                                className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                              />
                            </td>
                            {sheetHeaders.map((h) => {
                              const val = row[h] || '';
                              // Highlight the title column
                              if (h === 'Blog Title' || h === 'Title' || h === 'Headline') {
                                return (
                                  <td key={h} className="px-2 py-1.5 text-slate-900 font-semibold max-w-[220px]">
                                    <span className="line-clamp-2">{val || '—'}</span>
                                    {alreadyImported && (
                                      <span className="block text-[9px] font-bold text-amber-600 mt-0.5">Already imported</span>
                                    )}
                                  </td>
                                );
                              }
                              // Status column gets a badge
                              if (h === 'Status' && val) {
                                const st = val.toLowerCase();
                                const stColor = st.includes('publish') || st.includes('live')
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : st.includes('plan') || st.includes('draft')
                                    ? 'bg-slate-100 text-slate-600'
                                    : 'bg-violet-100 text-violet-700';
                                return (
                                  <td key={h} className="px-2 py-1.5">
                                    <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stColor}`}>{val}</span>
                                  </td>
                                );
                              }
                              return (
                                <td key={h} className="px-2 py-1.5 text-slate-700 max-w-[200px]">
                                  <span className="line-clamp-2">{val || '—'}</span>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-400 text-center">
                  Showing all {sheetRows.length} rows — tick the rows you want to import, or use Select All.
                </p>
                <button
                  onClick={handleImportRows}
                  disabled={importing}
                  className="w-full px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {importing && importProgress
                    ? `Importing ${importProgress.done} / ${importProgress.total}…`
                    : selectedRows.size > 0
                      ? `Import ${selectedRows.size} Selected Row${selectedRows.size > 1 ? 's' : ''} as Planned Posts`
                      : `Import All ${sheetRows.length} Rows as Planned Posts`
                  }
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
              {autoPublish && (
                <div className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Auto-publish runs every 60 seconds <strong>while this browser tab is open</strong>.
                    If you close the tab, scheduled posts won't publish until you return.
                    For fully automated publishing, set up a server-side cron job targeting <code className="bg-amber-100 px-1 rounded">/api/autoblog/check-publish</code>.
                  </span>
                </div>
              )}
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
                items={brandItems}
                onEditItem={onEditItem}
                onGenerate={handleGenerate}
                onScheduleItem={handleSchedule}
                generating={generating}
                brands={brands}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── QUEUE VIEW ─────────────────────────────────────────────── */}
      {view === 'queue' && (
        <div className="space-y-4">
          {/* Quick actions bar */}
          {autoBlogItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {batchGenerating ? (
                <button
                  onClick={handleCancelBatch}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
                >
                  <Pause className="w-4 h-4" />
                  Stop Generation
                </button>
              ) : autoBlogItems.some((i) => i.status === 'Planned') && (
                <button
                  onClick={handleGenerateAll}
                  disabled={generating.size > 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  Generate All Planned ({autoBlogItems.filter((i) => i.status === 'Planned').length})
                </button>
              )}
              {sheetUrl && sheetRows.length > 0 && (
                <button
                  onClick={handleResync}
                  disabled={resyncing}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {resyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Re-sync Sheet
                </button>
              )}
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
              {/* Live connection indicator */}
              {connStatus && (
                <button
                  onClick={handlePing}
                  disabled={pinging}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 border ${
                    connStatus.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 animate-pulse'
                  }`}
                  title={connStatus.message}
                >
                  <span className={`w-2 h-2 rounded-full ${connStatus.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  {pinging ? 'Checking…' : connStatus.ok ? 'Connected' : 'Reconnect'}
                </button>
              )}
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

                    {item.status !== 'Published' && item.status !== 'Generating' && !isScheduled && (
                      <button
                        onClick={() => handleSchedule(item, startDate, '09:00')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                      >
                        <Calendar className="w-3 h-3" />
                        Schedule
                      </button>
                    )}

                    {item.status === 'Draft_Ready' && (
                      <button
                        onClick={() => handlePublishNow(item)}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        Publish Now
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
                    {/* Live generation status panel (streaming) */}
                    {genState[item.id] && (
                      <GenerationInfoPanel
                        genState={genState[item.id]}
                        brandColor={brand?.primaryColor || '#7c3aed'}
                        targetWordCount={defaultWordCount}
                      />
                    )}

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

                    {/* Schedule controls — available at any stage except Published */}
                    {item.status !== 'Published' && item.status !== 'Generating' && (
                      <div className="flex items-end gap-3 pt-2 border-t border-slate-200">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Publish Date</label>
                          <input
                            type="date"
                            defaultValue={item.scheduledPublishAt ? localDateInput(item.scheduledPublishAt) : startDate}
                            onChange={(e) => {
                              if (e.target.value) {
                                const time = item.scheduledPublishAt
                                  ? localTimeInput(item.scheduledPublishAt)
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
                            defaultValue={item.scheduledPublishAt ? localTimeInput(item.scheduledPublishAt) : '09:00'}
                            onChange={(e) => {
                              const date = item.scheduledPublishAt
                                ? localDateInput(item.scheduledPublishAt)
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
                      item.status === 'Published' ? 'bg-emerald-500' : item.scheduledPublishAt ? 'bg-orange-400' : 'bg-red-400'
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
