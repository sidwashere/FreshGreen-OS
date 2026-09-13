import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { logActivity } from '../lib/activityLogger';
import { ContentItem, Brand, AutoBlogOverrides, SocialContentPackage, GenerationLogEntry } from '../types';
import { loadAutoblogConfig, saveAutoblogConfigLocal, fetchAutoblogConfigCloud, saveAutoblogConfigCloud, AutoblogConfig } from '../lib/autoblogConfig';
import { countWords } from '../lib/wpSync';
import { GenerationInfoPanel } from './GenerationInfoPanel';
import { BrandSwitcher } from './BrandSwitcher';
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
  Share2,
  Search,
} from 'lucide-react';

interface AutoBlogSchedulerProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
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
  onUnschedule: (item: ContentItem) => void;
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
  year, month, items, onEditItem, onGenerate, onScheduleItem, onUnschedule, generating, brands,
}) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  // Day selected for quick-placing unscheduled drafts (click a day cell).
  const [targetDay, setTargetDay] = useState<string | null>(null);

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

  // Month stats for the strip above the grid
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthItems = useMemo(
    () => Object.entries(itemsByDate).filter(([k]) => k.startsWith(monthPrefix)).flatMap(([, v]) => v),
    [itemsByDate, monthPrefix],
  );
  const monthScheduled = monthItems.length;
  const monthPublished = monthItems.filter((i) => i.status === 'Published').length;
  const monthDrafts = monthItems.filter((i) => i.status !== 'Published').length;

  // Tomorrow (local) — the earliest date that can be scheduled; the past-guard
  // in handleSchedule rejects today, so the date inputs must never default to it.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

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
    {/* Month stats strip */}
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1">
      <span className="text-xs font-bold text-slate-700">📅 {monthScheduled} scheduled</span>
      <span className="text-xs font-bold text-emerald-600">✅ {monthPublished} published</span>
      <span className="text-xs font-bold text-red-500">✍️ {monthDrafts} drafts</span>
      <span className="text-xs font-bold text-slate-400">🗓️ {unscheduledItems.length} unscheduled</span>
      <span className="ml-auto text-[11px] text-slate-400 hidden sm:block">Click a day to place unscheduled drafts on it</span>
    </div>

    <div className="grid grid-cols-7 gap-1">
      {cells.map((cell, cellIdx) => {
        if (!cell.day) {
          return <div key={cell.key} className="min-h-[90px] bg-slate-50/50 rounded-xl" />;
        }

        const isToday = cell.key === todayStr;
        const isTarget = cell.key === targetDay;
        const dayItems = itemsByDate[cell.key] || [];
        const isWeekend = (cellIdx % 7) >= 5;
        const isExpanded = expandedDays.has(cell.key);
        const visibleItems = isExpanded ? dayItems : dayItems.slice(0, 4);

        return (
          <div
            key={cell.key}
            onClick={() => setTargetDay(isTarget ? null : cell.key)}
            className={`min-h-[90px] rounded-xl border p-1.5 transition cursor-pointer ${
              isToday
                ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200'
                : isTarget
                  ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-300'
                  : isWeekend
                    ? 'border-slate-100 bg-slate-50/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
            title={isTarget ? 'Click again to deselect' : 'Click to place unscheduled drafts here'}
          >
            <div className={`text-[11px] font-bold mb-1 flex items-center justify-between ${isToday ? 'text-violet-600' : 'text-slate-500'}`}>
              <span>{cell.day}</span>
              {isTarget && <span className="text-[8px] font-bold text-violet-600 bg-violet-100 rounded px-1">PLACE</span>}
            </div>
            <div className="space-y-0.5">
              {visibleItems.map((item) => {
                const colors = calStatusColor(item);
                const isGen = generating.has(item.id);
                const itemTime = item.scheduledPublishAt
                  ? new Date(item.scheduledPublishAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <div
                    key={item.id}
                    onClick={(e) => { e.stopPropagation(); onEditItem(item); }}
                    className={`group relative rounded-md px-1.5 py-0.5 cursor-pointer transition border ${colors.bg}`}
                    title={`${item.title} — ${item.status.replace('_', ' ')}`}
                  >
                    <div className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
                      <span className={`text-[9px] font-semibold truncate leading-tight ${colors.text}`}>
                        {item.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {itemTime && <span className="text-[8px] text-slate-400 font-medium">{itemTime}</span>}
                      {item.status === 'Published' && item.wpPostId && (
                        <span className="text-[8px] text-emerald-500 font-bold">✓ WP</span>
                      )}
                      {item.socialContent?.status === 'ready' && (
                        <span className="text-[8px] text-violet-500 font-bold">📱</span>
                      )}
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
                    {item.scheduledPublishAt && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onUnschedule(item); }}
                        className="absolute -top-1 -left-1 w-3.5 h-3.5 bg-slate-600 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition shadow-sm text-[9px] leading-none"
                        title="Remove schedule"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              {dayItems.length > 4 && (
                <button
                  onClick={(e) => { e.stopPropagation(); setExpandedDays((prev) => {
                    const next = new Set(prev);
                    if (next.has(cell.key)) next.delete(cell.key);
                    else next.add(cell.key);
                    return next;
                  }); }}
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

    {/* Legend */}
    <div className="flex items-center gap-4 px-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Published</span>
      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500" /> Scheduled</span>
      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /> Draft / Planned</span>
      <span className="flex items-center gap-1.5 ml-auto"><span className="w-2 h-2 rounded-full bg-slate-600" /> × = remove schedule</span>
    </div>

    {/* Unscheduled items — inline date picker to place on calendar */}
    {unscheduledItems.length > 0 && (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-slate-400" />
          Unscheduled ({unscheduledItems.length})
          {targetDay ? (
            <span className="text-[11px] font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-lg px-2 py-0.5">
              Placing on {new Date(`${targetDay}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          ) : (
            <span className="text-[11px] font-normal text-slate-400 ml-1">— set a publish date, or click a day above to place drafts there</span>
          )}
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
                {targetDay ? (
                  <button
                    onClick={() => onScheduleItem(item, targetDay, '09:00')}
                    className="px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition shrink-0"
                  >
                    Place here →
                  </button>
                ) : (
                  <input
                    type="date"
                    min={tomorrowStr}
                    className="px-2 py-1 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                    defaultValue={tomorrowStr}
                    onChange={(e) => {
                      if (e.target.value) onScheduleItem(item, e.target.value, '09:00');
                    }}
                  />
                )}
                {item.status === 'Planned' && (
                  <button
                    onClick={() => onGenerate(item)}
                    disabled={isGen}
                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50 shrink-0"
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

// Social Media Package card — shown in the expanded item view. Tabs for
// Facebook / Instagram / Google Business, editable textareas with live word
// counts vs targets, per-platform Copy, Copy all (=== separators), Save edits,
// and Regenerate (re-runs the AI from the current article).
const SOCIAL_TARGETS: Record<'facebook' | 'instagram' | 'googleBusiness', number> = {
  facebook: 500,
  instagram: 150,
  googleBusiness: 90,
};
const SOCIAL_LABELS: Record<'facebook' | 'instagram' | 'googleBusiness', string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  googleBusiness: 'Google Business',
};

function SocialPackageCard({ item, brand, isRegenerating, onRegenerate, onSave }: {
  item: ContentItem;
  brand?: Brand;
  isRegenerating: boolean;
  onRegenerate: (item: ContentItem) => void;
  onSave: (item: ContentItem) => void;
}) {
  const social = item.socialContent;
  const [tab, setTab] = useState<'facebook' | 'instagram' | 'googleBusiness'>('facebook');
  const [draft, setDraft] = useState<{ facebook: string; instagram: string; googleBusiness: string }>({
    facebook: social?.facebook || '',
    instagram: social?.instagram || '',
    googleBusiness: social?.googleBusiness || '',
  });
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft({
      facebook: social?.facebook || '',
      instagram: social?.instagram || '',
      googleBusiness: social?.googleBusiness || '',
    });
  }, [social?.facebook, social?.instagram, social?.googleBusiness]);

  const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const target = SOCIAL_TARGETS[tab];
  const count = wordCount(draft[tab]);
  const withinTolerance = Math.abs(count - target) <= target * 0.2;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (non-secure context) — fall back to select-all.
      const ta = document.getElementById(`social-ta-${item.id}-${tab}`) as HTMLTextAreaElement | null;
      ta?.select();
    }
  };

  const copyAll = async () => {
    const all = `=== Facebook ===\n\n${draft.facebook}\n\n=== Instagram ===\n\n${draft.instagram}\n\n=== Google Business ===\n\n${draft.googleBusiness}`;
    await copy(all);
  };

  const saveEdits = () => {
    onSave({
      ...item,
      socialContent: {
        ...(social || {}),
        facebook: draft.facebook,
        instagram: draft.instagram,
        googleBusiness: draft.googleBusiness,
        status: 'ready',
        updatedAt: new Date().toISOString(),
      } as SocialContentPackage,
      updatedAt: new Date().toISOString(),
    });
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  if (!social) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
        <Share2 className="w-4 h-4 text-violet-500" />
        <span className="text-sm font-bold text-slate-800">Social Media Package</span>
        {social.blogNumber && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{social.blogNumber}</span>
        )}
        {social.imageUrl && (
          <img src={social.imageUrl} alt="Main image" className="w-8 h-8 rounded-lg object-cover border border-slate-200" />
        )}
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${social.status === 'ready' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          {social.status === 'ready' ? 'Ready' : 'Error'}
        </span>
        {social.model && <span className="text-[10px] text-slate-400 ml-auto">{social.provider} · {social.model}</span>}
      </div>

      {social.status === 'error' && (
        <div className="px-4 py-3 bg-rose-50 border-b border-rose-100 text-rose-700 text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{social.error || 'Social generation failed.'}</span>
          <button
            onClick={() => onRegenerate(item)}
            disabled={isRegenerating}
            className="ml-auto px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 disabled:opacity-50"
          >
            {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        {(Object.keys(SOCIAL_LABELS) as ('facebook' | 'instagram' | 'googleBusiness')[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-xs font-bold transition ${tab === k ? 'text-violet-700 border-b-2 border-violet-600' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {SOCIAL_LABELS[k]}
            <span className={`ml-1.5 text-[10px] font-semibold ${Math.abs(wordCount(draft[k]) - SOCIAL_TARGETS[k]) <= SOCIAL_TARGETS[k] * 0.2 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {wordCount(draft[k])}w
            </span>
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="p-4">
        <textarea
          id={`social-ta-${item.id}-${tab}`}
          value={draft[tab]}
          onChange={(e) => setDraft((prev) => ({ ...prev, [tab]: e.target.value }))}
          rows={10}
          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-xs leading-relaxed text-slate-800 focus:ring-2 focus:ring-violet-500 outline-none resize-y font-mono"
        />
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className={`text-[11px] font-bold ${withinTolerance ? 'text-emerald-600' : 'text-amber-600'}`}>
            {count} / {target} words {withinTolerance ? '✓' : `(target ±20%)`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => copy(draft[tab])}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
            >
              Copy
            </button>
            <button
              onClick={copyAll}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition"
            >
              Copy all
            </button>
            <button
              onClick={saveEdits}
              className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold transition"
            >
              {savedFlash ? 'Saved ✓' : 'Save edits'}
            </button>
            <button
              onClick={() => onRegenerate(item)}
              disabled={isRegenerating}
              className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-semibold hover:bg-slate-50 transition flex items-center gap-1 disabled:opacity-50"
            >
              {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Regenerate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const AutoBlogScheduler: React.FC<AutoBlogSchedulerProps> = ({
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onSaveItem,
  onCreateNewItem,
  onDeleteItem,
  onEditItem,
}) => {
  // ── Sheet connection state ──────────────────────────────────────────
  // Sheet URL is per-brand to prevent cross-brand leakage. The whole AutoBlog
  // config (sheet, cadence, start date, auto-publish, tone, word count, image/
  // SEO/humanize toggles) is persisted per brand: Firestore is the source of
  // truth, localStorage is the offline cache (see lib/autoblogConfig.ts).
  const initialCfg = useMemo(() => loadAutoblogConfig(selectedBrandId || 'none'), [selectedBrandId]);
  const [sheetUrl, setSheetUrl] = useState(initialCfg.sheetUrl);
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

  // ── When brand changes, reload the per-brand config + clear stale state ──
  useEffect(() => {
    const cfg = loadAutoblogConfig(selectedBrandId || 'none');
    setSheetUrl(cfg.sheetUrl);
    setCadenceDays(cfg.cadenceDays);
    setStartDate(cfg.startDate);
    setAutoPublish(cfg.autoPublish);
    setDefaultTone(cfg.defaultTone);
    setDefaultWordCount(cfg.defaultWordCount);
    setAutoGenerateImages(cfg.autoGenerateImages);
    setAutoSeoAnalysis(cfg.autoSeoAnalysis);
    setAutoHumanize(cfg.autoHumanize);
    setTabs([]);
    setSelectedTab('');
    setSheetRows([]);
    setSheetHeaders([]);
    setSelectedRows(new Set());
    setConnStatus(null);
    setError(null);
    // Hydrate from Firestore — the cloud copy wins over the local cache so a
    // config saved on another device (or after a browser clear) is restored.
    fetchAutoblogConfigCloud(selectedBrandId || 'none').then((cloud) => {
      if (!cloud) return;
      setSheetUrl(cloud.sheetUrl);
      setCadenceDays(cloud.cadenceDays);
      setStartDate(cloud.startDate);
      setAutoPublish(cloud.autoPublish);
      setDefaultTone(cloud.defaultTone);
      setDefaultWordCount(cloud.defaultWordCount);
      setAutoGenerateImages(cloud.autoGenerateImages);
      setAutoSeoAnalysis(cloud.autoSeoAnalysis);
      setAutoHumanize(cloud.autoHumanize);
    });
  }, [selectedBrandId]);

  // ── Schedule config ────────────────────────────────────────────────
  const [cadenceDays, setCadenceDays] = useState(initialCfg.cadenceDays);
  const [startDate, setStartDate] = useState(initialCfg.startDate);
  const [autoPublish, setAutoPublish] = useState(initialCfg.autoPublish);
  const [defaultTone, setDefaultTone] = useState(initialCfg.defaultTone);
  const [defaultWordCount, setDefaultWordCount] = useState(initialCfg.defaultWordCount);
  const [autoGenerateImages, setAutoGenerateImages] = useState(initialCfg.autoGenerateImages);
  const [autoSeoAnalysis, setAutoSeoAnalysis] = useState(initialCfg.autoSeoAnalysis);
  const [autoHumanize, setAutoHumanize] = useState(initialCfg.autoHumanize);

  // ── UI state ───────────────────────────────────────────────────────
  const [view, setView] = useState<ViewMode>('queue');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [generatingSocial, setGeneratingSocial] = useState<Set<string>>(new Set());
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

  // ── Queue state ───────────────────────────────────────────────────
  const [queueScope, setQueueScope] = useState<'autoblog' | 'all'>('autoblog');
  const [queueSearch, setQueueSearch] = useState('');
  const [queueStatus, setQueueStatus] = useState('all');
  const [queueSort, setQueueSort] = useState<'scheduled' | 'status' | 'updated' | 'title'>('scheduled');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(25);

  // Tomorrow (local) — the earliest schedulable date; the past-guard in
  // handleSchedule rejects today, so quick-schedule buttons must never use
  // startDate when it's today or earlier.
  const tomorrowDateStr = useMemo(() => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }, []);

  // Persist config: localStorage (instant, offline) + Firestore (debounced,
  // durable — survives browser clears and device changes).
  useEffect(() => {
    const cfg: AutoblogConfig = {
      sheetUrl,
      cadenceDays,
      startDate,
      autoPublish,
      defaultTone,
      defaultWordCount,
      autoGenerateImages,
      autoSeoAnalysis,
      autoHumanize,
    };
    saveAutoblogConfigLocal(selectedBrandId || 'none', cfg);
    const t = setTimeout(() => {
      void saveAutoblogConfigCloud(selectedBrandId || 'none', cfg);
    }, 800);
    return () => clearTimeout(t);
  }, [sheetUrl, cadenceDays, startDate, autoPublish, defaultTone, defaultWordCount, autoGenerateImages, autoSeoAnalysis, autoHumanize, selectedBrandId]);

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

  // ── Queue filtering / sorting / stats ─────────────────────────────
  const queueBase = queueScope === 'all' ? brandItems : autoBlogItems;

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of queueBase) counts[i.status] = (counts[i.status] || 0) + 1;
    return counts;
  }, [queueBase]);

  const queueItems = useMemo(() => {
    let list = queueBase;
    if (queueStatus !== 'all') list = list.filter((i) => i.status === queueStatus);
    const q = queueSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((i) =>
        (i.title || '').toLowerCase().includes(q) ||
        (i.primaryKeyword || '').toLowerCase().includes(q) ||
        (i.blogNumber || '').toLowerCase().includes(q) ||
        (i.sourceSheetName || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    switch (queueSort) {
      case 'scheduled':
        sorted.sort((a, b) => (a.scheduledPublishAt || '9999-12-31').localeCompare(b.scheduledPublishAt || '9999-12-31'));
        break;
      case 'status':
        sorted.sort((a, b) => a.status.localeCompare(b.status));
        break;
      case 'updated':
        sorted.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
        break;
      case 'title':
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
        break;
    }
    return sorted;
  }, [queueBase, queueStatus, queueSearch, queueSort]);

  const visibleItems = queueItems.slice(0, visibleLimit);

  const toggleSelect = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids: string[]) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const clearSelection = () => setSelectedItems(new Set());

  // ── Auto-publish check ─────────────────────────────────────────────
  // NOTE: Auto-publishing is now handled SERVER-SIDE (firebase-admin on the
  // server + a Cloud Scheduler tick every minute), so scheduled items publish
  // even when the app is closed. The queue here updates live via the Firestore
  // onSnapshot (items prop) as items flip to Published/Error. The "Publish
  // Now" button below still calls /api/autoblog/check-publish for manual use.

  // ── Sheet actions ──────────────────────────────────────────────────
  // AbortController for cancelling in-flight sheet fetches when switching tabs
  const sheetFetchRef = React.useRef<AbortController | null>(null);

  const handleFetchSheet = async () => {
    if (!sheetUrl.trim()) { setError('Enter a Google Sheet URL'); return; }
    // Cancel any in-flight request
    sheetFetchRef.current?.abort();
    const controller = new AbortController();
    sheetFetchRef.current = controller;
    // Hard timeout: if the server hangs, stop spinning and tell the user.
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);

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
      if (err?.name === 'AbortError') {
        if (timedOut) setError('Connection timed out — the server took too long to respond. Try again.');
        return; // superseded by a newer request — swallowed
      }
      setError(err.message || 'Failed to fetch sheet');
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  const handleFetchTab = async (gid: string) => {
    if (!sheetUrl.trim()) return;
    // Cancel any in-flight request
    sheetFetchRef.current?.abort();
    const controller = new AbortController();
    sheetFetchRef.current = controller;
    // Hard timeout: if the server hangs, stop spinning and tell the user.
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);

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
      if (err?.name === 'AbortError') {
        if (timedOut) setError('Connection timed out — the server took too long to respond. Try again.');
        return;
      }
      // On failure, restore previous data so the UI doesn't go blank
      setSheetRows(prevRows);
      setSheetHeaders(prevHeaders);
      setError(err.message || 'Failed to fetch tab — showing previous tab data');
    } finally {
      clearTimeout(timeout);
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
    // Importing requires a concrete brand — "All Brands" has no valid target.
    if (!selectedBrandId) {
      setError('Select a specific brand before importing — "All Brands" is not a valid import target.');
      return;
    }
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

      // Create content items from imported rows — show progress. Each row is
      // isolated: one failing row never aborts the rest of the import.
      const totalCount = data.imported.length;
      setImportProgress({ done: 0, total: totalCount });
      let createdCount = 0;
      const failed: string[] = [];
      for (let i = 0; i < data.imported.length; i++) {
        const row = data.imported[i];
        try {
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
        } catch (rowErr: any) {
          failed.push(row.title);
          console.error(`[AutoBlog] Import failed for "${row.title}":`, rowErr?.message || rowErr);
        }
        setImportProgress({ done: createdCount + failed.length, total: totalCount });
      }

      const skippedCount = data.skipped?.length || 0;
      setNotice({
        kind: failed.length === 0 ? 'ok' : 'err',
        text: failed.length === 0
          ? `Imported ${createdCount} post(s) • ${skippedCount} skipped (duplicates/empty)`
          : `Imported ${createdCount} of ${totalCount} • ${failed.length} failed (${failed.slice(0, 2).join('; ')}${failed.length > 2 ? '…' : ''}) • ${skippedCount} skipped`,
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

      // 1) Import new rows only — each row isolated so one failure never
      //    aborts the rest of the sync.
      let createdCount = 0;
      const failed: string[] = [];
      if (data.newRows && data.newRows.length > 0) {
        setImportProgress({ done: 0, total: data.newRows.length });
        for (let i = 0; i < data.newRows.length; i++) {
          const row = data.newRows[i];
          try {
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
          } catch (rowErr: any) {
            failed.push(row['Blog Title'] || row['Title'] || 'Untitled');
            console.error(`[AutoBlog] Re-sync import failed for "${row['Blog Title'] || row['Title']}":`, rowErr?.message || rowErr);
          }
          setImportProgress({ done: createdCount + failed.length, total: data.newRows.length });
        }
      }

      // 2) Apply changed rows to the existing items (seoBrief + primary
      //    keyword) so the sheet stays the single source of truth.
      let updatedCount = 0;
      if (data.changedRows && data.changedRows.length > 0) {
        for (const ch of data.changedRows) {
          const existing = autoBlogItems.find((it) => it.title === ch.existingTitle);
          if (!existing) continue;
          const sheetSummary = ch.row['One Line Summary'] || ch.row['Summary'] || '';
          const sheetKeyword = ch.row['Primary Keyword'] || ch.row['Primary'] || '';
          onSaveItem({
            ...existing,
            seoBrief: sheetSummary || existing.seoBrief,
            primaryKeyword: sheetKeyword || existing.primaryKeyword,
            updatedAt: new Date().toISOString(),
          });
          updatedCount++;
        }
      }

      setNotice({
        kind: failed.length === 0 ? 'ok' : 'err',
        text: `Re-synced: ${createdCount} new post(s) imported, ${updatedCount} existing row(s) updated${failed.length ? `, ${failed.length} failed` : ''}`,
      });
    } catch (err: any) {
      setError(err.message || 'Re-sync failed');
    } finally {
      setResyncing(false);
      setImportProgress(null);
    }
  };

  // ── Generate content for a single item ─────────────────────────────
  // Returns true on success, false on failure — lets the batch runner report
  // per-item results instead of a blanket "all done".
  const handleGenerate = async (item: ContentItem): Promise<boolean> => {
    const genStartedAt = Date.now();
    setGenerating((prev) => new Set(prev).add(item.id));
    setExpandedItem(item.id);
    setGenState((prev) => ({
      ...prev,
      [item.id]: { phase: 'Connecting to the model…', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] },
    }));
    logActivity({ category: 'generation', status: 'info', action: 'generate_start', title: `Generation started: ${item.title}`, message: 'Auto-Write generation initiated for this article.', brandId: item.brandId, brandName: brands.find((b) => b.id === item.brandId)?.name });
    // Client-side stall watchdog: re-armed on EVERY progress event (the server
    // heartbeats every 15s during streaming) and on every client-side phase
    // update, so it only fires when NOTHING has progressed for 120s — a dead
    // connection, not a slow-but-alive generation. (A one-shot 90s timer here
    // used to abort every generation that took longer than 90s total.)
    const genController = new AbortController();
    let stalled = false;
    let genWatchdog: ReturnType<typeof setTimeout>;
    const armWatchdog = () => {
      clearTimeout(genWatchdog);
      genWatchdog = setTimeout(() => { stalled = true; genController.abort(); }, 120_000);
    };
    armWatchdog();
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
          tone: defaultTone,
          generateImages: autoGenerateImages,
          byokKeys: JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}'),
        }),
        signal: genController.signal,
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
        armWatchdog(); // any UI progress means the job is alive
        setGenState((prev) => ({ ...prev, [item.id]: fn(prev[item.id] || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] }) }));
      };

      const handleEvent = (evt: any) => {
        armWatchdog(); // any server event (stream chunk, heartbeat, status…) means the connection is alive
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

      // Step 4: Generate the social media content package (Facebook, Instagram,
      // Google Business Profile) from the final article. Best-effort: a failure
      // here never fails the article — the package is saved with status 'error'
      // and the VA can retry from the expanded item view.
      let socialContent: SocialContentPackage | undefined;
      if (bodyHtml) {
        patch((prev) => ({
          ...prev,
          phase: 'Writing the social media package (Facebook, Instagram, Google Business)…',
          percent: 99,
          stalled: false,
          history: [...(prev.history || []), { message: 'Writing the social media package…', percent: 99, at: Date.now() }],
        }));
        logActivity({ category: 'generation', status: 'info', action: 'social_generate_start', title: `Social package generation started: ${item.title}`, message: 'Generating Facebook, Instagram and Google Business content.', brandId: item.brandId, brandName: brands.find((b) => b.id === item.brandId)?.name });
        try {
          const socResp = await fetch('/api/ai/generate-social', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: item.initialPrompt || item.title,
              articleHtml: bodyHtml,
              brand: brands.find((b) => b.id === item.brandId),
              primaryKeyword: kwData.primaryKeyword || item.primaryKeyword,
              secondaryKeywords: kwData.secondaryKeywords || item.secondaryKeywords,
              blogNumber: item.blogNumber,
              featuredImageUrl: genData.heroImg || item.featuredImageUrl,
              callToAction: item.sheetContext?.callToAction,
              byokKeys: JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}'),
            }),
          });
          const socData = await socResp.json();
          if (socData.success && socData.social) {
            socialContent = {
              ...socData.social,
              imageUrl: genData.heroImg || item.featuredImageUrl,
              blogNumber: item.blogNumber,
              articleTitle: item.title,
              status: 'ready',
              generatedAt: new Date().toISOString(),
              model: socData.model,
              provider: socData.provider,
              fallback: socData.fallback,
              latencyMs: socData.latencyMs,
            };
            patch((prev) => ({
              ...prev,
              phase: 'Social media package ready.',
              percent: 100,
              stalled: false,
              history: [...(prev.history || []), { message: 'Social media package ready.', percent: 100, at: Date.now() }],
            }));
          } else {
            socialContent = { facebook: '', instagram: '', googleBusiness: '', status: 'error', error: socData.error || 'Social generation failed.' };
            patch((prev) => ({
              ...prev,
              phase: 'Social package failed — article saved, retry later.',
              percent: 100,
              stalled: false,
              history: [...(prev.history || []), { message: 'Social package failed — retry later.', percent: 100, at: Date.now() }],
            }));
          }
        } catch (socErr: any) {
          socialContent = { facebook: '', instagram: '', googleBusiness: '', status: 'error', error: socErr.message || 'Social generation failed.' };
          patch((prev) => ({
            ...prev,
            phase: 'Social package failed — article saved, retry later.',
            percent: 100,
            stalled: false,
            history: [...(prev.history || []), { message: 'Social package failed — retry later.', percent: 100, at: Date.now() }],
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
        socialContent,
        status: 'Draft_Ready',
        updatedAt: new Date().toISOString(),
      };

      // Step 5: Auto-run the SEO analysis (only when the setting is enabled).
      // Best-effort: a failure here never fails the generation — the draft is
      // saved either way and the score is just attached when available.
      if (autoSeoAnalysis && bodyHtml) {
        patch((prev) => ({
          ...prev,
          phase: 'Running the SEO analysis…',
          percent: 100,
          stalled: false,
          history: [...(prev.history || []), { message: 'Running the SEO analysis…', percent: 100, at: Date.now() }],
        }));
        try {
          const seoResp = await fetch('/api/seo/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: genData.metaTitle || item.title,
              metaDescription: genData.metaDescription || item.metaDescription,
              focusKeyphrase: kwData.primaryKeyword || item.primaryKeyword,
              secondaryKeyphrases: kwData.secondaryKeywords || item.secondaryKeywords,
              bodyHtml,
            }),
          });
          const seoData = await seoResp.json();
          if (seoData.success && seoData.data) {
            updatedItem.seoScore = seoData.data.pct;
            updatedItem.seoAnalysis = {
              pct: seoData.data.pct,
              status: seoData.data.status,
              summary: seoData.data.summary,
              recommendations: seoData.data.recommendations || [],
            };
          }
        } catch (seoErr: any) {
          console.warn(`[AutoBlog] SEO analysis failed for "${item.title}":`, seoErr?.message || seoErr);
        }
      }

      // Per-item generation history: timestamped, model-attributed record of
      // every Auto-Write run, persisted with the item in Firestore (bounded to
      // the last 30 runs, same convention as ZenEditor).
      const genEntry: GenerationLogEntry = {
        at: new Date().toISOString(),
        action: 'Auto-Write',
        provider: genData.provider || 'gemini',
        model: genData.model || 'unknown',
        words: genData.wordCount || countWords(bodyHtml),
        durationMs: Date.now() - genStartedAt,
        ok: true,
        insight: updatedItem.seoScore != null ? `SEO score ${updatedItem.seoScore}` : undefined,
      };
      onSaveItem({ ...updatedItem, generationLog: [genEntry, ...(item.generationLog || [])].slice(0, 30) });
      logActivity({ category: 'generation', status: 'success', action: 'generate_complete', title: `Generation complete: ${item.title}`, message: autoSocial && socialContent?.status === 'ready' ? 'Article and social package generated.' : 'Article generated.', brandId: item.brandId, brandName: brands.find((b) => b.id === item.brandId)?.name, payload: { socialStatus: socialContent?.status || 'none', seoScore: updatedItem.seoScore, model: genData.model, provider: genData.provider } });
      setNotice({ kind: 'ok', text: autoHumanize ? `Generated & humanised: "${item.title}"` : `Generated: "${item.title}"` });
      return true;
    } catch (err: any) {
      // Record the failed run on the item too, so the failure history is
      // visible next to the article (not just in the global activity log).
      const failEntry: GenerationLogEntry = {
        at: new Date().toISOString(),
        action: 'Auto-Write',
        provider: 'gemini',
        model: 'unknown',
        durationMs: Date.now() - genStartedAt,
        ok: false,
        error: (err?.message || 'Generation failed.').slice(0, 300),
      };
      onSaveItem({ ...item, generationLog: [failEntry, ...(item.generationLog || [])].slice(0, 30), updatedAt: new Date().toISOString() });
      logActivity({ category: 'error', status: 'error', action: 'generate_failed', title: `Generation failed: ${item.title}`, message: err.message || 'Generation failed.', brandId: item.brandId, brandName: brands.find((b) => b.id === item.brandId)?.name });
      setNotice({ kind: 'err', text: `Generation failed: ${stalled ? 'the model went quiet — please retry' : err.message}` });
      return false;
    } finally {
      clearTimeout(genWatchdog);
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

  // ── Regenerate the social media package for an existing draft ──────
  const handleRegenerateSocial = async (item: ContentItem) => {
    setGeneratingSocial((prev) => new Set(prev).add(item.id));
    try {
      const byokKeys = JSON.parse(localStorage.getItem('fgos_byok_keys') || '{}');
      const brand = brands.find((b) => b.id === item.brandId);
      const resp = await fetch('/api/ai/generate-social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.initialPrompt || item.title,
          articleHtml: item.bodyHtml,
          brand,
          primaryKeyword: item.primaryKeyword,
          secondaryKeywords: item.secondaryKeywords,
          blogNumber: item.blogNumber,
          featuredImageUrl: item.featuredImageUrl,
          callToAction: item.sheetContext?.callToAction,
          byokKeys,
        }),
      });
      const data = await resp.json();
      if (data.success && data.social) {
        const pkg: SocialContentPackage = {
          ...data.social,
          imageUrl: item.featuredImageUrl,
          blogNumber: item.blogNumber,
          articleTitle: item.title,
          status: 'ready',
          generatedAt: new Date().toISOString(),
          model: data.model,
          provider: data.provider,
          fallback: data.fallback,
          latencyMs: data.latencyMs,
        };
        onSaveItem({ ...item, socialContent: pkg, updatedAt: new Date().toISOString() });
        setNotice({ kind: 'ok', text: `Social package regenerated for "${item.title}"` });
      } else {
        onSaveItem({
          ...item,
          socialContent: { facebook: '', instagram: '', googleBusiness: '', status: 'error', error: data.error || 'Social generation failed.' },
          updatedAt: new Date().toISOString(),
        });
        setNotice({ kind: 'err', text: `Social regeneration failed: ${data.error || 'unknown error'}` });
      }
    } catch (err: any) {
      onSaveItem({
        ...item,
        socialContent: { facebook: '', instagram: '', googleBusiness: '', status: 'error', error: err?.message || 'Social generation failed.' },
        updatedAt: new Date().toISOString(),
      });
      setNotice({ kind: 'err', text: `Social regeneration failed: ${err?.message}` });
    } finally {
      setGeneratingSocial((prev) => {
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
    // NEVER schedule into the past: the first post must land on a future day,
    // otherwise the auto-publish tick fires immediately and the post goes live
    // before anyone has reviewed it.
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (startDateMs < tomorrow.getTime()) {
      setNotice({ kind: 'err', text: 'Start date must be tomorrow or later — pick a future date so posts don\'t publish immediately.' });
      return;
    }
    if (!window.confirm(`Schedule ${drafts.length} draft${drafts.length > 1 ? 's' : ''} every ${cadenceDays} day${cadenceDays > 1 ? 's' : ''} starting ${startDate}?`)) return;
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
  // Shared by the single-item button and the bulk publish action.
  const publishOne = async (item: ContentItem): Promise<{ ok: boolean; message?: string }> => {
    const brand = brands.find((b) => b.id === item.brandId);
    if (!brand?.wpUrl || !brand?.wpUsername) {
      return { ok: false, message: `"${item.title}" — brand has no WordPress credentials configured. Go to Settings → Brand DNA to add them.` };
    }
    if (!item.bodyHtml || item.bodyHtml.trim().length < 50) {
      return { ok: false, message: `"${item.title}" has no article body yet — generate the draft before publishing.` };
    }
    setPublishing((prev) => new Set(prev).add(item.id));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let resp: Response;
      try {
        resp = await fetch('/api/autoblog/check-publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dueItems: [{ ...item, scheduledPublishAt: new Date().toISOString() }],
            brands: [brand],
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      const data = await resp.json();
      const result = data.results?.[0];
      if (result?.success) {
        onSaveItem({
          ...item,
          status: 'Published',
          wpPostId: result.wpPostId,
          lastAutoPublishedAt: new Date().toISOString(),
          lastAutoPublishError: undefined,
          publishRetryCount: undefined,
          publishRetryAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        return { ok: true, message: `Published "${item.title}" to WordPress` };
      }
      // Keep the item retryable (Draft_Ready) — the server-side tick will
      // retry it with exponential backoff when its schedule comes due.
      onSaveItem({
        ...item,
        status: 'Draft_Ready',
        lastAutoPublishError: result?.message || 'Publish failed',
        updatedAt: new Date().toISOString(),
      });
      return { ok: false, message: `Publish failed: ${result?.message || 'Unknown error'} — will retry automatically.` };
    } catch (err: any) {
      return { ok: false, message: `Publish error: ${err?.name === 'AbortError' ? 'timed out after 30s' : err.message}` };
    } finally {
      setPublishing((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handlePublishNow = async (item: ContentItem) => {
    const res = await publishOne(item);
    setNotice({ kind: res.ok ? 'ok' : 'err', text: res.message || 'Publish failed.' });
  };

  // ── Delete item ────────────────────────────────────────────────────
  const handleDelete = async (item: ContentItem) => {
    if (!window.confirm(`Delete "${item.title}"? This cannot be undone.`)) return;
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
    let failed = 0;
    for (const item of planned) {
      if (batchCancelRef.current) {
        setNotice({ kind: 'ok', text: `Stopped after ${done} / ${planned.length} articles` });
        break;
      }
      const ok = await handleGenerate(item);
      if (ok) done++; else failed++;
    }
    if (!batchCancelRef.current) {
      setNotice({
        kind: failed === 0 ? 'ok' : 'err',
        text: failed === 0 ? `All done — ${done} articles generated` : `Finished: ${done} generated, ${failed} failed — retry the failed ones individually`,
      });
    }
    setBatchGenerating(false);
  };

  const handleCancelBatch = () => {
    batchCancelRef.current = true;
  };

  // ── Bulk actions (selection mode) ─────────────────────────────────
  const handleBulkSchedule = () => {
    const sel = queueItems.filter(
      (i) => selectedItems.has(i.id) && i.status !== 'Published' && i.status !== 'Generating' && !i.scheduledPublishAt
    );
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts can be scheduled (already scheduled, published, or generating).' });
      return;
    }
    // Same past-guard as handleScheduleAll — never schedule into the past.
    const startDateMs = new Date(`${startDate}T00:00:00`).getTime();
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (isNaN(startDateMs) || startDateMs < tomorrow.getTime()) {
      setNotice({ kind: 'err', text: 'Start date must be tomorrow or later — pick a future date in Sheet Settings.' });
      return;
    }
    if (!window.confirm(`Schedule ${sel.length} selected post${sel.length > 1 ? 's' : ''} every ${cadenceDays} day${cadenceDays > 1 ? 's' : ''} starting ${startDate}?`)) return;
    sel.forEach((item, i) => {
      const schedDate = new Date(startDateMs + i * cadenceDays * 86_400_000);
      onSaveItem({
        ...item,
        scheduledPublishAt: schedDate.toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });
    setNotice({ kind: 'ok', text: `Scheduled ${sel.length} selected posts starting ${startDate}` });
    clearSelection();
  };

  const handleBulkGenerate = async () => {
    const sel = queueItems.filter((i) => selectedItems.has(i.id) && i.status === 'Planned');
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts are Planned — only Planned posts can be generated.' });
      return;
    }
    let done = 0;
    let failed = 0;
    for (const item of sel) {
      const ok = await handleGenerate(item);
      if (ok) done += 1;
      else failed += 1;
    }
    setNotice({ kind: failed ? 'err' : 'ok', text: `Generated ${done} post${done !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.` });
    clearSelection();
  };

  const handleBulkDelete = async () => {
    const sel = queueItems.filter((i) => selectedItems.has(i.id));
    if (sel.length === 0) return;
    if (!window.confirm(`Delete ${sel.length} selected post${sel.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    let ok = 0;
    let failed = 0;
    for (const item of sel) {
      try {
        await onDeleteItem(item);
        ok += 1;
      } catch {
        failed += 1;
      }
    }
    setNotice({ kind: failed ? 'err' : 'ok', text: `Deleted ${ok} post${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.` });
    clearSelection();
  };

  // ── Manual retry for Error items ──────────────────────────────────
  // The server marks an item Error only after 5 consecutive publish failures.
  // This resets it to Draft_Ready AND clears publishRetryAt so the server tick
  // stops skipping it (the backoff timestamp would otherwise block retries).
  const handleRetryError = (item: ContentItem) => {
    onSaveItem({
      ...item,
      status: 'Draft_Ready',
      lastAutoPublishError: undefined,
      publishRetryCount: undefined,
      publishRetryAt: undefined,
      updatedAt: new Date().toISOString(),
    });
    setNotice({ kind: 'ok', text: `"${item.title}" reset to Draft_Ready — it will retry on its next scheduled tick.` });
  };

  // ── Bulk publish now (Draft_Ready items with a body) ──────────────
  const handleBulkPublish = async () => {
    const sel = queueItems.filter(
      (i) => selectedItems.has(i.id) && i.status === 'Draft_Ready' && i.bodyHtml && i.bodyHtml.trim().length >= 50
    );
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts are ready to publish (Draft_Ready with an article body).' });
      return;
    }
    if (!window.confirm(`Publish ${sel.length} selected post${sel.length > 1 ? 's' : ''} to WordPress now?`)) return;
    let ok = 0;
    let failed = 0;
    for (const item of sel) {
      const res = await publishOne(item);
      if (res.ok) ok += 1;
      else failed += 1;
    }
    setNotice({ kind: failed ? 'err' : 'ok', text: `Published ${ok} post${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.` });
    clearSelection();
  };

  // ── Bulk clear schedule (scheduled items) ─────────────────────────
  const handleBulkUnschedule = () => {
    const sel = queueItems.filter((i) => selectedItems.has(i.id) && i.scheduledPublishAt);
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts have a schedule to clear.' });
      return;
    }
    if (!window.confirm(`Remove the publish schedule from ${sel.length} selected post${sel.length > 1 ? 's' : ''}?`)) return;
    sel.forEach((item) => handleUnschedule(item));
    setNotice({ kind: 'ok', text: `Cleared the schedule on ${sel.length} post${sel.length > 1 ? 's' : ''}.` });
    clearSelection();
  };

  // ── Bulk retry (Error items) ──────────────────────────────────────
  const handleBulkRetry = () => {
    const sel = queueItems.filter((i) => selectedItems.has(i.id) && i.status === 'Error');
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts are in Error state.' });
      return;
    }
    sel.forEach((item) => handleRetryError(item));
    setNotice({ kind: 'ok', text: `Reset ${sel.length} post${sel.length > 1 ? 's' : ''} to Draft_Ready — they will retry on their next scheduled tick.` });
    clearSelection();
  };

  // ── Bulk SEO analysis (Draft_Ready items with a body) ─────────────
  // Best-effort: a failure on one item never aborts the rest, and the score
  // is just attached when available (same pattern as autoSeoAnalysis).
  const handleBulkSeo = async () => {
    const sel = queueItems.filter(
      (i) => selectedItems.has(i.id) && i.status === 'Draft_Ready' && i.bodyHtml && i.bodyHtml.trim().length >= 50
    );
    if (sel.length === 0) {
      setNotice({ kind: 'err', text: 'No selected posts have an article body to analyse.' });
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const item of sel) {
      try {
        const seoResp = await fetch('/api/seo/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: item.metaTitle || item.title,
            metaDescription: item.metaDescription || '',
            focusKeyphrase: item.primaryKeyword || '',
            secondaryKeyphrases: item.secondaryKeywords || [],
            bodyHtml: item.bodyHtml,
          }),
        });
        const seoData = await seoResp.json();
        if (seoData.success && seoData.data) {
          onSaveItem({
            ...item,
            seoScore: seoData.data.pct,
            seoAnalysis: {
              pct: seoData.data.pct,
              status: seoData.data.status,
              summary: seoData.data.summary,
              recommendations: seoData.data.recommendations || [],
            },
            updatedAt: new Date().toISOString(),
          });
          ok += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    setNotice({ kind: failed ? 'err' : 'ok', text: `Analysed ${ok} post${ok !== 1 ? 's' : ''}${failed ? `, ${failed} failed` : ''}.` });
    clearSelection();
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
                  min={tomorrowDateStr}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-violet-500 outline-none"
                />
                <p className="text-[10px] text-slate-400 mt-1">Earliest schedulable day — posts can't be scheduled in the past.</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Default Brand</label>
              <BrandSwitcher
                brands={brands}
                selectedBrandId={selectedBrandId}
                onSelectBrand={onSelectBrand}
                size="sm"
              />
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
                    Auto-publish runs <strong>server-side every 60 seconds</strong> (Cloud Scheduler tick), so scheduled
                    posts publish even when this app is closed. Transient failures are retried automatically with
                    exponential backoff (up to 5 attempts) before an item is marked Error.
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
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const now = new Date();
                    setCalMonth(now.getMonth());
                    setCalYear(now.getFullYear());
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-xl transition"
                >
                  Today
                </button>
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
                onUnschedule={handleUnschedule}
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

          {/* Stats strip */}
          {queueBase.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 bg-white rounded-2xl border border-slate-200 px-5 py-3 shadow-sm">
              <span className="text-xs font-bold text-slate-700">{queueBase.length} total</span>
              {(['Planned', 'Draft_Ready', 'Scheduled', 'Published', 'Error'] as const).map((s) => {
                const n = statusCounts[s] || 0;
                if (n === 0) return null;
                const color =
                  s === 'Published' ? 'text-emerald-600' :
                  s === 'Error' ? 'text-red-600' :
                  s === 'Scheduled' ? 'text-violet-600' :
                  s === 'Draft_Ready' ? 'text-sky-600' : 'text-slate-600';
                return (
                  <button
                    key={s}
                    onClick={() => setQueueStatus(queueStatus === s ? 'all' : s)}
                    className={`text-xs font-bold ${color} ${queueStatus === s ? 'underline underline-offset-4 decoration-2' : 'opacity-80 hover:opacity-100'}`}
                    title={`Click to filter by ${s.replace('_', ' ')}`}
                  >
                    {s.replace('_', ' ')}: {n}
                  </button>
                );
              })}
              {selectedItems.size > 0 && (
                <span className="ml-auto text-xs font-bold text-violet-600">
                  {selectedItems.size} selected
                </span>
              )}
            </div>
          )}

          {/* Filter bar — visible whenever the brand has ANY posts, so the
              AutoBlog / All posts scope toggle is always reachable */}
          {brandItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px] max-w-xs">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={queueSearch}
                  onChange={(e) => setQueueSearch(e.target.value)}
                  placeholder="Search title, keyword, blog #, sheet…"
                  className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-violet-500 outline-none bg-white"
                />
              </div>
              <select
                value={queueStatus}
                onChange={(e) => setQueueStatus(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
              >
                <option value="all">All statuses</option>
                {['Planned', 'Draft_Ready', 'Scheduled', 'Published', 'Error'].map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              <select
                value={queueSort}
                onChange={(e) => setQueueSort(e.target.value as typeof queueSort)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white focus:ring-2 focus:ring-violet-500 outline-none"
              >
                <option value="scheduled">Sort: publish date</option>
                <option value="status">Sort: status</option>
                <option value="updated">Sort: last updated</option>
                <option value="title">Sort: title</option>
              </select>
              <div className="flex items-center bg-white border border-slate-200 rounded-xl p-0.5">
                <button
                  onClick={() => setQueueScope('autoblog')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${queueScope === 'autoblog' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  AutoBlog
                </button>
                <button
                  onClick={() => setQueueScope('all')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${queueScope === 'all' ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  All posts
                </button>
              </div>
              <button
                onClick={() => toggleSelectAll(queueItems.map((i) => i.id))}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
                title="Select / deselect all filtered posts"
              >
                {selectedItems.size > 0 && selectedItems.size === queueItems.length ? 'Deselect all' : `Select all (${queueItems.length})`}
              </button>
              {selectedItems.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleBulkSchedule}
                    className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Schedule selected drafts starting from the Sheet Settings start date"
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    Schedule
                  </button>
                  <button
                    onClick={handleBulkGenerate}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Generate articles for selected Planned posts"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate
                  </button>
                  <button
                    onClick={handleBulkPublish}
                    className="px-3 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Publish selected Draft_Ready posts to WordPress now"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Publish
                  </button>
                  <button
                    onClick={handleBulkSeo}
                    className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Run the SEO analysis on selected Draft_Ready posts"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    SEO check
                  </button>
                  <button
                    onClick={handleBulkUnschedule}
                    className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Remove the publish schedule from selected posts"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Unschedule
                  </button>
                  <button
                    onClick={handleBulkRetry}
                    className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Reset selected Error posts to Draft_Ready so they retry"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry
                  </button>
                  <button
                    onClick={handleBulkDelete}
                    className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                    title="Delete selected posts (asks for confirmation)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                  <button
                    onClick={clearSelection}
                    className="px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Empty state — scope-aware */}
          {queueBase.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
              {queueScope === 'autoblog' && brandItems.length > 0 ? (
                <>
                  <div className="w-16 h-16 bg-violet-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
                    <CalendarClock className="w-8 h-8 text-violet-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">No AutoBlog posts yet</h3>
                  <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                    This brand has {brandItems.length} post{brandItems.length !== 1 ? 's' : ''} but none imported from a sheet or scheduled.
                    Connect a Google Sheet to import blog topics, or switch to <strong>All posts</strong> to see every post for this brand.
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => setQueueScope('all')}
                      className="px-6 py-3 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-sm font-bold transition"
                    >
                      Show all {brandItems.length} posts
                    </button>
                    <button
                      onClick={() => setView('settings')}
                      className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition inline-flex items-center gap-2"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Connect Google Sheet
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-violet-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
                    <CalendarClock className="w-8 h-8 text-violet-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 mb-2">No posts yet</h3>
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
                </>
              )}
            </div>
          )}

          {/* Items list */}
          {visibleItems.map((item) => {
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
                  {/* Selection checkbox */}
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 shrink-0"
                    title="Select for bulk actions"
                  />
                  {/* Status badge */}
                  <div className="shrink-0">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold ${statusColors[item.status] || 'bg-slate-100 text-slate-600'}`}>
                      {item.status === 'Generating' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      {item.status.replace('_', ' ')}
                    </span>
                    {item.socialContent?.status === 'ready' && (
                      <span className="inline-flex items-center px-2 py-1 mt-1 rounded-lg text-[10px] font-bold bg-violet-100 text-violet-700" title="Social media package ready">
                        📱 Social
                      </span>
                    )}
                    {item.seoScore != null && item.seoScore > 0 && (
                      <span className={`inline-flex items-center px-2 py-1 mt-1 rounded-lg text-[10px] font-bold ${
                        item.seoScore >= 80 ? 'bg-emerald-100 text-emerald-700' : item.seoScore >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                      }`} title={`SEO score: ${item.seoScore}/100`}>
                        📊 SEO {item.seoScore}
                      </span>
                    )}
                    {(item.publishRetryCount || 0) > 0 && (
                      <span className="inline-flex items-center px-2 py-1 mt-1 rounded-lg text-[10px] font-bold bg-amber-100 text-amber-700" title={`Publish failed ${item.publishRetryCount} time(s) — will retry`}>
                        ⚠️ Retry {item.publishRetryCount}/5
                      </span>
                    )}
                  </div>

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm text-slate-900 truncate">
                      {item.blogNumber && <span className="text-violet-500 mr-1.5">#{item.blogNumber}</span>}
                      {item.title}
                    </div>
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
                        onClick={() => handleSchedule(item, tomorrowDateStr, '09:00')}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                        title="Schedules for tomorrow 09:00 — use the expanded panel to pick a specific date/time"
                      >
                        <Calendar className="w-3 h-3" />
                        Schedule
                      </button>
                    )}

                    {item.status === 'Error' && (
                      <button
                        onClick={() => handleRetryError(item)}
                        className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-1"
                        title="Reset to Draft_Ready so the scheduler retries it on the next tick"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Retry
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
                            min={tomorrowDateStr}
                            defaultValue={item.scheduledPublishAt ? localDateInput(item.scheduledPublishAt) : tomorrowDateStr}
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

                    {/* Social media package */}
                    {item.socialContent && (
                      <SocialPackageCard
                        item={item}
                        brand={brand}
                        isRegenerating={generatingSocial.has(item.id)}
                        onRegenerate={handleRegenerateSocial}
                        onSave={onSaveItem}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Show more */}
          {queueItems.length > visibleLimit && (
            <div className="text-center">
              <button
                onClick={() => setVisibleLimit((n) => n + 25)}
                className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition"
              >
                Show {Math.min(25, queueItems.length - visibleLimit)} more ({queueItems.length - visibleLimit} remaining)
              </button>
            </div>
          )}

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
