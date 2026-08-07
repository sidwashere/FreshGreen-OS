import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Target,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Globe,
  Wand2,
  FileText,
  Link2,
  Sparkles,
} from 'lucide-react';

// ---------- Types (mirror the /api/seo/analyze response) ----------

export type SeoStatus = 'good' | 'ok' | 'poor' | 'na';

export interface SeoCheckResult {
  id: string;
  title: string;
  description: string;
  status: SeoStatus;
  score: number;
  maxScore: number;
}

export interface SeoAnalyzeData {
  score: number;
  maxScore: number;
  pct: number;
  status: 'good' | 'ok' | 'poor';
  summary: { good: number; ok: number; poor: number; na: number };
  results: SeoCheckResult[];
  recommendations: string[];
}

interface SeoPanelItem {
  title: string;
  contentType?: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  slug?: string;
  bodyHtml?: string;
  featuredImageUrl?: string;
  targetWordCount?: number;
}

interface SeoPanelProps {
  item: SeoPanelItem;
  onChange: (patch: Partial<SeoPanelItem>) => void;
  siteUrl?: string;
  wordCount: number;
  onScore?: (pct: number | null) => void;
}

// ---------- Helpers ----------

const INTENT_BY_CONTENT_TYPE: Record<string, string> = {
  page: 'commercial',
  landing: 'commercial',
  product: 'transactional',
  article: 'informational',
  blog: 'informational',
};

const INTENT_LABELS: Record<string, string> = {
  informational: 'Informational (learn / how-to)',
  commercial: 'Commercial (compare / decide)',
  transactional: 'Transactional (buy / book)',
  navigational: 'Navigational (find a site)',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Heuristic grouping of the 99 checks into human-friendly categories.
function categorize(id: string): string {
  if (id.startsWith('intent')) return 'Search intent';
  if (id.startsWith('aeo') || id.startsWith('tldr') || id.startsWith('faq')) return 'AI search (AEO)';
  if (/eeat|author|ymyl|organization|published|original|expert|source|correction|privacy|sponsored|affiliate|reviewer|conflict|methodology|experience|authority|sourcing|hedging|accuracy|freshness/.test(id)) return 'E-E-A-T & trust';
  if (/keyphrase|secondary|density|distribution|introduction|markup|previously/.test(id)) return 'Keyphrase';
  if (/readability|paragraph|sentence|transition|complexity|vocabulary|heading|h1|subheading|table-of-contents/.test(id)) return 'Readability & structure';
  if (/image|media|multimedia/.test(id)) return 'Media';
  if (/title|meta|slug|url|canonical/.test(id)) return 'Metadata';
  if (/link/.test(id)) return 'Links';
  return 'Content';
}

const STATUS_META: Record<SeoStatus, { label: string; icon: React.ReactNode; badge: string; row: string }> = {
  good: {
    label: 'Pass',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />,
    badge: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    row: '',
  },
  ok: {
    label: 'Improve',
    icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />,
    badge: 'bg-amber-50 text-amber-600 border-amber-200',
    row: 'border-l-2 border-l-amber-400',
  },
  poor: {
    label: 'Fix',
    icon: <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />,
    badge: 'bg-red-50 text-red-600 border-red-200',
    row: 'border-l-2 border-l-red-400',
  },
  na: {
    label: 'Not applicable',
    icon: null,
    badge: 'bg-slate-50 text-slate-400 border-slate-200',
    row: '',
  },
};

function ScoreRing({ pct }: { pct: number | null }) {
  const R = 34;
  const C = 2 * Math.PI * R;
  if (pct === null) {
    return (
      <div className="w-20 h-20 rounded-full bg-slate-100 border-4 border-slate-200 flex items-center justify-center text-slate-300 text-lg font-extrabold">
        –
      </div>
    );
  }
  const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative w-20 h-20 shrink-0">
      <svg viewBox="0 0 80 80" className="w-20 h-20 -rotate-90">
        <circle cx="40" cy="40" r={R} fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <circle
          cx="40"
          cy="40"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xl font-extrabold" style={{ color }}>
        {pct}
      </div>
    </div>
  );
}

