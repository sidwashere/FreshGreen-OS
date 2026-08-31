import React, { useEffect, useRef } from 'react';
import { CheckCircle2, AlertTriangle, Clock, Shield, BookOpen, ListChecks, ChevronDown, ChevronUp, Sparkles, PenLine, Eye } from 'lucide-react';

/** Maps rule id to a consistent icon and colour. */
const RULE_META: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  noAndButStarts: { icon: ListChecks, color: 'text-red-600', bg: 'bg-red-50' },
  britishEnglish:  { icon: BookOpen,   color: 'text-emerald-600', bg: 'bg-emerald-50' },
  naturalFlow:     { icon: Sparkles,   color: 'text-violet-600', bg: 'bg-violet-50' },
  noRepetition:    { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  noAiClichés:     { icon: Eye,        color: 'text-sky-600',   bg: 'bg-sky-50' },
  shortSentences:  { icon: PenLine,    color: 'text-cyan-600',  bg: 'bg-cyan-50' },
  publishReady:    { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  custom:          { icon: ListChecks, color: 'text-indigo-600', bg: 'bg-indigo-50' },
};

interface GenRule {
  id: string;
  label: string;
  description: string;
}

interface HistoryEntry {
  message: string;
  percent: number;
  at: number;
}

interface GenerationInfoPanelProps {
  genState: {
    phase: string;
    percent: number;
    words: number;
    elapsed: number;
    stalled: boolean;
    generationInfo: {
      brand: { name: string; voiceGuidelines: string } | null;
      primaryKeyword: string;
      secondaryKeywords: string[];
      targetWordCount: number;
      seoBrief: string;
      contentType: string;
      bannedWords: string[];
      grammarRules: GenRule[];
      grammarRulesPrompt: string | null;
      wordTarget: string;
    } | null;
    history: HistoryEntry[];
  };
  brandColor?: string;
  targetWordCount?: number;
  onCancel?: () => void;
}

export const GenerationInfoPanel: React.FC<GenerationInfoPanelProps> = ({
  genState,
  brandColor = '#6366f1',
  targetWordCount,
  onCancel,
}) => {
  const { phase, percent, words, elapsed, stalled, generationInfo, history } = genState;
  const [rulesOpen, setRulesOpen] = React.useState(true);
  const [historyOpen, setHistoryOpen] = React.useState(true);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll history to bottom when new entries arrive
  useEffect(() => {
    if (historyOpen && historyEndRef.current) {
      historyEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [history.length, historyOpen]);

  const brand = generationInfo?.brand;
  const grammarRules = generationInfo?.grammarRules || [];
  const bannedWords = generationInfo?.bannedWords || [];
  const primaryKeyword = generationInfo?.primaryKeyword;
  const secondaryKeywords = generationInfo?.secondaryKeywords || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* ── Top bar: live phase + progress ─────────────────────────────── */}
      <div className="p-4 space-y-3 border-b border-slate-100">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              {!stalled && (
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                  style={{ backgroundColor: brandColor }}
                />
              )}
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ backgroundColor: stalled ? '#f59e0b' : brandColor }}
              />
            </span>
            <span className="text-sm font-bold text-slate-800 truncate">
              {stalled ? '⚠ Waiting on the model…' : phase}
            </span>
          </div>
          <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
            {percent}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.max(2, percent)}%`,
              backgroundColor: stalled ? '#f59e0b' : brandColor,
            }}
          />
        </div>

        {/* Words + elapsed */}
        <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-500">
          <span className="tabular-nums">
            {words.toLocaleString()} words written
            {targetWordCount ? ` · target ${targetWordCount.toLocaleString()}` : ''}
          </span>
          <span className={`tabular-nums font-semibold ${stalled ? 'text-amber-600' : 'text-slate-400'}`}>
            {elapsed}s elapsed · {stalled ? `> 45s ago` : 'live'}
          </span>
        </div>

        {/* Stalled warning */}
        {stalled && (
          <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
            No updates for 45+ seconds. The model may be slow (quota pressure) — keep waiting or cancel and retry.
          </div>
        )}

        {/* Cancel */}
        <div className="flex items-center justify-end">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition"
            >
              Cancel generation
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-slate-100 lg:divide-y-0 lg:divide-x lg:grid-cols-2">
        {/* ── LEFT: Active rules + parameters being applied ─────────────── */}
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              Rules &amp; Parameters
            </h3>
            <button
              onClick={() => setRulesOpen((o) => !o)}
              className="text-slate-400 hover:text-slate-600 transition"
            >
              {rulesOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {rulesOpen && (
            <div className="space-y-2.5">
              {/* Brand */}
              {brand && (
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <p className="text-[10px] font-bold text-slate-500 uppercase mb-0.5">Brand Voice</p>
                  <p className="text-xs text-slate-700 leading-relaxed">{brand.name}</p>
                  {brand.voiceGuidelines && (
                    <p className="text-[10px] text-slate-400 mt-0.5 italic leading-relaxed line-clamp-2">
                      "{brand.voiceGuidelines}"
                    </p>
                  )}
                </div>
              )}

              {/* Primary keyword */}
              {primaryKeyword && (
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 mt-0.5 shrink-0">🔑</span>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500">Primary Keyword</p>
                    <p className="text-xs font-semibold text-slate-700">{primaryKeyword}</p>
                  </div>
                </div>
              )}

              {/* Secondary keywords */}
              {secondaryKeywords.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <span className="text-[10px] font-bold text-slate-500 mt-0.5 shrink-0">🔑</span>
                  <div>
                    <p className="text-[10px] font-bold text-slate-500">Secondary Keywords</p>
                    <p className="text-xs text-slate-700">{secondaryKeywords.slice(0, 5).join(' · ')}</p>
                  </div>
                </div>
              )}

              {/* Target word count */}
              {generationInfo?.targetWordCount > 0 && (
                <div className="flex items-start gap-1.5">
                  <PenLine className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[10px] font-bold text-slate-500">Target Word Count</p>
                    <p className="text-xs font-semibold text-slate-700">{generationInfo.targetWordCount.toLocaleString()} words</p>
                  </div>
                </div>
              )}

              {/* Banned words */}
              {bannedWords.length > 0 && (
                <div className="flex items-start gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-slate-500 mb-0.5">Banned Words (AI must avoid)</p>
                    <div className="flex flex-wrap gap-1">
                      {bannedWords.slice(0, 8).map((w) => (
                        <span key={w} className="inline-block px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-bold border border-red-100">
                          {w}
                        </span>
                      ))}
                      {bannedWords.length > 8 && (
                        <span className="text-[10px] text-slate-400">+{bannedWords.length - 8} more</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Grammar & Style Rules */}
              {grammarRules.length > 0 ? (
                <div>
                  <p className="text-[10px] font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <ListChecks className="w-3 h-3 text-emerald-500" />
                    Grammar &amp; Style Rules ({grammarRules.length} active)
                  </p>
                  <div className="space-y-1">
                    {grammarRules.map((rule) => {
                      const meta = RULE_META[rule.id] || RULE_META.custom;
                      const Icon = meta.icon;
                      return (
                        <div key={rule.id} className={`flex items-start gap-1.5 p-1.5 rounded-lg ${meta.bg}`}>
                          <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${meta.color}`} />
                          <div>
                            <p className={`text-[10px] font-bold ${meta.color}`}>{rule.label}</p>
                            <p className="text-[10px] text-slate-500 leading-relaxed">{rule.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-500">
                  <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  Gathering generation parameters…
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Live history timeline ──────────────────────────────── */}
        <div className="p-4 space-y-3 bg-slate-50/50">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Generation History
            </h3>
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="text-slate-400 hover:text-slate-600 transition"
            >
              {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          {historyOpen ? (
            <div className="space-y-0 max-h-64 overflow-y-auto pr-1">
              {history.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-xs text-slate-400 italic">
                  Waiting for first step…
                </div>
              ) : (
                history.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2">
                    {/* Connector line */}
                    <div className="flex flex-col items-center shrink-0">
                      <div
                        className="w-2 h-2 rounded-full mt-1.5 ring-2 ring-white"
                        style={{ backgroundColor: i === history.length - 1 ? brandColor : '#cbd5e1' }}
                      />
                      {i < history.length - 1 && (
                        <div className="w-px flex-1 bg-slate-200 my-0.5 min-h-[12px]" />
                      )}
                    </div>
                    {/* Entry */}
                    <div className="flex-1 min-w-0 pb-2">
                      <p className={`text-[11px] leading-relaxed ${i === history.length - 1 ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                        {entry.message}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-mono text-slate-400">
                          {entry.percent}%
                        </span>
                        {entry.at && (
                          <span className="text-[9px] text-slate-400">
                            +{Math.round((Date.now() - entry.at) / 1000)}s
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={historyEndRef} />
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic">
              {history.length} step{history.length !== 1 ? 's' : ''} recorded
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
