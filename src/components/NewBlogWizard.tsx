import React, { useEffect, useMemo, useState } from 'react';
import { Brand } from '../types';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Globe,
  FileText,
  Tag,
  Check,
  Lightbulb,
  PenLine,
  SearchCheck,
  Rocket,
  Hash,
} from 'lucide-react';

interface NewBlogWizardProps {
  open: boolean;
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
  onCreateNewItem: (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[]; seoBrief?: string }
  ) => void;
  onClose: () => void;
}

const WIZARD_STEPS = [
  { label: 'Brand & Type', icon: Globe },
  { label: 'Title & Keywords', icon: Tag },
  { label: 'Confirm & Create', icon: Check },
];

/**
 * Unified "New Blog" wizard — the single step-by-step entry point for every
 * manual creation trigger (Dashboard, Content Hub, ZenEditor empty state).
 * Each step has a working Back / Next button; Next validates the step before
 * advancing, and the final step creates the item and opens the editor.
 */
export const NewBlogWizard: React.FC<NewBlogWizardProps> = ({
  open,
  brands,
  selectedBrandId,
  onSelectBrand,
  onCreateNewItem,
  onClose,
}) => {
  const [step, setStep] = useState(0);
  const [brandId, setBrandId] = useState(selectedBrandId !== 'all' ? selectedBrandId : brands[0]?.id || '');
  const [contentType, setContentType] = useState<'post' | 'page'>('post');
  const [title, setTitle] = useState('');
  const [primaryKeyword, setPrimaryKeyword] = useState('');
  const [secondaryKeywords, setSecondaryKeywords] = useState('');
  const [seoBrief, setSeoBrief] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Reset the wizard whenever it opens.
  useEffect(() => {
    if (open) {
      setStep(0);
      setBrandId(selectedBrandId !== 'all' ? selectedBrandId : brands[0]?.id || '');
      setContentType('post');
      setTitle('');
      setPrimaryKeyword('');
      setSecondaryKeywords('');
      setSeoBrief('');
      setError(null);
      setCreating(false);
    }
  }, [open, selectedBrandId, brands]);

  const brand = brands.find((b) => b.id === brandId) || null;
  const bc = brand?.primaryColor || '#4f46e5';

  // Per-step validation — Next is disabled until the step is complete.
  const stepValid = useMemo(() => {
    if (step === 0) return !!brandId;
    if (step === 1) return title.trim().length >= 3;
    return true;
  }, [step, brandId, title]);

  const stepHint = useMemo(() => {
    if (step === 0) return 'Pick which site this blog belongs to and whether it is a post or a landing page.';
    if (step === 1) return 'Give the blog a working title — keywords and the SEO brief are optional but recommended.';
    return 'Review the plan below, then create the blog and open it in the editor.';
  }, [step]);

  const handleNext = () => {
    setError(null);
    if (!stepValid) {
      setError(step === 0 ? 'Choose a brand to continue.' : 'Give the blog a title (at least 3 characters).');
      return;
    }
    if (step < WIZARD_STEPS.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    setError(null);
    if (step > 0) setStep(step - 1);
  };

  const handleCreate = () => {
    if (!brandId || !title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      onCreateNewItem(
        title.trim(),
        brandId,
        contentType,
        {
          primaryKeyword: primaryKeyword.trim() || undefined,
          secondaryKeywords: secondaryKeywords.split(',').map((k) => k.trim()).filter(Boolean),
          seoBrief: seoBrief.trim() || undefined,
        },
      );
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create the blog.');
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5" style={{ color: bc }} />
              New Blog — Step {step + 1} of {WIZARD_STEPS.length}
            </h2>
            <p className="text-[12px] text-slate-500 mt-1">{stepHint}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition p-1"
            title="Close wizard"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 flex items-center gap-2">
          {WIZARD_STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isDone = idx < step;
            const isCurrent = idx === step;
            return (
              <React.Fragment key={s.label}>
                {idx > 0 && (
                  <div className={`flex-1 h-0.5 rounded-full ${isDone || isCurrent ? '' : 'bg-slate-200'}`}
                    style={isDone || isCurrent ? { backgroundColor: bc } : undefined} />
                )}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                      isCurrent ? 'text-white shadow-md' : isDone ? 'text-white' : 'bg-slate-100 text-slate-400 border border-slate-200'
                    }`}
                    style={isCurrent || isDone ? { backgroundColor: bc } : undefined}
                  >
                    {isDone ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                  </div>
                  <span className={`text-[10px] font-bold whitespace-nowrap ${isCurrent ? '' : isDone ? 'text-emerald-600' : 'text-slate-400'}`}
                    style={isCurrent ? { color: bc } : undefined}>
                    {s.label}
                  </span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {step === 0 && (
            <>
              <div>
                <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Target Brand Property
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {brands.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setBrandId(b.id)}
                      className={`px-4 py-3 rounded-xl border text-left transition ${
                        brandId === b.id
                          ? 'border-transparent text-white shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={brandId === b.id ? { backgroundColor: b.primaryColor || bc } : undefined}
                    >
                      <span className="block text-[13px] font-bold">{b.name}</span>
                      <span className={`block text-[10px] mt-0.5 ${brandId === b.id ? 'text-white/80' : 'text-slate-400'}`}>
                        {b.wpUrl?.replace(/^https?:\/\//, '') || b.slug}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Publish Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(['post', 'page'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setContentType(t)}
                      className={`py-3 rounded-xl text-sm font-bold border transition ${
                        contentType === t
                          ? 'text-white border-transparent shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                      style={contentType === t ? { backgroundColor: bc } : undefined}
                    >
                      {t === 'post' ? '📝 Blog Post' : '📄 Landing Page'}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                  Topic or Working Title <span className="text-red-500">*</span>
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. 10 Natural Dog Treats for Digestive Health"
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:outline-none placeholder:text-slate-400"
                  style={{ ['--tw-ring-color' as any]: bc }}
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Primary Keyword
                  </label>
                  <input
                    value={primaryKeyword}
                    onChange={(e) => setPrimaryKeyword(e.target.value)}
                    placeholder="e.g. natural dog treats UK"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                    Secondary Keywords
                  </label>
                  <input
                    value={secondaryKeywords}
                    onChange={(e) => setSecondaryKeywords(e.target.value)}
                    placeholder="Comma-separated, e.g. grain-free treats, puppy snacks"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                  SEO Brief <span className="text-slate-400 font-medium normal-case">(optional)</span>
                </label>
                <textarea
                  value={seoBrief}
                  onChange={(e) => setSeoBrief(e.target.value)}
                  placeholder="Who is this for, what should it cover, what angle to take…"
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:outline-none resize-none"
                />
              </div>
              <p className="text-[11px] text-slate-400">
                Skip the keywords and the inbuilt SEO tool will still analyse, score and refine the post automatically.
              </p>
            </>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Brand</span>
                  <span className="text-[13px] font-bold text-slate-800">{brand?.name || '—'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Type</span>
                  <span className="text-[13px] font-bold text-slate-800">{contentType === 'post' ? '📝 Blog Post' : '📄 Landing Page'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Title</span>
                  <span className="text-[13px] font-bold text-slate-800 text-right max-w-[60%]">{title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Primary Keyword</span>
                  <span className="text-[13px] font-semibold text-slate-700 text-right max-w-[60%]">{primaryKeyword.trim() || '— (auto-derived)'}</span>
                </div>
                {secondaryKeywords.trim() && (
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Secondary</span>
                    <span className="text-[12px] font-semibold text-slate-600 text-right max-w-[60%]">
                      {secondaryKeywords.split(',').map((k) => k.trim()).filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Blog number</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-mono text-[12px] font-bold"
                    style={{ backgroundColor: `${bc}18`, color: bc }}>
                    <Hash className="w-3 h-3" /> {brand?.brandCode || brand?.slug?.slice(0, 3).toUpperCase() || 'BR'}·next
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                The blog number is issued automatically (duplicate-proof) when the item is created, and the
                Blog Register entry is written in the same atomic batch.
              </p>
            </div>
          )}

          {error && (
            <div className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-[12px] font-semibold text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer: Back / Next */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <button
            onClick={handleBack}
            disabled={step === 0 || creating}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold text-slate-600 hover:bg-slate-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={creating}
              className="px-4 py-2.5 rounded-xl text-[13px] font-semibold text-slate-500 hover:bg-slate-100 transition disabled:opacity-40"
            >
              Cancel
            </button>
            {step < WIZARD_STEPS.length - 1 ? (
              <button
                onClick={handleNext}
                disabled={!stepValid || creating}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                style={{ backgroundColor: bc }}
              >
                Next Step <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition hover:brightness-110 disabled:opacity-60 disabled:cursor-wait shadow-sm"
                style={{ backgroundColor: bc }}
              >
                {creating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Rocket className="w-4 h-4" /> Create & Open Editor
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};