function CountBar({ value, min, max, hint }: { value: number; min: number; max: number; hint: string }) {
  const inRange = value >= min && value <= max;
  const over = value > max;
  const color = over ? 'bg-red-400' : inRange ? 'bg-emerald-500' : 'bg-amber-400';
  const pctOf = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${color}`} style={{ width: `${pctOf}%` }} />
      </div>
      <span className={`text-xs font-semibold tabular-nums ${over ? 'text-red-500' : inRange ? 'text-emerald-600' : 'text-amber-500'}`}>
        {value}
      </span>
      <span className="text-[11px] text-slate-400">{hint}</span>
    </div>
  );
}

// ---------- Component ----------

export const SeoPanel: React.FC<SeoPanelProps> = ({ item, onChange, siteUrl, wordCount, onScore }) => {
  const [data, setData] = useState<SeoAnalyzeData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [refining, setRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<string>(() => INTENT_BY_CONTENT_TYPE[item.contentType || ''] || 'informational');
  const [showPassed, setShowPassed] = useState(false);
  // Advanced refine controls
  const [refineMode, setRefineMode] = useState<string>('fix-failures');
  const [showRefineOptions, setShowRefineOptions] = useState(false);
  const [customInstruction, setCustomInstruction] = useState('');
  const [tone, setTone] = useState('warm, expert and approachable');
  const [readability, setReadability] = useState('6');
  const [densityTarget, setDensityTarget] = useState('0.5-2.5%');
  const [humanize, setHumanize] = useState(true);

  const timerRef = useRef<number | null>(null);
  const hasFetchedRef = useRef(false);
  const payloadRef = useRef<Record<string, unknown> | null>(null);

  // Keep the latest payload in a ref so the debounced fetch always uses fresh data.
  const baseUrl = normalizeUrl(siteUrl);
  payloadRef.current = {
    title: item.metaTitle || item.title,
    metaDescription: item.metaDescription || '',
    focusKeyphrase: item.primaryKeyword || '',
    secondaryKeyphrases: item.secondaryKeywords || [],
    bodyHtml: item.bodyHtml || '',
    slug: item.slug || '',
    expectedIntent: intent,
    siteUrl: baseUrl,
    canonicalUrl: baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${item.slug || slugify(item.title)}` : undefined,
    images: item.featuredImageUrl
      ? [{ src: item.featuredImageUrl, alt: `${item.primaryKeyword || 'featured'} image` }]
      : [],
  };

  const runAnalysis = useCallback(async () => {
    const payload = payloadRef.current;
    if (!payload || !String(payload.bodyHtml || '').trim()) {
      setData(null);
      hasFetchedRef.current = false;
      return;
    }
    if (!hasFetchedRef.current) setAnalyzing(true);
    try {
      const res = await fetch('/api/seo/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(typeof json.error === 'string' ? json.error : 'Analysis failed');
      setData(json.data);
      hasFetchedRef.current = true;
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  // Debounced auto-analysis on any SEO-relevant change.
  const analysisKey = useMemo(
    () =>
      JSON.stringify([
        item.title,
        item.metaTitle,
        item.metaDescription,
        item.primaryKeyword,
        item.secondaryKeywords || [],
        item.slug,
        item.bodyHtml,
        intent,
      ]),
    [item.title, item.metaTitle, item.metaDescription, item.primaryKeyword, item.secondaryKeywords, item.slug, item.bodyHtml, intent]
  );

  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    if (!(item.bodyHtml || '').trim()) {
      setData(null);
      hasFetchedRef.current = false;
      return;
    }
    timerRef.current = window.setTimeout(runAnalysis, 700);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey]);

  // Report the live score up to the editor (for the tab badge).
  useEffect(() => {
    onScore?.(data ? data.pct : null);
  }, [data, onScore]);

  // Reset intent if the content type changes (new article type).
  useEffect(() => {
    setIntent(INTENT_BY_CONTENT_TYPE[item.contentType || ''] || 'informational');
  }, [item.contentType]);

  const applySuggestions = () => {
    const patch: Partial<SeoPanelItem> = {};
    const raw = item.title || '';
    const slug = slugify(raw);
    if (slug && !item.slug) patch.slug = slug;
    if (!item.metaTitle && raw) {
      // 50-60 char title tag: keyword first, brand suffix only if it fits.
      const kw = item.primaryKeyword || raw.split(/\s+/).slice(0, 5).join(' ');
      const base = kw[0].toUpperCase() + kw.slice(1);
      const brand = normalizeUrl(siteUrl) ? new URL(normalizeUrl(siteUrl) as string).hostname.replace(/^www\./, '').split('.')[0] : '';
      const titleTag = brand ? `${base} | ${brand}` : base;
      patch.metaTitle = titleTag.slice(0, 60);
    }
    if (Object.keys(patch).length > 0) onChange(patch);
  };

  const handleRefine = async (mode?: string, focusChecks?: SeoCheckResult[]) => {
    const effectiveMode = mode || refineMode;
    if (refining || !item.bodyHtml?.trim()) return;
    if (effectiveMode === 'custom' && !customInstruction.trim()) {
      setError('Type an instruction for the custom refine first.');
      return;
    }
    setRefining(true);
    setError(null);
    try {
      const res = await fetch('/api/seo/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title,
          bodyHtml: item.bodyHtml,
          metaTitle: item.metaTitle,
          metaDescription: item.metaDescription,
          primaryKeyword: item.primaryKeyword,
          secondaryKeywords: item.secondaryKeywords,
          targetWordCount: item.targetWordCount || 900,
          applyHumanization: humanize,
          mode: effectiveMode,
          instruction: customInstruction,
          focusChecks: focusChecks || [],
          recommendations: (data?.results || [])
            .filter((r) => r.status === 'poor' || r.status === 'ok')
            .map((r) => ({ id: r.id, title: r.title, description: r.description })),
          options: { tone, readability, densityTarget },
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(typeof json.error === 'string' ? json.error : 'Refine failed');
      if (json.data?.bodyHtml) {
        onChange({ bodyHtml: json.data.bodyHtml });
        setError(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Refine failed');
    } finally {
      setRefining(false);
    }
  };

  const REFINE_MODES: { id: string; label: string }[] = [
    { id: 'fix-failures', label: 'Fix issues' },
    { id: 'shorten', label: 'Shorten' },
    { id: 'simplify', label: 'Simplify' },
    { id: 'expand', label: 'Expand' },
    { id: 'faq', label: 'Add FAQ' },
    { id: 'links', label: 'Add links' },
    { id: 'eeat', label: 'E-E-A-T' },
    { id: 'custom', label: 'Custom…' },
  ];

  const titleLen = (item.metaTitle || '').length;
  const descLen = (item.metaDescription || '').length;

  const grouped = useMemo(() => {
    const g = { good: [] as SeoCheckResult[], ok: [] as SeoCheckResult[], poor: [] as SeoCheckResult[], na: [] as SeoCheckResult[] };
    for (const r of data?.results || []) g[r.status]?.push(r);
    return g;
  }, [data]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data?.results || []) {
      if (r.status === 'na') continue;
      const cat = categorize(r.id);
      map.set(cat, (map.get(cat) || 0) + (r.status === 'good' ? 0 : 1));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  const serpUrl = `${normalizeUrl(siteUrl) || 'https://example.com'}/${item.slug || slugify(item.title)}`;

  return (
    <div className="space-y-5">
      {/* Header: live score + status + categories */}
      <div className="flex items-start gap-4">
        <ScoreRing pct={data ? data.pct : null} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-extrabold text-slate-900 text-sm">
              {analyzing ? 'Analyzing…' : data ? (data.pct >= 80 ? 'Excellent SEO' : data.pct >= 60 ? 'Good — can improve' : 'Needs work') : 'Ready to analyze'}
            </p>
            <button
              onClick={() => { setAnalyzing(true); runAnalysis(); }}
              disabled={analyzing || !(item.bodyHtml || '').trim()}
              className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40 flex items-center gap-1 transition"
            >
              <RefreshCw className={`w-3 h-3 ${analyzing ? 'animate-spin' : ''}`} />
              Re-run
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {data
              ? `${data.summary.good} passing · ${data.summary.ok} to improve · ${data.summary.poor} to fix · ${data.summary.na} n/a`
              : error ? 'Analysis failed — check server logs.' : 'Type in the editor — scores update live after a short pause.'}
          </p>
          {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
          {data && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-slate-400" /> Advanced refine
                </p>
                <button
                  onClick={() => setShowRefineOptions((s) => !s)}
                  className="text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition"
                >
                  {showRefineOptions ? 'Hide options ▲' : 'Options ▼'}
                </button>
              </div>

              {/* Mode chips */}
              <div className="flex flex-wrap gap-1.5">
                {REFINE_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setRefineMode(m.id)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition ${
                      refineMode === m.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {refineMode === 'custom' && (
                <input
                  type="text"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  placeholder="e.g. Make the intro friendlier and add a comparison table"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-slate-400 bg-white"
                />
              )}

              {showRefineOptions && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Tone</label>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white cursor-pointer">
                      <option>warm, expert and approachable</option>
                      <option>professional and authoritative</option>
                      <option>friendly and conversational</option>
                      <option>playful and energetic</option>
                      <option>calm and reassuring</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Reading level</label>
                    <select value={readability} onChange={(e) => setReadability(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white cursor-pointer">
                      <option value="5">Easy (grade 5)</option>
                      <option value="6">Plain (grade 6)</option>
                      <option value="8">Standard (grade 8)</option>
                      <option value="10">Advanced (grade 10)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Keyphrase density</label>
                    <select value={densityTarget} onChange={(e) => setDensityTarget(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white cursor-pointer">
                      <option>0.5-2.5%</option>
                      <option>0.5-1.5%</option>
                      <option>1-2%</option>
                      <option>1.5-2.5%</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase tracking-wide">Humanize after</label>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => setHumanize((h) => !h)}
                        className={`relative rounded-full transition ${humanize ? 'bg-emerald-500' : 'bg-slate-300'}`}
                        style={{ height: 18, width: 32 }}
                      >
                        <span
                          className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all"
                          style={{ left: humanize ? 16 : 2 }}
                        />
                      </button>
                      <span className="text-xs text-slate-500">{humanize ? 'On' : 'Off'}</span>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={() => handleRefine()}
                disabled={refining}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition disabled:opacity-50"
                title="Rewrite the article using the selected refine mode"
              >
                <Sparkles className={`w-3.5 h-3.5 ${refining ? 'animate-pulse' : ''}`} />
                {refining ? 'Refining content…' : `Run ${REFINE_MODES.find((m) => m.id === refineMode)?.label || 'refine'}`}
              </button>
            </div>
          )}
          {categories.length > 0 && data && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {categories.map(([cat, issues]) => (
                <span key={cat} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${issues > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                  {cat} {issues > 0 && `· ${issues}`}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Word count vs target */}
      {item.targetWordCount ? (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            Word count <span className="tabular-nums text-slate-900">{wordCount.toLocaleString()}</span>
            <span className="text-slate-400 font-normal">/ target {item.targetWordCount.toLocaleString()}</span>
            <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${Math.abs(wordCount - item.targetWordCount) / item.targetWordCount <= 0.15 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
              {Math.abs(wordCount - item.targetWordCount) / item.targetWordCount <= 0.15 ? 'On target' : 'Off target'}
            </span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${Math.abs(wordCount - item.targetWordCount) / item.targetWordCount <= 0.15 ? 'bg-emerald-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min(100, (wordCount / item.targetWordCount) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Google SERP preview */}
      <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <Search className="w-3 h-3" /> Google result preview
        </div>
        <p className="text-[17px] leading-snug text-[#1a0dab] hover:underline cursor-pointer truncate font-medium">
          {(item.metaTitle || item.title || 'Untitled').slice(0, 60) || 'Meta title preview'}
        </p>
        <p className="text-xs text-[#006621] truncate">{serpUrl}</p>
        <p className="text-sm text-slate-600 leading-snug line-clamp-2">
          {(item.metaDescription || 'Meta description preview — aim for 120–160 characters.').slice(0, 160) || '…'}
        </p>
      </div>

      {/* Meta title */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-slate-400" /> Meta Title
          </label>
          <span className={`text-[11px] font-semibold tabular-nums ${titleLen > 60 ? 'text-red-500' : titleLen >= 50 ? 'text-emerald-600' : 'text-amber-500'}`}>
            {titleLen} / 50–60
          </span>
        </div>
        <input
          type="text"
          value={item.metaTitle || ''}
          onChange={(e) => onChange({ metaTitle: e.target.value })}
          placeholder="Start with your primary keyword…"
          className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none bg-slate-50 focus:bg-white transition ${titleLen > 60 ? 'border-red-300' : titleLen >= 50 ? 'border-emerald-300' : 'border-slate-200 focus:border-slate-400'}`}
        />
        <CountBar value={titleLen} min={50} max={60} hint="chars" />
      </div>

      {/* Meta description */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-slate-400" /> Meta Description
          </label>
          <span className={`text-[11px] font-semibold tabular-nums ${descLen > 160 ? 'text-red-500' : descLen >= 120 ? 'text-emerald-600' : 'text-amber-500'}`}>
            {descLen} / 120–160
          </span>
        </div>
        <textarea
          value={item.metaDescription || ''}
          onChange={(e) => onChange({ metaDescription: e.target.value })}
          rows={3}
          placeholder="Keyword + value promise + call to action…"
          className={`w-full px-4 py-2.5 rounded-xl border text-sm focus:outline-none bg-slate-50 focus:bg-white transition ${descLen > 160 ? 'border-red-300' : descLen >= 120 ? 'border-emerald-300' : 'border-slate-200 focus:border-slate-400'}`}
        />
        <CountBar value={descLen} min={120} max={160} hint="chars" />
      </div>

      {/* Keyphrase + intent */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-slate-400" /> Focus Keyphrase
          </label>
          <input
            type="text"
            value={item.primaryKeyword || ''}
            onChange={(e) => onChange({ primaryKeyword: e.target.value })}
            placeholder="e.g. dog walking"
            className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Search Intent</label>
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50 cursor-pointer"
          >
            {Object.entries(INTENT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Secondary keywords */}
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          Secondary Keywords <span className="font-normal text-slate-400">(comma separated)</span>
        </label>
        <input
          type="text"
          value={(item.secondaryKeywords || []).join(', ')}
          onChange={(e) => onChange({ secondaryKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
          placeholder="e.g. dog walking tips, puppy walking routine"
          className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
        />
      </div>

      {/* Slug */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-slate-400" /> URL Slug
          </label>
          <button
            onClick={() => onChange({ slug: slugify(item.title) })}
            className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition"
            title="Generate slug from title"
          >
            <Wand2 className="w-3 h-3" /> Suggest
          </button>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-3 focus-within:border-slate-400 transition">
          <span className="text-sm text-slate-400 truncate max-w-[40%]">{siteUrl ? siteUrl.replace(/^https?:\/\//, '') : 'site.com'}/</span>
          <input
            type="text"
            value={item.slug || ''}
            onChange={(e) => onChange({ slug: e.target.value })}
            placeholder={slugify(item.title) || 'your-url-slug'}
            className="flex-1 min-w-0 py-2.5 text-sm bg-transparent focus:outline-none"
          />
        </div>
      </div>

      {/* One-click fixes */}
      <button
        onClick={applySuggestions}
        disabled={!item.title}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40 text-xs font-semibold transition"
      >
        <Sparkles className="w-3.5 h-3.5" /> Auto-fill title tag &amp; slug from article
      </button>

      {/* Checklist */}
      {data && data.results.length > 0 && (
        <div className="pt-1 border-t border-slate-100 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-900 text-sm">Checklist</h3>
            <span className="text-[11px] text-slate-400">based on Google's current on-page guidelines</span>
          </div>

          {grouped.poor.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-red-500">To fix ({grouped.poor.length})</p>
              <div className="max-h-56 overflow-y-auto pr-1 space-y-2">
                {grouped.poor.map((r) => (
                  <div key={r.id} className={`rounded-xl bg-red-50/60 border border-red-100 p-3 ${STATUS_META[r.status].row}`}>
                    <div className="flex items-start gap-2">
                      {STATUS_META[r.status].icon}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800">{r.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{r.description}</p>
                      </div>
                      <button
                        onClick={() => handleRefine('check', [r])}
                        disabled={refining}
                        className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 disabled:opacity-40 transition"
                        title={`Fix: ${r.title}`}
                      >
                        Fix this
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {grouped.ok.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Could improve ({grouped.ok.length})</p>
              <div className="max-h-48 overflow-y-auto pr-1 space-y-2">
                {grouped.ok.map((r) => (
                  <div key={r.id} className={`rounded-xl bg-amber-50/60 border border-amber-100 p-3 ${STATUS_META[r.status].row}`}>
                    <div className="flex items-start gap-2">
                      {STATUS_META[r.status].icon}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-800">{r.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">{r.description}</p>
                      </div>
                      <button
                        onClick={() => handleRefine('check', [r])}
                        disabled={refining}
                        className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg bg-amber-100 text-amber-600 hover:bg-amber-200 disabled:opacity-40 transition"
                        title={`Improve: ${r.title}`}
                      >
                        Improve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <button
              onClick={() => setShowPassed((s) => !s)}
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 transition"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Passing ({grouped.good.length}) {showPassed ? '▾' : '▸'}
            </button>
            {showPassed && (
              <div className="mt-2 max-h-40 overflow-y-auto pr-1 space-y-1.5">
                {grouped.good.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 rounded-lg bg-emerald-50/50 border border-emerald-100 p-2.5">
                    {STATUS_META[r.status].icon}
                    <p className="text-[11px] text-slate-600">{r.title}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
