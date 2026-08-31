import { fetchGlobalKeys, fetchAiPref, saveAiPref, AI_MODEL_OPTIONS } from "../lib/keys";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ContentItem, Brand, VisualBlock, VisualBlockType, PipelineStatus, GenerationLogEntry, AiModelPref, BlockTune, CardItem, CarouselSlide } from '../types';
import { figureHtmlFor as figureHtmlForLib, rebuildArticleHtml, syncImageMarkers } from '../lib/blogHtml';
import { countWords, deriveWpState, syncItemToWp, refreshWpState } from '../lib/wpSync';
import { SeoPanel } from './SeoPanel';
import { GenerationInfoPanel } from './GenerationInfoPanel';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Eye, 
  EyeOff,
  Save, 
  Send, 
  Trash2, 
  Layout, 
  Code, 
  ExternalLink,
  RefreshCw,
  ImagePlus,
  Check,
  Lightbulb,
  Compass,
  PenLine,
  SearchCheck,
  Rocket,
  ArrowRight,
  AlertTriangle,
  ClipboardList,
  ArrowUp,
  ArrowDown,
  Plus,
  XCircle,
  CheckCircle2,
  Layers,
  Monitor,
  Smartphone,
  Loader2,
  Pencil,
  Wand2,
  Target,
  Upload,
  GripVertical,
  SlidersHorizontal,
  Calendar
} from 'lucide-react';

// Blog production workflow — the order every post moves through
const WORKFLOW_STAGES = [
  { status: 'Planned', label: 'Plan', icon: Lightbulb, hint: 'Idea, outline & keyword brief' },  { status: 'Researching', label: 'Research', icon: Compass, hint: 'Competitor & source research' },
  { status: 'Generating', label: 'Write', icon: PenLine, hint: 'Auto-write & structure content' },
  { status: 'Draft_Ready', label: 'Review', icon: SearchCheck, hint: 'SEO audit & final polish' },
  { status: 'Published', label: 'Live', icon: Rocket, hint: 'Synced to WordPress' },
] as const;

/** Compact timestamp for the history rows: time for today, date + time older. */
const formatLogTime = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
};

// Brand-color helpers: the editor inherits the brand's primary color so switching
// brands is visually unmistakable. Tailwind can't generate runtime colors, so we
// derive tints from the brand hex inline.
const brandColor = (b?: Brand | null) => b?.primaryColor || '#4f46e5';
const withAlpha = (hex: string, alpha: number) => {
  const h = (hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(79, 70, 229, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// Article length presets. "SEO Recommended" (900) is the default — it maps to
// the minimum SEO-recommended body text volume (~800–1200 words per post).
const LENGTH_PRESETS = [
  { label: 'Snappy · 500', w: 500 },
  { label: 'SEO Recommended · 900', w: 900 },
  { label: 'Long · 1500', w: 1500 },
  { label: 'Deep Dive · 2500', w: 2500 },
];

interface ZenEditorProps {
  item?: ContentItem | null;
  brand: Brand;
  onSaveItem: (updatedItem: ContentItem) => Promise<void> | void;
  onSyncToWP: (contentItem: ContentItem) => Promise<void>;
  onCreateNewItem?: (
    title: string,
    brandId: string,
    contentType: 'post' | 'page',
    opts?: { primaryKeyword?: string; secondaryKeywords?: string[] }
  ) => void;
  /** All content items for the workspace — used to build the brand's real
   * "related articles" list for dynamic template field population. */
  items?: ContentItem[];
}

export const ZenEditor: React.FC<ZenEditorProps> = ({
  item,
  brand,
  onSaveItem,
  onSyncToWP,
  onCreateNewItem,
  items = [],
}) => {
  const [editingItem, setEditingItem] = useState<ContentItem | null>(item || null);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [newDraftType, setNewDraftType] = useState<'post' | 'page'>('post');
  const [applyHumanization, setApplyHumanization] = useState(true);
  // Workflow steps: Brief -> Write -> SEO -> Visuals -> Publish
  const [stepTab, setStepTab] = useState<'brief' | 'write' | 'seo' | 'visuals' | 'publish'>('write');
  const [writeMode, setWriteMode] = useState<'visual' | 'html'>('visual');
  // User-stated block hints for Auto-Write: which content blocks the engine
  // should include (image wraps, product showcases, CTA bands, cards, quotes,
  // callouts, Daniel's Tips, newsletters, FAQs…). The engine auto-detects the
  // rest; these take priority.
  const [requestedBlocks, setRequestedBlocks] = useState<string[]>([]);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  // Live generation transparency: percentage, phase message, the model's text
  // as it writes, heartbeat info, plus the full generation blueprint (rules,
  // parameters) and a live history timeline of every step taken.
  const [genState, setGenState] = useState<{
    phase: string;
    percent: number;
    words: number;
    text: string;
    elapsed: number;
    lastUpdate: number;
    stalled: boolean;
    generationInfo: {
      brand: { name: string; voiceGuidelines: string } | null;
      primaryKeyword: string;
      secondaryKeywords: string[];
      targetWordCount: number;
      seoBrief: string;
      contentType: string;
      bannedWords: string[];
      grammarRules: { id: string; label: string; description: string }[];
      grammarRulesPrompt: string | null;
      wordTarget: string;
    } | null;
    history: { message: string; percent: number; at: number }[];
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Interactive humanisation: original vs humanised draft, user picks a version.
  const [humanizeDraft, setHumanizeDraft] = useState<{
    original: string;
    humanized: string;
    blocks: any[];
    changed: boolean;
    note?: string;
  } | null>(null);
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [humanizeError, setHumanizeError] = useState<string | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
  // Real "related articles" for the current brand — published content items from
  // the workspace register. Passed to the server so the generated article can
  // populate the template's related-articles / internal-link sections with real
  // existing content instead of invented paths.
  const relatedArticles = useMemo(() => {
    return items
      .filter((i) => i.brandId === brand.id && i.id !== editingItem?.id && i.status === 'Published')
      .map((i) => ({ title: i.title, slug: i.slug, primaryKeyword: i.primaryKeyword || '' }))
      .slice(0, 8);
  }, [items, brand.id, editingItem?.id]);
  // Watchdog: warns when no progress arrived for a while, auto-aborts if truly stuck.
  useEffect(() => {
    if (!isGeneratingAi) return;
    lastUpdateRef.current = Date.now();
    const id = setInterval(() => {
      const quiet = Date.now() - lastUpdateRef.current;
      setGenState((prev) => (prev ? { ...prev, elapsed: Math.round((Date.now() - prev.lastUpdate) / 1000) } : prev));
      if (quiet > 45000) {
        setGenState((prev) => (prev && !prev.stalled ? { ...prev, stalled: true } : prev));
      }
      if (quiet > 120000) {
        abortRef.current?.abort();
        setIsGeneratingAi(false);
        setGenState(null);
        setAiError('No progress from the model for 2 minutes — generation was cancelled. Please retry.');
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isGeneratingAi]);
  const [isSyncingWp, setIsSyncingWp] = useState(false);
  // Inline AI error banner (instead of a blocking native alert)
  const [aiError, setAiError] = useState<string | null>(null);
  
  const [nanoPrompts, setNanoPrompts] = useState<any[]>([]);
  const [visualCatFilter, setVisualCatFilter] = useState<string>('All');
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  // Meta about the last rendered featured image (used to surface placeholder
  // fallbacks so the user knows the image is NOT a real AI render).
  const [nanoImageMeta, setNanoImageMeta] = useState<{ isPlaceholder?: boolean; message?: string; provider?: string; model?: string; isAiGenerated?: boolean } | null>(null);
  // Editable image prompt: seeded from the article's suggested prompt or a
  // library concept, editable before rendering, and refinable via AI so the
  // final image always matches the blog topic.
  const [imagePromptText, setImagePromptText] = useState<string>('');
  const [selectedPromptIdx, setSelectedPromptIdx] = useState<number | null>(null);
  const [isRefiningPrompt, setIsRefiningPrompt] = useState(false);
  // Drag-and-drop block reordering (visual blocks mode)
  const [dragBlockIdx, setDragBlockIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [blockRewriteDirections, setBlockRewriteDirections] = useState<Record<string, string>>({});
  const [isRewritingBlock, setIsRewritingBlock] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving...' | 'Edited'>('Saved');
  const [liveSeoPct, setLiveSeoPct] = useState<number | null>(null);
  // Runtime AI model preference: which provider/model runs every AI action,
  // persisted to localStorage so it applies instantly across the editor.
  const [aiPref, setAiPrefState] = useState<AiModelPref>(() => fetchAiPref());
  const setAiPref = (p: AiModelPref) => { saveAiPref(p); setAiPrefState(p); };
  // --- Enhance Existing mode: toggle between Generate New and Enhance Existing
  const [editorMode, setEditorMode] = useState<'generate' | 'enhance'>('generate');
  // Product picker: live WooCommerce products for product_cta blocks.
  const [shopProducts, setShopProducts] = useState<any[] | null>(null);
  const [productPickerFor, setProductPickerFor] = useState<number | null>(null);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [enhanceUrl, setEnhanceUrl] = useState('');
  const [enhanceUrlLoading, setEnhanceUrlLoading] = useState(false);
  const [enhanceUrlError, setEnhanceUrlError] = useState('');
  // Generation history: timestamped, model-attributed record of every AI action.
  const logGeneration = (entry: GenerationLogEntry) => {
    setEditingItem((prev) => ({
      ...prev,
      generationLog: [entry, ...(prev.generationLog || [])].slice(0, 30),
    }));
  };
  // Sticky generation-history panel (top-right below the tabs) — expanded by
  // default so the latest activity is always visible while working.
  const [historyOpen, setHistoryOpen] = useState(true);
  // Unified post preview: renders the post exactly as it appears on the site
  // (live published page, WP draft render, or local content in the site's theme).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<{ html: string; mode: 'live' | 'draft' | 'local'; url?: string; fallback?: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  // Brief tab controls
  const [newSecondaryKeyword, setNewSecondaryKeyword] = useState('');

  // Live word count from the article body (HTML stripped)
  const wordCount = useMemo(() => {
    const plain = (editingItem?.bodyHtml || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain ? plain.split(' ').filter(Boolean).length : 0;
  }, [editingItem?.bodyHtml]);

  const editingItemRef = useRef<ContentItem | null>(editingItem);
  useEffect(() => { editingItemRef.current = editingItem; }, [editingItem]);

  useEffect(() => {
    if (!item) {
      setEditingItem(null);
      return;
    }
    // Switching brands/items: flush any unsaved edits to the outgoing item
    // before loading the incoming one.
    const prev = editingItemRef.current;
    if (prev && prev !== item && prev.id !== item.id) {
      onSaveItem(prev).catch(() => {});
    }
    setEditingItem(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  useEffect(() => {
    if (!editingItem || editingItem === item) return;
    setSaveStatus('Edited');
    
    const timeoutId = setTimeout(async () => {
      setSaveStatus('Saving...');
      await onSaveItem(editingItem);
      setSaveStatus('Saved');
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [editingItem]);

  const handleSave = async () => {
    setSaveStatus('Saving...');
    await onSaveItem(editingItem);
    setSaveStatus('Saved');
  };

  // Workflow stepper: current index + explicit stage change (auto-saved by effect)
  const currentStageIdx = WORKFLOW_STAGES.findIndex((s) => s.status === editingItem?.status);
  const handleSetStage = (status: PipelineStatus) => {
    if (editingItem.status === status) return;
    setEditingItem((prev) => ({
      ...prev,
      status,
      updatedAt: new Date().toISOString(),
    }));
  };
  const nextStage = currentStageIdx >= 0 && currentStageIdx < WORKFLOW_STAGES.length - 1
    ? WORKFLOW_STAGES[currentStageIdx + 1]
    : null;

  // Publish step: pre-flight checklist
  const publishChecks = [
    { label: 'Article title set', ok: !!editingItem?.title?.trim(), optional: false },
    { label: 'Content written (50+ words)', ok: wordCount >= 50, optional: false },
    { label: 'Focus keyphrase set', ok: !!editingItem?.primaryKeyword?.trim(), optional: false },
    { label: 'SEO score ≥ 60', ok: liveSeoPct !== null && liveSeoPct >= 60, warn: liveSeoPct !== null && liveSeoPct < 60, na: liveSeoPct === null, optional: false },
    { label: 'Featured image', ok: !!editingItem?.featuredImageUrl, optional: true },
    { label: 'WordPress credentials', ok: !!(brand?.wpUrl && brand?.wpAppPassword), optional: false },
  ];
  const publishReady = publishChecks.filter((c) => !c.optional).every((c) => c.ok);
  // Saving a WP draft is a WIP action — only content + credentials required
  // (no SEO score gate), so drafts can be parked at any point in the flow.
  const draftReady = !!editingItem?.title?.trim() && wordCount >= 50 && !!(brand?.wpUrl && brand?.wpAppPassword);

  // Current state of the post ON WORDPRESS, derived from the last sync:
  //  - 'live':  synced and published — visitors can see it
  //  - 'draft': synced as a draft — hidden on the site
  //  - 'none':  never synced to WordPress yet
  const wpState: 'live' | 'draft' | 'none' = deriveWpState(editingItem);
  const wpBase = brand?.wpUrl ? brand.wpUrl.replace(/\/+$/, '') : '';
  const wpSlug = editingItem?.slug || '';
  const wpLiveUrl = editingItem?.wpLiveUrl || (wpState === 'live' && wpBase && editingItem?.wpPostId ? `${wpBase}/?p=${editingItem.wpPostId}` : '');
  const wpPreviewUrl = editingItem?.wpPreviewUrl || (wpBase && editingItem?.wpPostId ? `${wpBase}/?p=${editingItem.wpPostId}&preview=true` : '');

  const visualCats = ['All', 'Product Focused', 'Lifestyle Focused', 'Abstract Minimalist'];
  const filteredNanoPrompts = (nanoPrompts || []).filter(
    (p) => visualCatFilter === 'All' || p.category === visualCatFilter
  );

  const handleGenerateWithGemini = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    lastUpdateRef.current = Date.now();
    setGenState({ phase: 'Connecting…', percent: 2, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] });
    const abort = new AbortController();
    abortRef.current = abort;
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/generate-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingItem.title,
          contentType: editingItem.contentType,
          primaryKeyword: editingItem.primaryKeyword,
          secondaryKeywords: editingItem.secondaryKeywords,
          seoBrief: editingItem.seoBrief,
          brand,
          byokKeys,
          // Humanisation is a separate step now: generation always returns the
          // raw draft, then the user compares before/after and picks a version.
          applyHumanization: false,
          targetWordCount: editingItem.targetWordCount,
          modelPref: aiPref,
          requestedBlocks,
          relatedArticles,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText?.slice(0, 200) || `Generation failed (HTTP ${res.status}).`);
      }

      // NDJSON stream: {"type":"status"|"stream"|"heartbeat"|"done"|"error"|"generationInfo", ...}
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamedText = '';
      let completed = false;
      let streamError: string | null = null;

      const handleEvent = (evt: any) => {
        if (evt.type === 'generationInfo') {
          // Capture the full generation blueprint — rules, parameters, brand voice.
          lastUpdateRef.current = Date.now();
          setGenState((prev) => ({
            ...(prev || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] }),
            generationInfo: evt,
            history: prev?.history || [],
          }));
        } else if (evt.type === 'status') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              phase: evt.message || evt.phase || '',
              percent: evt.percent ?? prev.percent,
              stalled: false,
              history: [
                ...prev.history,
                { message: evt.message || '', percent: evt.percent ?? prev.percent, at: Date.now() },
              ],
            };
          });
        } else if (evt.type === 'stream') {
          lastUpdateRef.current = Date.now();
          streamedText += evt.text || '';
          setGenState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              phase: evt.phase || prev.phase || 'Writing…',
              percent: evt.percent ?? prev.percent,
              words: evt.words ?? countWords(streamedText),
              text: streamedText,
              stalled: false,
              history: evt.phase ? [
                ...prev.history,
                { message: evt.phase, percent: evt.percent ?? prev.percent, at: Date.now() },
              ] : prev.history,
            };
          });
        } else if (evt.type === 'heartbeat') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => (prev ? { ...prev, elapsed: evt.elapsed ?? prev.elapsed, stalled: false } : prev));
        } else if (evt.type === 'image') {
          // Auto-generated Nano Banana image (paid chain) from Phase 2.5 —
          // hero is the featured image, secondary is the in-body image.
          lastUpdateRef.current = Date.now();
          const img = evt as any;
          if (img.role === 'hero') {
            setEditingItem((prev) => ({
              ...prev,
              featuredImageUrl: img.url || prev?.featuredImageUrl,
              featuredMediaId: typeof img.mediaId === 'number' ? img.mediaId : prev?.featuredMediaId,
              nanoBananaPrompt: img.prompt || prev?.nanoBananaPrompt,
              updatedAt: new Date().toISOString(),
            }));
            setNanoImageMeta({
              isPlaceholder: !!img.isPlaceholder,
              message: img.message,
              provider: img.provider,
              model: img.model,
              isAiGenerated: !!img.isAiGenerated,
            });
          } else if (img.role === 'secondary') {
            setEditingItem((prev) => ({
              ...prev,
              secondaryImageUrl: img.url || prev?.secondaryImageUrl,
              updatedAt: new Date().toISOString(),
            }));
          }
          setGenState((prev) => (prev ? {
            ...prev,
            phase: img.role === 'hero' ? 'Hero image ready — rendering in-body image…' : 'Both AI images ready.',
            percent: img.role === 'hero' ? 90 : 92,
            stalled: false,
            history: [
              ...prev.history,
              { message: img.role === 'hero' ? 'Hero image ready — rendering in-body image…' : 'Both AI images ready.', percent: img.role === 'hero' ? 90 : 92, at: Date.now() },
            ],
          } : prev));
        } else if (evt.type === 'imageWarning') {
          lastUpdateRef.current = Date.now();
          const w = evt as any;
          console.warn(`[Images] ${w.role} warning:`, w.message);
          setGenState((prev) => (prev ? { ...prev, phase: `${w.role === 'hero' ? 'Hero' : 'In-body'} image failed (${w.message || 'model error'}) — draft still completes.`, stalled: false } : prev));
        } else if (evt.type === 'error') {
          // Record the REAL error instead of throwing here — the caller wraps
          // handleEvent in a catch that would swallow the exception and surface
          // a generic "connection closed" message.
          streamError = evt.error || 'Generation failed.';
        } else if (evt.type === 'done') {
          completed = true;
          applyGeneratedArticle(evt.data || {});
          const d = evt.data || {};
          logGeneration({
            at: new Date().toISOString(),
            action: 'Auto-Write',
            provider: d.provider || 'gemini',
            model: d.model || aiPref.model,
            fallback: !!d.fallback,
            words: d.wordCount,
            durationMs: d.latencyMs,
            ok: true,
          });
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
          try {
            handleEvent(JSON.parse(line));
          } catch (e: any) {
            if (e?.message && e.message !== 'Generation failed.') console.warn('Bad stream event:', line.slice(0, 120));
          }
        }
        if (streamError) break;
      }

      if (streamError) {
        throw new Error(streamError);
      }
      if (!completed && !abort.signal.aborted) {
        throw new Error('Connection closed before generation finished. Please retry.');
      }
    } catch (e: any) {
      if (abort.signal.aborted) {
        setAiError('Generation cancelled.');
      } else {
        console.error('Error generating article:', e);
        setAiError(e?.message || 'Generation failed. Please try again.');
        logGeneration({
          at: new Date().toISOString(),
          action: 'Auto-Write',
          provider: aiPref.provider,
          model: aiPref.model,
          ok: false,
          error: (e?.message || 'Generation failed').slice(0, 200),
        });
      }
    } finally {
      setIsGeneratingAi(false);
      setGenState(null);
      abortRef.current = null;
    }
  };

  // Apply the finished article (html, metadata + blocks) to the draft. Blocks
  // are guaranteed by the server (derived from the final HTML), with a local
  // safety net so the Blocks view is never empty when HTML exists.
  const applyGeneratedArticle = (aiData: any) => {
    const updatedBlocks: VisualBlock[] = (aiData.blocks || []).map((b: any, idx: number) => ({
      id: `block-ai-${idx}-${Date.now()}`,
      type: b.type || 'paragraph',
      title: b.title || '',
      subtitle: b.subtitle || '',
      content: b.content || '',
      buttonText: b.buttonText || '',
      buttonUrl: b.buttonUrl || '#',
      badge: b.badge || '',
      keywords: b.keywords || '',
    }));
    if (updatedBlocks.length === 0 && aiData.bodyHtml) {
      const plain = aiData.bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      updatedBlocks.push({
        id: `block-fallback-${Date.now()}`,
        type: 'paragraph',
        title: '',
        subtitle: '',
        content: plain.slice(0, 4000),
        buttonText: '',
        buttonUrl: '#',
        badge: '',
      });
    }

    // Merge the 2 auto-generated Nano Banana images (Phase 2.5): hero becomes
    // the featured image AND the frame's hero-band media; the secondary image
    // replaces the model's placeholder <img> (image_banner block) so the frame
    // renders a second real image in the body. Deterministic — the same block
    // mapping reproduces byte-identical pushes.
    const imgs: any[] = Array.isArray(aiData.images) ? aiData.images : [];
    const heroImg = imgs.find((i: any) => i?.role === 'hero') || (aiData.featuredImageUrl ? { url: aiData.featuredImageUrl, mediaId: aiData.featuredMediaId, prompt: aiData.suggestedNanoPrompt } : null);
    const secondaryImg = imgs.find((i: any) => i?.role === 'secondary') || (aiData.secondaryImageUrl ? { url: aiData.secondaryImageUrl } : null);
    const isPlaceholderSrc = (u?: string) => !u || /placehold\.co|picsum\.photos/i.test(String(u));
    const remappedBlocks: VisualBlock[] = updatedBlocks.map((b: any) => {
      if (b.type === 'hero' && heroImg?.url && isPlaceholderSrc(b.imageUrl)) {
        return { ...b, imageUrl: heroImg.url, imageAlt: b.imageAlt || b.title || aiData.articleTitle || 'Featured image' };
      }
      if (b.type === 'image_banner' && secondaryImg?.url && isPlaceholderSrc(b.imageUrl)) {
        return { ...b, imageUrl: secondaryImg.url, imageAlt: b.imageAlt || 'Article image' };
      }
      return b;
    });
    // Secondary image block removed — only the hero image is shown, at the top.
    // No image is ever appended at the bottom of the article.
    setEditingItem((prev) => ({
      ...prev,
      // The AI's crafted h1 becomes the article's real title (the seed stays
      // in initialPrompt and is never rendered as the page headline).
      title: (aiData.articleTitle && aiData.articleTitle !== prev.title ? aiData.articleTitle : prev.title),
      initialPrompt: prev.initialPrompt || prev.title,
      bodyHtml: aiData.bodyHtml || prev.bodyHtml,
      seoBrief: aiData.seoBrief || prev.seoBrief,
      metaTitle: aiData.metaTitle || prev.metaTitle,
      metaDescription: aiData.metaDescription || prev.metaDescription,
      nanoBananaPrompt: aiData.suggestedNanoPrompt || prev.nanoBananaPrompt,
      featuredImageUrl: heroImg?.url || prev.featuredImageUrl,
      featuredMediaId: typeof heroImg?.mediaId === 'number' ? heroImg.mediaId : prev.featuredMediaId,
      secondaryImageUrl: secondaryImg?.url || prev.secondaryImageUrl,
      blocks: remappedBlocks.length > 0 ? remappedBlocks : prev.blocks,
      status: 'Draft_Ready',
      updatedAt: new Date().toISOString(),
    }));
  };

  const cancelGeneration = () => {
    abortRef.current?.abort();
    setIsGeneratingAi(false);
    setGenState(null);
    setAiError(null);
  };

  // Humanise the current draft (separate, interactive step): shows the original
  // and the humanised version side by side so the user chooses which to keep.
  const handleHumanizeDraft = async () => {
    const html = editingItem?.bodyHtml || '';
    if (countWords(html) < 50) {
      setHumanizeError('Write at least 50 words of content first (use Auto-Write or paste your draft), then humanise it.');
      return;
    }
    setIsHumanizing(true);
    setHumanizeError(null);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/humanize-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html, brand, byokKeys }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.success) throw new Error(data.error || 'Humanisation failed.');
      setHumanizeDraft({
        original: data.original || html,
        humanized: data.humanized || html,
        blocks: data.blocks || [],
        changed: !!data.changed,
        note: data.note,
      });
      logGeneration({
        at: new Date().toISOString(),
        action: 'Humanise Draft',
        provider: data.provider || 'gemini',
        model: data.model || 'gemini-3.5-flash',
        ok: true,
        humanized: true,
        words: countWords(data.humanized || html),
        insight: data.note || (data.changed ? 'Rewrote the draft in a more natural voice' : 'No changes needed'),
      });
    } catch (e: any) {
      console.error('Humanise failed:', e);
      setHumanizeError(e?.message || 'Humanisation failed. Please try again.');
      logGeneration({
        at: new Date().toISOString(),
        action: 'Humanise Draft',
        provider: 'gemini',
        model: 'gemini-flash-latest',
        ok: false,
        error: (e?.message || 'Humanisation failed.').slice(0, 200),
        insight: 'Humanisation failed — see error',
      });
    } finally {
      setIsHumanizing(false);
    }
  };

  const applyHumanisedDraft = () => {
    if (!humanizeDraft) return;
    applyGeneratedArticle({ bodyHtml: humanizeDraft.humanized, blocks: humanizeDraft.blocks });
    setHumanizeDraft(null);
    setAiError(null);
  };

  const discardHumanisedDraft = () => {
    setHumanizeDraft(null);
    setHumanizeError(null);
  };

  const handleOpenPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await fetch('/api/wp/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, contentItem: editingItem }),
      });
      const data = await res.json();
      if (data.success && data.html) {
        setPreviewData({ html: data.html, mode: data.mode, url: data.url, fallback: data.fallback });
      } else {
        setPreviewError(data.message || data.reason || 'Preview failed to load.');
        setPreviewData(null);
      }
    } catch (e: any) {
      setPreviewError(e?.message || 'Preview failed to load.');
      setPreviewData(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const previewModeLabel = (mode: string, fallback?: boolean) =>
    mode === 'live' ? 'Live site · real published page'
    : mode === 'draft' ? 'WordPress render · draft content'
    : fallback ? 'Brand fallback template' : 'Theme preview · local content';

  const handleFetchNanoPrompts = async () => {
    setIsGeneratingPrompts(true);
    setAiError(null);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/nano-banana-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingItem.title,
          brandName: brand?.name || '',
          voiceGuidelines: brand?.voiceGuidelines || '',
          byokKeys,
          applyHumanization,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.success && Array.isArray(data.data)) {
        setNanoPrompts(data.data);
        logGeneration({
          at: new Date().toISOString(),
          action: 'Image Ideas',
          provider: data.provider || aiPref.provider,
          model: data.model || aiPref.model,
          fallback: !!data.fallback,
          ok: true,
        });
        // Seed the editable prompt box with the best concept if it's empty.
        setImagePromptText((prev) => {
          if (prev?.trim()) return prev;
          const first = data.data.find((p: any) => p.prompt) || data.data[0];
          return first?.prompt || prev;
        });
        setSelectedPromptIdx((prev) => (prev === null && data.data.length > 0 ? 0 : prev));
      }
    } catch (e: any) {
      console.error('Error fetching prompts:', e);
      setAiError(e?.message || 'Prompt generation failed. Please try again.');
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  // Auto SEO keyword suggestion — suggests primary + secondary keywords from the topic.
  const [kwSuggesting, setKwSuggesting] = useState(false);
  const handleSuggestKeywords = async () => {
    const title = (editingItem?.title || '').trim();
    if (!title) return;
    setKwSuggesting(true);
    try {
      const byokKeys = await fetchGlobalKeys().catch(() => ({}));
      const res = await fetch('/api/ai/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, brand, byokKeys, modelPref: aiPref }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingItem({
          ...editingItem,
          primaryKeyword: data.primaryKeyword || editingItem.primaryKeyword,
          secondaryKeywords: data.secondaryKeywords || editingItem.secondaryKeywords,
          seoBrief: data.seoBrief || editingItem.seoBrief,
        });
      }
    } catch { /* silent */ }
     setKwSuggesting(false);
  };

  // --- Enhance Existing: fetch URL content and populate the editor ---------
  const handleFetchUrl = async () => {
    const url = enhanceUrl.trim();
    if (!url) return;
    setEnhanceUrlLoading(true);
    setEnhanceUrlError('');
    try {
      const res = await fetch('/api/ai/fetch-url-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || 'Failed to fetch URL');
      setEditingItem({
        ...editingItem,
        title: data.title || editingItem.title,
        originalHtml: data.html || data.text,
        originalTitle: data.title,
        bodyHtml: data.html || editingItem.bodyHtml,
      });
    } catch (err: any) {
      setEnhanceUrlError(err.message || 'Failed to fetch URL');
    }
    setEnhanceUrlLoading(false);
  };

  // --- Enhance Existing: run the enhancement pipeline ----------------------
  const handleEnhanceArticle = async () => {
    const originalHtml = editingItem.originalHtml || editingItem.bodyHtml || '';
    if (!originalHtml.trim()) return;
    setIsGeneratingAi(true);
    setAiError(null);
    lastUpdateRef.current = Date.now();
    setGenState({ phase: 'Connecting…', percent: 2, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] });
    const abort = new AbortController();
    abortRef.current = abort;
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/enhance-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalHtml,
          originalTitle: editingItem.originalTitle || editingItem.title,
          title: editingItem.title,
          primaryKeyword: editingItem.primaryKeyword,
          secondaryKeywords: editingItem.secondaryKeywords,
          seoBrief: editingItem.seoBrief,
          brand,
          byokKeys,
          targetWordCount: editingItem.targetWordCount,
          modelPref: aiPref,
          requestedBlocks,
          relatedArticles,
        }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText?.slice(0, 200) || `Enhancement failed (HTTP ${res.status}).`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamedText = '';
      let completed = false;
      let streamError: string | null = null;

      const handleEvent = (evt: any) => {
        if (evt.type === 'generationInfo') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => ({
            ...(prev || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false, generationInfo: null, history: [] }),
            generationInfo: evt,
            history: prev?.history || [],
          }));
        } else if (evt.type === 'status') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              phase: evt.message || evt.phase || '',
              percent: evt.percent ?? prev.percent,
              stalled: false,
              history: [
                ...prev.history,
                { message: evt.message || '', percent: evt.percent ?? prev.percent, at: Date.now() },
              ],
            };
          });
        } else if (evt.type === 'stream') {
          lastUpdateRef.current = Date.now();
          streamedText += evt.text || '';
          setGenState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              phase: evt.phase || prev.phase || 'Enhancing…',
              percent: evt.percent ?? prev.percent,
              words: evt.words ?? countWords(streamedText),
              text: streamedText,
              stalled: false,
              history: evt.phase ? [...prev.history, { message: evt.phase, percent: evt.percent ?? prev.percent, at: Date.now() }] : prev.history,
            };
          });
        } else if (evt.type === 'heartbeat') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => (prev ? { ...prev, elapsed: evt.elapsed ?? prev.elapsed, stalled: false } : prev));
        } else if (evt.type === 'image') {
          lastUpdateRef.current = Date.now();
          const img = evt as any;
          if (img.role === 'hero') {
            setEditingItem((prev) => ({ ...prev, featuredImageUrl: img.url || prev?.featuredImageUrl, featuredMediaId: typeof img.mediaId === 'number' ? img.mediaId : prev?.featuredMediaId, nanoBananaPrompt: img.prompt || prev?.nanoBananaPrompt, updatedAt: new Date().toISOString() }));
          } else if (img.role === 'secondary') {
            setEditingItem((prev) => ({ ...prev, secondaryImageUrl: img.url || prev?.secondaryImageUrl, updatedAt: new Date().toISOString() }));
          }
          setGenState((prev) => (prev ? { ...prev, phase: img.role === 'hero' ? 'Hero image ready…' : 'Both images ready.', percent: img.role === 'hero' ? 90 : 92, stalled: false } : prev));
        } else if (evt.type === 'imageWarning') {
          lastUpdateRef.current = Date.now();
        } else if (evt.type === 'error') {
          streamError = evt.error || 'Enhancement failed.';
        } else if (evt.type === 'done') {
          completed = true;
          applyGeneratedArticle(evt.data || {});
          const d = evt.data || {};
          logGeneration({ at: new Date().toISOString(), action: 'Enhance', provider: d.provider || 'gemini', model: d.model || aiPref.model, fallback: !!d.fallback, words: d.wordCount, durationMs: d.latencyMs, ok: true });
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
          try { handleEvent(JSON.parse(line)); } catch { /* skip */ }
        }
      }
      if (streamError) throw new Error(streamError);
      if (!completed) throw new Error('Enhancement ended without completing.');
    } catch (err: any) {
      if (err.name === 'AbortError') { /* cancelled */ }
      else setAiError(err.message?.slice(0, 300) || 'Enhancement failed.');
    }
    setIsGeneratingAi(false);
    setGenState(null);
  };

  // Topic context prepended to every image render so the generated image
  // always matches the blog topic, even for short or generic prompts.
  const imageTopicContext = useMemo(() => {
    const title = editingItem?.title?.trim();
    const kw = editingItem?.primaryKeyword?.trim();
    if (!title && !kw) return '';
    return `Featured image for a blog article${title ? ` titled "${title}"` : ''}${
      kw ? ` about "${kw}"` : ''
    }. Brand: ${brand?.name || 'the site'}. Editorial, photorealistic, warm and authentic — no text or logos.`;
  }, [editingItem?.title, editingItem?.primaryKeyword, brand?.name]);

  const handleRenderImage = async () => {
    const promptToUse = (imagePromptText || '').trim();
    if (!promptToUse) {
      setAiError('Type or select an image prompt first, then render.');
      return;
    }
    setIsGeneratingImage(true);
    setAiError(null);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/generate-nano-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          aspectRatio: '16:9',
          modelProvider: 'auto',
          topicContext: imageTopicContext,
          byokKeys,
          applyHumanization,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.success && data.imageUrl) {
        setEditingItem((prev) => ({
          ...prev,
          nanoBananaPrompt: promptToUse,
          featuredImageUrl: data.imageUrl,
          // A fresh manual render supersedes any AI-generated media id — a
          // stale id would win in sync and pin the OLD image as featured.
          featuredMediaId: undefined,
          updatedAt: new Date().toISOString(),
        }));
        setNanoImageMeta({
          isPlaceholder: !!data.isPlaceholder,
          message: data.message,
          provider: data.provider,
          model: data.model,
          isAiGenerated: !!data.isAiGenerated,
        });
        logGeneration({
          at: new Date().toISOString(),
          action: 'Render Featured Image',
          provider: data.provider || 'none',
          model: data.model || 'picsum-placeholder',
          ok: true,
        });
      }
    } catch (e: any) {
      console.error('Error generating image:', e);
      setAiError(e?.message || 'Image generation failed. Please try again.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // AI-refine the editable prompt so it stays on-topic and visual.
  const handleRefineImagePrompt = async () => {
    const current = (imagePromptText || editingItem?.nanoBananaPrompt || '').trim();
    if (!current) {
      setAiError('Nothing to refine yet — type a prompt or load a concept first.');
      return;
    }
    setIsRefiningPrompt(true);
    setAiError(null);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/refine-image-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: current,
          title: editingItem?.title || '',
          keyword: editingItem?.primaryKeyword || '',
          brandName: brand?.name || '',
          voiceGuidelines: brand?.voiceGuidelines || '',
          byokKeys,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.success && data.data?.prompt) {
        setImagePromptText(data.data.prompt);
        setSelectedPromptIdx(null);
        logGeneration({
          at: new Date().toISOString(),
          action: 'Refine Image Prompt',
          provider: data.data?.provider || aiPref.provider,
          model: data.data?.model || aiPref.model,
          ok: true,
        });
      }
    } catch (e: any) {
      console.error('Error refining prompt:', e);
      setAiError(e?.message || 'Prompt refinement failed. Please try again.');
    } finally {
      setIsRefiningPrompt(false);
    }
  };

  // statusTarget: 'publish' (default, LIVE on WordPress) or 'draft' (WP draft only)
  // Serialisation + payload logic lives in ../lib/wpSync so the Content Hub
  // publishes/saves drafts through the exact same code path.
  const handleSyncToWordPress = async (statusTarget: 'publish' | 'draft' = 'publish') => {
    setIsSyncingWp(true);
    setSyncStatusMsg(statusTarget === 'draft' ? 'Saving draft to WP...' : 'Syncing to WP...');
    try {
      const result = await syncItemToWp(brand, editingItem, statusTarget);
      if (result.ok && result.updated) {
        setEditingItem(result.updated);
        onSaveItem(result.updated);
        setSyncStatusMsg(result.message);
      } else {
        setSyncStatusMsg(`Sync error: ${result.message}`);
      }
    } catch (err: any) {
      setSyncStatusMsg(`Network error: ${err.message}`);
    } finally {
      setIsSyncingWp(false);
      // Keep error messages visible; only auto-clear successes.
      setTimeout(() => {
        setSyncStatusMsg((msg) => (msg && /error|Error|Network/i.test(msg) ? msg : null));
      }, 3000);
    }
  };

  // Re-check the ACTUAL post state on WordPress. The stored item status can go
  // stale (post trashed/re-published from wp-admin, or the item's wpPostId was
  // never persisted) — this corrects the item so the banner tells the truth.
  const handleRefreshWpState = async () => {
    const id = editingItem?.wpPostId;
    if (!id || !brand) return;
    setSyncStatusMsg(`Checking post #${id} on WordPress…`);
    try {
      const result = await refreshWpState(brand, editingItem);
      if (result.ok && result.updated) {
        setEditingItem(result.updated);
        onSaveItem(result.updated);
        setSyncStatusMsg(result.message);
      } else {
        setSyncStatusMsg(`Refresh failed: ${result.message}`);
      }
    } catch (err: any) {
      setSyncStatusMsg(`Refresh error: ${err.message}`);
    } finally {
      setTimeout(() => setSyncStatusMsg((m) => (m && /error|Error|Network/i.test(m) ? m : null)), 4000);
    }
  };

  // Regenerate the article body from the block list, wrapped in the fg-art
  // region markers so every later sync re-renders it from the current blocks.
  const handleRebuildStyledArticle = () => {
    const blocks = editingItem.blocks || [];
    if (!blocks.length) {
      setSyncStatusMsg('Add at least one content block first (use Auto-Write or the + buttons below), then rebuild.');
      setTimeout(() => setSyncStatusMsg((m) => (m && /error|Error|Network/i.test(m) ? m : null)), 4000);
      return;
    }
    if (!window.confirm('Rebuild the article HTML from your blocks using the brand style kit? This replaces the article body you see in the HTML tab.')) return;
    const html = rebuildArticleHtml(editingItem.bodyHtml || '', blocks, brand, true);
    setEditingItem({ ...editingItem, bodyHtml: html });
    setSyncStatusMsg('Styled article rebuilt — preview in the HTML tab, then sync to WordPress.');
    setTimeout(() => setSyncStatusMsg((m) => (m && /error|Error|Network/i.test(m) ? m : null)), 5000);
  };

  // Flow context for rewriting block `idx`: the article title/keyword, the
  // blocks just before it, the block right after it, and the FAQ items at the
  // end — so the rewrite reads as one continuous piece no matter which model
  // produces it.
  const buildArticleContext = (idx: number) => {
    const blocks = editingItem.blocks || [];
    const previous = blocks
      .slice(0, idx)
      .filter((b) => (b.content || '').trim())
      .slice(-2)
      .map((b) => ({ type: b.type, title: b.title || '', content: (b.content || '').slice(0, 500) }));
    const next = blocks
      .slice(idx + 1)
      .find((b) => (b.content || '').trim() || (b.title || '').trim());
    const faqBlocks = blocks.filter((b) => b.type === 'faq');
    const faqItems = faqBlocks
      .flatMap((b) => (b.faqItems || []).map((i) => ({ question: i.question, answer: (i.answer || '').slice(0, 300) })))
      .slice(0, 6);
    return {
      title: editingItem.title || '',
      keyword: editingItem.primaryKeyword || '',
      brandName: brand?.name || '',
      previousBlocks: previous,
      nextBlock: next ? { type: next.type, title: next.title || '', content: (next.content || '').slice(0, 350) } : null,
      faqItems,
    };
  };

  const handleRewriteBlock = async (blockIdx: number, block: VisualBlock) => {
    setIsRewritingBlock(prev => ({ ...prev, [block.id]: true }));
    const byokKeys = await fetchGlobalKeys();
    try {
      const direction = blockRewriteDirections[block.id] || '';
      const res = await fetch('/api/ai/rewrite-block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block,
          direction,
          tune: block.tune || {},
          articleContext: buildArticleContext(blockIdx),
          brand,
          byokKeys,
          applyHumanization,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.success && data.data) {
        const updatedBlock = { ...block, ...data.data };
        const updatedBlocks = [...editingItem.blocks];
        updatedBlocks[blockIdx] = updatedBlock;
        setEditingItem({ ...editingItem, blocks: updatedBlocks });
        logGeneration({
          at: new Date().toISOString(),
          action: 'Rewrite Block',
          provider: data.data?.provider || aiPref.provider,
          model: data.data?.model || aiPref.model,
          fallback: !!data.data?.fallback,
          ok: true,
        });
      }
    } catch (e: any) {
      console.error('Error rewriting block:', e);
      setAiError(e?.message || 'Block rewrite failed. Please try again.');
    } finally {
      setIsRewritingBlock(prev => ({ ...prev, [block.id]: false }));
    }
  };

  const handleAddBlock = (type: VisualBlockType) => {
    // Unique per-click id: Date.now() alone collides when buttons are clicked
    // rapidly (same millisecond), producing duplicate React keys and lost blocks.
    const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const newBlock: VisualBlock = {
      id: `block-${uid()}`,
      type,
      title: type === 'hero' ? 'New Hero Heading' : type === 'faq' ? 'FAQ Section' : type === 'image_banner' ? '' : type === 'cta_band' ? 'Ready to make a change?' : type === 'quote' ? '' : type === 'cards' ? 'Why choose us' : type === 'carousel' ? 'Explore the range' : type === 'daniels_tip' ? "Daniel's Tip" : type === 'newsletter' ? 'Stay in the Loop' : type === 'paragraph' ? '' : 'Section Title',
      subtitle: type === 'cta_band' ? 'No-pressure, expert-led guidance' : type === 'newsletter' ? 'Get the latest tips delivered to your inbox.' : 'Section Subtitle',
      content: type === 'image_banner' ? '' : type === 'quote' ? 'A powerful sentence worth quoting…' : type === 'cta_band' ? 'A short, warm call to action that invites the reader to take the next step.' : type === 'daniels_tip' ? 'A practical, actionable tip that benefits from being highlighted.' : type === 'newsletter' ? '' : 'Write content here...',
      buttonText: 'Learn More',
      buttonUrl: '#',
      keywords: '',
      imageLayout: type === 'image_banner' ? 'full' : undefined,
      cards: type === 'cards' ? [
        { id: `card-${uid()}`, title: 'Benefit one', content: 'One sentence on the first benefit.', buttonText: '', buttonUrl: '#' },
        { id: `card-${uid()}`, title: 'Benefit two', content: 'One sentence on the second benefit.', buttonText: '', buttonUrl: '#' },
      ] : undefined,
      slides: type === 'carousel' ? [
        { id: `slide-${uid()}`, imageUrl: '', title: 'Option one', content: 'Short description of this option.', buttonText: '', buttonUrl: '#' },
        { id: `slide-${uid()}`, imageUrl: '', title: 'Option two', content: 'Short description of this option.', buttonText: '', buttonUrl: '#' },
        { id: `slide-${uid()}`, imageUrl: '', title: 'Option three', content: 'Short description of this option.', buttonText: '', buttonUrl: '#' },
      ] : undefined,
      author: type === 'quote' ? 'Author name' : undefined,
    };
    // Functional update so rapid successive "+" clicks (same render tick)
    // never collapse earlier blocks onto a stale snapshot.
    setEditingItem((prev) => {
      const blocks = [...(prev.blocks || []), newBlock];
      return { ...prev, blocks, bodyHtml: syncImageMarkers(blocks, prev.bodyHtml || '') };
    });
  };

  // ------------------------------------------------------------------
  // Image blocks: figure HTML with layout styles, embedded in the
  // article body via self-delimiting markers so re-edits/removals never
  // corrupt the surrounding HTML. The <figure> is written with inline
  // styles so it renders correctly in any WordPress theme.
  // ------------------------------------------------------------------
  // Image figures live in ../lib/blogHtml (shared with the branded article
  // engine + HTML editor insert) — delegate here so marker logic stays identical.
  const figureHtmlFor = (block: VisualBlock): string => figureHtmlForLib(block, 12);

  // Shared PC upload: file -> base64 -> WordPress media library -> URL.
  const [uploadingImgFor, setUploadingImgFor] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const uploadImageToWp = async (file: File): Promise<string> => {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected file.'));
      reader.readAsDataURL(file);
    });
    const res = await fetch('/api/wp/upload-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        dataBase64: dataUrl,
        filename: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
      }),
    });
    // Guard against non-JSON responses (e.g. a proxy/error HTML page) so the
    // failure surfaces as a readable message instead of a JSON parse crash.
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(
        `Upload failed — the server returned ${res.status} (${contentType || 'no content-type'}). The image may be too large; try a file under 12 MB or a .jpg/.png under ~8 MB.`
      );
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.message || 'Upload to WordPress failed.');
    return data.wpMediaUrl;
  };

  const patchBlock = (idx: number, patch: Partial<VisualBlock>) => mutateBlock(idx, (b) => ({ ...b, ...patch }));

  // --- Product picker (product_cta blocks) ----------------------------------
  // Fetches the brand's live WooCommerce products and lets the user attach a
  // real product to a CTA block (title, image, button text, product URL).
  const decodeEntities = (s: string) => {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  };
  const loadShopProducts = async () => {
    if (!brand?.wpUrl) return;
    setIsLoadingProducts(true);
    try {
      const res = await fetch(`/api/wp/products?wpUrl=${encodeURIComponent(brand.wpUrl)}`);
      const data = await res.json();
      setShopProducts(data?.products || []);
    } catch {
      setShopProducts([]);
    } finally {
      setIsLoadingProducts(false);
    }
  };
  const applyShopProduct = (idx: number, p: any) => {
    patchBlock(idx, {
      title: decodeEntities(p.name || ''),
      imageUrl: p.image || '',
      buttonText: 'View Product',
      buttonUrl: p.permalink || '#',
    });
    setProductPickerFor(null);
  };
  const currencySymbol = (code?: string) =>
    code === 'GBP' ? '£' : code === 'USD' ? '$' : code === 'EUR' ? '€' : code ? `${code} ` : '';

  // Single functional primitive for all block mutations — safe against rapid
  // successive clicks in the same render tick (stale-closure collapse).
  const mutateBlock = (idx: number, fn: (b: VisualBlock) => VisualBlock) => {
    setEditingItem((prev) => {
      const newBlocks = [...(prev.blocks || [])];
      if (!newBlocks[idx]) return prev;
      newBlocks[idx] = fn(newBlocks[idx]);
      return { ...prev, blocks: newBlocks, bodyHtml: syncImageMarkers(newBlocks, prev.bodyHtml || '') };
    });
  };

  // Card grid + carousel slide editors (rich component blocks).
  const patchCard = (idx: number, ci: number, patch: Partial<CardItem>) =>
    mutateBlock(idx, (b) => {
      const cards = [...(b.cards || [])];
      if (ci < 0 || ci >= cards.length) return b;
      cards[ci] = { ...cards[ci], ...patch };
      return { ...b, cards };
    });
  const addCard = (idx: number) =>
    mutateBlock(idx, (b) => ({
      ...b,
      cards: [...(b.cards || []), { id: `card-${Date.now()}`, title: 'New card', content: '', buttonText: '', buttonUrl: '#' }],
    }));
  const removeCard = (idx: number, ci: number) =>
    mutateBlock(idx, (b) => ({ ...b, cards: (b.cards || []).filter((_, i) => i !== ci) }));
  const patchSlide = (idx: number, si: number, patch: Partial<CarouselSlide>) =>
    mutateBlock(idx, (b) => {
      const slides = [...(b.slides || [])];
      if (si < 0 || si >= slides.length) return b;
      slides[si] = { ...slides[si], ...patch };
      return { ...b, slides };
    });
  const addSlide = (idx: number) =>
    mutateBlock(idx, (b) => ({
      ...b,
      slides: [...(b.slides || []), { id: `slide-${Date.now()}`, imageUrl: '', title: 'New slide', content: '', buttonText: '', buttonUrl: '#' }],
    }));
  const removeSlide = (idx: number, si: number) =>
    mutateBlock(idx, (b) => ({ ...b, slides: (b.slides || []).filter((_, i) => i !== si) }));
  const patchFaqItem = (idx: number, fi: number, patch: { question?: string; answer?: string }) =>
    mutateBlock(idx, (b) => {
      const faqItems = [...(b.faqItems || [])];
      if (fi < 0 || fi >= faqItems.length) return b;
      faqItems[fi] = { ...faqItems[fi], ...patch };
      return { ...b, faqItems };
    });
  const addFaqItem = (idx: number) =>
    mutateBlock(idx, (b) => ({
      ...b,
      faqItems: [...(b.faqItems || []), { question: 'New question?', answer: '' }],
    }));
  const removeFaqItem = (idx: number, fi: number) =>
    mutateBlock(idx, (b) => ({ ...b, faqItems: (b.faqItems || []).filter((_, i) => i !== fi) }));

  const handleUploadForBlock = async (idx: number) => {
    const blockId = editingItem.blocks[idx]?.id;
    const fallbackAlt = (editingItem.title || '').trim() || 'Article image';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingImgFor(`block-${blockId}`);
      setUploadErr(null);
      try {
        const url = await uploadImageToWp(file);
        const cur = editingItem.blocks.findIndex((b) => b.id === blockId);
        if (cur >= 0) patchBlock(cur, { imageUrl: url, imageAlt: (editingItem.blocks[cur].imageAlt || '').trim() || fallbackAlt });
      } catch (e: any) {
        setUploadErr(e?.message || 'Upload failed.');
      } finally {
        setUploadingImgFor(null);
      }
    };
    input.click();
  };

  // HTML editor: insert a <figure> (same markup the blocks editor produces) at the end of the article.
  const [htmlImageLayout, setHtmlImageLayout] = useState<'full' | 'left' | 'right' | 'center'>('full');
  const htmlInsertFigure = (src: string, alt: string) => {
    const fig = figureHtmlFor({ id: `html-img-${Date.now()}`, type: 'image_banner', imageUrl: src, imageAlt: alt.trim() || (editingItem.title || '').trim() || 'Article image', imageLayout: htmlImageLayout } as VisualBlock);
    setEditingItem({ ...editingItem, bodyHtml: `${(editingItem.bodyHtml || '').replace(/\s*$/, '')}\n${fig}` });
  };
  const handleHtmlInsertImage = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploadingImgFor('html-editor');
      setUploadErr(null);
      try {
        const url = await uploadImageToWp(file);
        htmlInsertFigure(url, file.name.replace(/\.[^.]+$/, ''));
      } catch (e: any) {
        setUploadErr(e?.message || 'Upload failed.');
      } finally {
        setUploadingImgFor(null);
      }
    };
    input.click();
  };
  const handleHtmlInsertImageUrl = () => {
    const url = window.prompt('Paste the image URL to insert:');
    if (!url || !url.trim()) return;
    htmlInsertFigure(url.trim(), '');
  };

  const handleRemoveBlock = (id: string) => {
    const removed = (editingItem.blocks || []).find((b) => b.id === id);
    const nextBlocks = (editingItem.blocks || []).filter((b) => b.id !== id);
    let nextHtml = editingItem.bodyHtml || '';
    // If the HTML editor's Quill sanitizer already stripped this block's
    // <figure>/markers (leaving a bare <img> paragraph), remove that too so
    // deleting the block actually removes the image from the article.
    if (removed?.imageUrl) {
      const escaped = removed.imageUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      nextHtml = nextHtml.replace(new RegExp(`<p[^>]*>\\s*<img[^>]*src\\s*=\\s*["']${escaped}["'][^>]*>\\s*<\\/p>`, 'g'), '');
    }
    setEditingItem({
      ...editingItem,
      blocks: nextBlocks,
      bodyHtml: syncImageMarkers(nextBlocks, nextHtml),
    });
  };

  const handleMoveBlock = (idx: number, dir: -1 | 1) => {
    const blocks = [...(editingItem.blocks || [])];
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    [blocks[idx], blocks[target]] = [blocks[target], blocks[idx]];
    setEditingItem({ ...editingItem, blocks });
  };

  // Drag-and-drop reordering: dragged block is re-inserted at the drop target
  // position (visual WYSIWYG editing without leaving the page).
  const handleBlockDragStart = (idx: number) => {
    setDragBlockIdx(idx);
    setDropTargetIdx(idx);
  };
  const handleBlockDragOver = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragBlockIdx === null || idx === dropTargetIdx) return;
    setDropTargetIdx(idx);
  };
  const handleBlockDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const from = dragBlockIdx;
    const to = dropTargetIdx;
    setDragBlockIdx(null);
    setDropTargetIdx(null);
    if (from === null || to === null || from === to) return;
    const blocks = [...(editingItem.blocks || [])];
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    setEditingItem({ ...editingItem, blocks });
  };
  const handleBlockDragEnd = () => {
    setDragBlockIdx(null);
    setDropTargetIdx(null);
  };

  const addSecondaryKeyword = () => {
    const kw = newSecondaryKeyword.trim();
    if (!kw) return;
    const existing = (editingItem.secondaryKeywords || []).map((k) => k.toLowerCase());
    if (existing.includes(kw.toLowerCase())) {
      setNewSecondaryKeyword('');
      return;
    }
    setEditingItem({
      ...editingItem,
      secondaryKeywords: [...(editingItem.secondaryKeywords || []), kw],
    });
    setNewSecondaryKeyword('');
  };

  // Brand-scoped empty state: shown when the selected brand has no content yet
  // (e.g. right after switching brands in the navbar). Lets you plan a draft
  // for that brand without leaving the editor.
  if (!editingItem) {
    const bc = brandColor(brand);
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-8">
        <div
          className="bg-white rounded-2xl border shadow-sm p-8 md:p-10 text-center space-y-6"
          style={{ borderColor: withAlpha(bc, 0.35) }}
        >
          <div
            className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center"
            style={{ backgroundColor: withAlpha(bc, 0.12), color: bc }}
          >
            <PenLine className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center justify-center gap-2">
              <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: bc }} />
              {brand?.name}
            </h2>
            <p className="text-sm text-slate-500 mt-1.5">
              No posts or pages for this brand yet — plan the first one, or switch brands in the top bar.
            </p>
            {brand?.wpUrl && (
              <p className="text-[11px] text-slate-400 mt-1">{brand.wpUrl.replace(/^https?:\/\//, '')}</p>
            )}
          </div>
          {onCreateNewItem ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newDraftTitle.trim()) {
                  onCreateNewItem(newDraftTitle.trim(), brand?.id, newDraftType);
                  setNewDraftTitle('');
                }
              }}
              className="space-y-4 pt-2"
            >
              <div className="grid grid-cols-2 gap-3">
                {(['post', 'page'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewDraftType(t)}
                    className={`py-2.5 rounded-xl text-sm font-bold border transition ${
                      newDraftType === t
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                    style={newDraftType === t ? { backgroundColor: bc } : undefined}
                  >
                    {t === 'post' ? '📝 Blog Post' : '📄 Landing Page'}
                  </button>
                ))}
              </div>
              <input
                value={newDraftTitle}
                onChange={(e) => setNewDraftTitle(e.target.value)}
                placeholder={`New ${newDraftType === 'post' ? 'post' : 'page'} title for ${brand?.name}…`}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none bg-slate-50"
                autoFocus
              />
              <button
                type="submit"
                disabled={!newDraftTitle.trim()}
                className="w-full py-3 rounded-xl text-white text-sm font-bold transition hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center justify-center gap-2"
                style={{ backgroundColor: bc }}
              >
                <Plus className="w-4 h-4" /> Plan & Open Editor
              </button>
            </form>
          ) : (
            <p className="text-xs text-slate-400">Use “Create New Blog” on the pipeline to get started.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex-1 w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded tracking-wider">
              {editingItem.contentType}
            </span>
            <span
              title={`Editing ${brand?.name || ''} — voice: ${brand?.voiceGuidelines || 'brand voice'}`}
              className="text-[10px] uppercase font-bold px-2 py-0.5 rounded tracking-wider flex items-center gap-1.5 max-w-[220px] truncate"
              style={{
                backgroundColor: withAlpha(brandColor(brand), 0.12),
                color: brandColor(brand),
                border: `1px solid ${withAlpha(brandColor(brand), 0.3)}`,
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: brandColor(brand) }} />
              {brand?.name}
            </span>
            {editingItem.status === 'Error' && (
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded tracking-wider bg-red-100 text-red-700 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Error
              </span>
            )}
            <span
              title="Live word count of the article body"
              className="text-[10px] font-bold px-2 py-0.5 rounded tracking-wider bg-slate-100 text-slate-500"
            >
              {wordCount.toLocaleString()} words
              {editingItem.targetWordCount ? ` / ${editingItem.targetWordCount.toLocaleString()}` : ''}
            </span>
          </div>
          <input
            type="text"
            value={editingItem.title}
            onChange={(e) => setEditingItem({ ...editingItem, title: e.target.value })}
            className="w-full text-2xl md:text-3xl font-serif font-bold text-slate-900 focus:outline-none placeholder:text-slate-300"
            placeholder="Article Title"
          />
          {editingItem.initialPrompt && editingItem.initialPrompt !== editingItem.title && (
            <div className="mt-1 text-xs text-slate-400 flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
              <span className="truncate" title={editingItem.initialPrompt}>
                Initial prompt: <span className="italic">{editingItem.initialPrompt}</span>
              </span>
            </div>
          )}

          {/* Workflow Stepper: Plan -> Research -> Write -> Review -> Live */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center">
              {WORKFLOW_STAGES.map((stage, idx) => {
                const Icon = stage.icon;
                const isDone = currentStageIdx >= 0 && idx < currentStageIdx;
                const isCurrent = currentStageIdx === idx;
                return (
                  <React.Fragment key={stage.status}>
                    {idx > 0 && (
                      <div
                        className={`flex-1 h-0.5 rounded-full min-w-[8px] ${isDone || isCurrent ? '' : 'bg-slate-200'}`}
                        style={isDone || isCurrent ? { backgroundColor: brandColor(brand) } : undefined}
                      />
                    )}
                    <button
                      onClick={() => handleSetStage(stage.status as PipelineStatus)}
                      disabled={isCurrent}
                      title={isCurrent ? `${stage.label}: ${stage.hint}` : `Move to ${stage.label}: ${stage.hint}`}
                      className="group flex flex-col items-center gap-1.5"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${
                          isCurrent
                            ? 'text-white shadow-md'
                            : isDone
                            ? 'bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer'
                            : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200 hover:text-slate-600 cursor-pointer'
                        }`}
                        style={isCurrent
                          ? {
                              backgroundColor: brandColor(brand),
                              boxShadow: `0 4px 14px ${withAlpha(brandColor(brand), 0.3)}, 0 0 0 4px ${withAlpha(brandColor(brand), 0.15)}`,
                            }
                          : undefined}
                      >
                        {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <span
                        className={`text-[9px] md:text-[10px] font-bold whitespace-nowrap transition-colors ${
                          isCurrent ? '' : isDone ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'
                        }`}
                        style={isCurrent ? { color: brandColor(brand) } : undefined}
                      >
                        {stage.label}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Next action hint */}
            <div className="mt-2 flex items-center justify-between gap-3">
              {currentStageIdx === WORKFLOW_STAGES.length - 1 ? (
                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> This post is live — use Publish to WP to re-sync changes
                </span>
              ) : nextStage ? (
                <button
                  onClick={() => handleSetStage(nextStage.status as PipelineStatus)}
                  className="text-[11px] font-bold hover:opacity-80 flex items-center gap-1.5 transition group"
                  style={{ color: brandColor(brand) }}
                >
                  Next: <span className="underline underline-offset-2">{nextStage.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ) : null}
              <span className="text-[11px] text-slate-400 hidden sm:block">
                {currentStageIdx >= 0 ? WORKFLOW_STAGES[currentStageIdx].hint : 'Workflow stage'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={handleOpenPreview}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-sm font-semibold transition shadow-sm"
            title="Preview this post as it will appear on the site"
          >
            <Eye className="w-4 h-4" />
            Preview
          </button>
          <button
            onClick={handleSave}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition shadow-sm"
            title="Save all changes to Firestore"
          >
            <Save className="w-4 h-4 text-slate-400" />
            {saveStatus === 'Saving...' ? 'Saving...' : saveStatus === 'Saved' ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      {syncStatusMsg && (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-3">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
          {syncStatusMsg}
        </div>
      )}

      {aiError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm font-medium flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{aiError}</span>
          <button onClick={() => setAiError(null)} className="text-red-400 hover:text-red-600 transition shrink-0" title="Dismiss">
            ✕
          </button>
        </div>
      )}

      {/* Workflow Step Tabs: Brief -> Write -> SEO -> Visuals -> Publish */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-1.5 flex gap-1 overflow-x-auto">
        <button
          onClick={() => setStepTab('brief')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'brief' ? 'text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
          style={stepTab === 'brief' ? { backgroundColor: brandColor(brand) } : undefined}
        >
          <ClipboardList className="w-4 h-4" /> Brief
        </button>
        <button
          onClick={() => setStepTab('write')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'write' ? 'text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
          style={stepTab === 'write' ? { backgroundColor: brandColor(brand) } : undefined}
        >
          <PenLine className="w-4 h-4" /> Write
          {wordCount > 0 && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${stepTab === 'write' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {wordCount.toLocaleString()}
            </span>
          )}
        </button>
        <button
          onClick={() => setStepTab('seo')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'seo' ? 'text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
          style={stepTab === 'seo' ? { backgroundColor: brandColor(brand) } : undefined}
        >
          <SearchCheck className="w-4 h-4" /> SEO
          {liveSeoPct !== null && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${liveSeoPct >= 80 ? 'bg-emerald-100 text-emerald-700' : liveSeoPct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600'}`}>
              {liveSeoPct}
            </span>
          )}
        </button>
        <button
          onClick={() => setStepTab('visuals')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'visuals' ? 'text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
          style={stepTab === 'visuals' ? { backgroundColor: brandColor(brand) } : undefined}
        >
          <ImageIcon className="w-4 h-4" /> Visuals
          {editingItem.featuredImageUrl && (
            <span className={`w-1.5 h-1.5 rounded-full ${stepTab === 'visuals' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
          )}
        </button>
        <button
          onClick={() => setStepTab('publish')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'publish' ? 'text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
          style={stepTab === 'publish' ? { backgroundColor: brandColor(brand) } : undefined}
        >
          <Rocket className="w-4 h-4" /> Publish
          {editingItem.status === 'Published' && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${stepTab === 'publish' ? 'bg-emerald-300/30 text-emerald-100' : 'bg-emerald-100 text-emerald-700'}`}>
              Live
            </span>
          )}
        </button>
      </div>

      {/* Generation history — sticky, top-right below the tabs, visible on every step */}
      <div className="sticky top-2 z-20 mt-3 w-full md:w-[440px] md:ml-auto bg-white/95 backdrop-blur rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
        <button
          onClick={() => setHistoryOpen((o) => !o)}
          className="w-full px-4 py-2.5 flex items-center gap-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition select-none"
          title={historyOpen ? 'Collapse generation history' : 'Expand generation history'}
        >
          <ClipboardList className="w-4 h-4 text-slate-400 shrink-0" />
          Generation history
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 tabular-nums">
            {editingItem.generationLog?.length ?? 0}
          </span>
          <ArrowDown
            className={`w-3.5 h-3.5 ml-auto text-slate-400 transition-transform shrink-0 ${historyOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {historyOpen && (
          <div className="max-h-80 overflow-y-auto px-3 pb-3 space-y-1">
            {!editingItem.generationLog || editingItem.generationLog.length === 0 ? (
              <p className="text-xs text-slate-400 px-1 py-2">
                No AI activity yet — Auto-Write, humanise, SEO fix and image actions will appear here with timestamps.
              </p>
            ) : (
              editingItem.generationLog.map((g, idx) => (
                <div key={`${g.at}-${idx}`} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${g.ok ? 'bg-emerald-500' : 'bg-red-400'}`}
                      title={g.ok ? 'Success' : 'Failed'}
                    />
                    <span className="tabular-nums text-[10px] text-slate-400 shrink-0" title={new Date(g.at).toLocaleString()}>
                      {formatLogTime(g.at)}
                    </span>
                    <span className="font-semibold text-slate-700 text-xs shrink-0 truncate">{g.action}</span>
                    {g.fallback && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 shrink-0" title="Fell back to a backup model">
                        fallback
                      </span>
                    )}
                    {g.humanized && (
                      <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-teal-100 text-teal-700 shrink-0">
                        humanised
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 pl-4">
                    <span
                      className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[10px] truncate min-w-0"
                      title={`${g.provider}/${g.model}${g.fallback ? ' (auto-fallback)' : ''}`}
                    >
                      {g.provider}/{g.model}
                    </span>
                    {g.seoBefore != null && (
                      <span
                        className={`tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          g.seoAfter != null && g.seoAfter > g.seoBefore
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        SEO {g.seoBefore}
                        {g.seoAfter != null ? ` → ${g.seoAfter}` : ''}
                      </span>
                    )}
                    {typeof g.words === 'number' && g.words > 0 && (
                      <span className="tabular-nums text-[10px] text-slate-500 shrink-0">{g.words.toLocaleString()} words</span>
                    )}
                    {!!g.durationMs && (
                      <span className="tabular-nums text-[10px] text-slate-400 shrink-0">{(g.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  {g.insight && (
                    <p className={`text-[11px] mt-1 pl-4 leading-snug ${g.ok ? 'text-slate-500' : 'text-red-500'}`}>{g.insight}</p>
                  )}
                  {!g.ok && g.error && (
                    <p className="text-[11px] mt-1 pl-4 text-red-500 truncate" title={g.error}>
                      {g.error}
                    </p>
                  )}
                  {!!g.details?.length && (
                    <ul className="mt-1 pl-8 space-y-0.5">
                      {g.details.map((d, i) => (
                        <li key={i} className="text-[10px] text-slate-500 flex items-start gap-1.5">
                          <Check className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" /> {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Step: Brief — plan the post */}
      {stepTab === 'brief' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-indigo-500" /> Plan the Post
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Set the angle, keywords and target length before writing.</p>
            </div>
            <button
              onClick={() => setStepTab('write')}
              className="flex items-center gap-2 px-4 py-2 text-white rounded-xl text-sm font-semibold transition hover:brightness-110 shadow-sm"
              style={{ backgroundColor: brandColor(brand) }}
            >
              Start Writing <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Content Type</label>
              <div className="flex items-center gap-2">
                <span className={`px-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wider border ${editingItem.contentType === 'post' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                  {editingItem.contentType === 'post' ? 'Blog Post' : 'Landing Page'}
                </span>
                <select
                  value={editingItem.wpTemplate || 'default'}
                  onChange={(e) => setEditingItem({ ...editingItem, wpTemplate: e.target.value })}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50 cursor-pointer"
                >
                  {(brand?.pageTemplates || ['default']).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-semibold text-slate-700">Focus Keyphrase</label>
                <button
                  onClick={handleSuggestKeywords}
                  disabled={kwSuggesting || !(editingItem?.title || '').trim()}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {kwSuggesting ? 'Suggesting…' : '✨ Suggest Keywords'}
                </button>
              </div>
              <input
                type="text"
                value={editingItem.primaryKeyword || ''}
                onChange={(e) => setEditingItem({ ...editingItem, primaryKeyword: e.target.value })}
                placeholder="e.g. dog walking tips"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Secondary Keywords</label>
            <div className="flex items-center gap-2 flex-wrap">
              {(editingItem.secondaryKeywords || []).map((kw, i) => (
                <span key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-xs font-semibold">
                  {kw}
                  <button
                    onClick={() => setEditingItem({ ...editingItem, secondaryKeywords: (editingItem.secondaryKeywords || []).filter((_, j) => j !== i) })}
                    className="hover:text-red-500 transition"
                    title="Remove keyword"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={newSecondaryKeyword}
                onChange={(e) => setNewSecondaryKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSecondaryKeyword(); } }}
                placeholder="Add keyword…"
                className="flex-1 min-w-[140px] px-3 py-1.5 rounded-full border border-slate-200 text-sm bg-slate-50 focus:outline-none focus:border-indigo-300"
              />
              <button
                onClick={addSecondaryKeyword}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">Press Enter to add. These are used for SEO density checks and refinement.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">SEO Brief</label>
            <textarea
              value={editingItem.seoBrief || ''}
              onChange={(e) => setEditingItem({ ...editingItem, seoBrief: e.target.value })}
              rows={4}
              placeholder="Target audience, search intent, and what the page should rank for..."
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Target Length</label>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { label: 'Snappy', w: 500 },
                { label: 'Standard', w: 900 },
                { label: 'Long', w: 1500 },
                { label: 'Deep Dive', w: 2500 },
              ].map((p) => {
                const active = editingItem.targetWordCount === p.w;
                return (
                  <button
                    key={p.w}
                    onClick={() => setEditingItem({ ...editingItem, targetWordCount: p.w })}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                      active ? '' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                    style={active
                      ? {
                          backgroundColor: withAlpha(brandColor(brand), 0.1),
                          color: brandColor(brand),
                          borderColor: withAlpha(brandColor(brand), 0.4),
                          boxShadow: `0 0 0 2px ${withAlpha(brandColor(brand), 0.18)}`,
                        }
                      : undefined}
                  >
                    {p.label} · {p.w.toLocaleString()}
                  </button>
                );
              })}
              <input
                type="number"
                min={300}
                max={3000}
                step={50}
                value={editingItem.targetWordCount || ''}
                onChange={(e) => setEditingItem({ ...editingItem, targetWordCount: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Custom"
                className="w-28 px-3 py-2 rounded-xl border border-slate-200 text-sm bg-slate-50 focus:outline-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step: Write — content creation */}
      {stepTab === 'write' && (
        <div className="space-y-4">
          {/* Mode toggle: Generate New vs Enhance Existing */}
          <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
              <button
                onClick={() => setEditorMode('generate')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition whitespace-nowrap ${editorMode === 'generate' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Sparkles className="w-4 h-4" /> Generate New
              </button>
              <button
                onClick={() => setEditorMode('enhance')}
                className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition whitespace-nowrap ${editorMode === 'enhance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Wand2 className="w-4 h-4" /> Enhance Existing
              </button>
            </div>
          </div>

          {/* Enhance Existing panel — URL input + paste area */}
          {editorMode === 'enhance' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm space-y-3">
              <p className="text-xs text-slate-500 font-medium">Paste your existing article text or enter a URL to fetch it automatically.</p>
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={enhanceUrl}
                  onChange={(e) => setEnhanceUrl(e.target.value)}
                  placeholder="https://example.com/my-existing-article"
                  className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFetchUrl(); }}
                />
                <button
                  onClick={handleFetchUrl}
                  disabled={enhanceUrlLoading || !enhanceUrl.trim()}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200 transition disabled:opacity-50 whitespace-nowrap"
                >
                  {enhanceUrlLoading ? 'Fetching…' : 'Fetch URL'}
                </button>
              </div>
              {enhanceUrlError && (
                <p className="text-xs text-rose-600 font-medium">{enhanceUrlError}</p>
              )}
              {editingItem.originalHtml && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs text-emerald-700 font-medium flex items-center gap-2">
                  <span>✓</span>
                  <span>Article loaded — {countWords(editingItem.originalHtml).toLocaleString()} words. Click "Enhance Article" below to improve it.</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Or paste article text directly:</label>
                <textarea
                  value={editingItem.originalHtml || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, originalHtml: e.target.value, originalTitle: editingItem.originalTitle || editingItem.title })}
                  placeholder="Paste your existing blog article HTML or plain text here…"
                  rows={8}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50 resize-y font-mono leading-relaxed"
                />
              </div>
              <button
                onClick={handleEnhanceArticle}
                disabled={isGeneratingAi || !((editingItem.originalHtml || '').trim())}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold hover:brightness-110 transition disabled:opacity-70 shadow-sm w-full"
                style={{ backgroundColor: brandColor(brand) }}
              >
                {isGeneratingAi ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white/80" />
                ) : (
                  <Wand2 className="w-4 h-4 text-white/90" />
                )}
                {isGeneratingAi
                  ? `Enhancing… ${genState?.percent ?? 0}%`
                  : 'Enhance Article'}
              </button>
            </div>
          )}

          {/* Write controls (generate mode) */}
          {editorMode === 'generate' && <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-3">
            <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
              <button
                onClick={() => setWriteMode('visual')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition whitespace-nowrap ${writeMode === 'visual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Layout className="w-4 h-4" /> Blocks
              </button>
              <button
                onClick={() => setWriteMode('html')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition whitespace-nowrap ${writeMode === 'html' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <Code className="w-4 h-4" /> HTML
              </button>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <select
                value={`${aiPref.provider}:${aiPref.model}`}
                onChange={(e) => {
                  const chosen = AI_MODEL_OPTIONS.find((o) => `${o.provider}:${o.model}` === e.target.value);
                  if (chosen) setAiPref({ ...aiPref, provider: chosen.provider, model: chosen.model });
                }}
                title="AI model for this post's generations — switches automatically to a fallback when the selected provider is out of quota. Configure keys in Settings > AI Models."
                className="px-2.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
              >
                {AI_MODEL_OPTIONS.map((o) => (
                  <option key={`${o.provider}:${o.model}`} value={`${o.provider}:${o.model}`}>
                    {o.label}
                  </option>
                ))}
              </select>

              <select
                value={LENGTH_PRESETS.some((p) => p.w === (editingItem.targetWordCount || 900)) ? String(editingItem.targetWordCount || 900) : 'custom'}
                onChange={(e) => {
                  const w = e.target.value === 'custom' ? undefined : Number(e.target.value);
                  setEditingItem({ ...editingItem, targetWordCount: w });
                }}
                title="How long the generated article should be. Defaults to the SEO-recommended minimum (~900 words)."
                className="px-2.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
              >
                <option value="500">Length: Snappy · 500</option>
                <option value="900">Length: SEO Recommended · 900</option>
                <option value="1500">Length: Long · 1500</option>
                <option value="2500">Length: Deep Dive · 2500</option>
                <option value="custom">Length: Custom…</option>
              </select>
              {editingItem.targetWordCount && !LENGTH_PRESETS.some((p) => p.w === editingItem.targetWordCount) && (
                <input
                  type="number"
                  min={300}
                  max={3000}
                  step={50}
                  value={editingItem.targetWordCount || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, targetWordCount: e.target.value ? Number(e.target.value) : undefined })}
                  title="Custom target word count"
                  className="w-20 px-2.5 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-semibold bg-slate-50 focus:outline-none"
                />
              )}

              {/* Block hints: which content blocks the engine should include.
                  The engine auto-detects the rest; these take priority. */}
              <div className="relative" title="Which content blocks the engine should include. The engine auto-detects the rest from your content — these take priority. Leave empty for fully automatic.">
                <select
                  value={requestedBlocks.length ? requestedBlocks[requestedBlocks.length - 1] : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setRequestedBlocks((prev) => (prev.includes(v) ? prev : [...prev, v]));
                  }}
                  className="px-2.5 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 cursor-pointer"
                >
                  <option value="">Blocks: Auto</option>
                  <option value="image_banner">+ Image wrap</option>
                  <option value="product_cta">+ Product showcase</option>
                  <option value="cta_band">+ CTA band</option>
                  <option value="cards">+ Card grid</option>
                  <option value="quote">+ Quote</option>
                  <option value="callout">+ Callout</option>
                  <option value="daniels_tip">+ Daniel's Tip</option>
                  <option value="newsletter">+ Newsletter</option>
                  <option value="faq">+ FAQ</option>
                  <option value="carousel">+ Carousel</option>
                </select>
                {requestedBlocks.length > 0 && (
                  <div className="absolute z-20 mt-1 right-0 bg-white border border-slate-200 rounded-xl shadow-lg p-2 w-56">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Requested blocks</span>
                      <button
                        onClick={() => setRequestedBlocks([])}
                        className="text-[10px] font-semibold text-rose-500 hover:text-rose-700"
                      >
                        Clear all
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {requestedBlocks.map((b) => (
                        <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[10px] font-semibold">
                          {b.replace(/_/g, ' ')}
                          <button
                            onClick={() => setRequestedBlocks((prev) => prev.filter((x) => x !== b))}
                            className="text-indigo-400 hover:text-indigo-700"
                            title={`Remove ${b}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleHumanizeDraft}
                disabled={isGeneratingAi || isHumanizing || countWords(editingItem?.bodyHtml || '') < 50}
                title="Rewrite the current draft to sound more naturally human, then compare before/after and choose which version to keep."
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Wand2 className="w-3.5 h-3.5" />
                {isHumanizing ? 'Humanising…' : 'Humanise draft'}
              </button>
              <button
                onClick={handleRebuildStyledArticle}
                title="Regenerate the article body from your blocks using this brand's style kit — rich, responsive, brand-coloured components (accordions, cards, carousels, CTA bands…). Run this after adding or editing blocks, then sync. (Sync also re-renders structured content from blocks automatically, so live posts always ship styled.)"
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition shadow-sm"
                style={{ borderColor: `${brandColor(brand)}55`, color: brandColor(brand) }}
              >
                <Layout className="w-3.5 h-3.5" />
                Rebuild styled article
              </button>
              <button
                onClick={handleGenerateWithGemini}
                disabled={isGeneratingAi}
                className="flex items-center justify-center gap-2 px-5 py-2.5 text-white rounded-xl text-sm font-semibold hover:brightness-110 transition disabled:opacity-70 shadow-sm"
                style={{ backgroundColor: brandColor(brand) }}
              >
                {isGeneratingAi ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white/80" />
                ) : (
                  <Sparkles className="w-4 h-4 text-white/90" />
                )}
                {isGeneratingAi
                  ? `Writing… ${genState?.percent ?? 0}%`
                  : 'Auto-Write'}
              </button>
            </div>
          </div>}

          {/* Interactive humanisation: before/after compare + choice */}
          {isHumanizing && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3">
              <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
              <span className="text-sm font-semibold text-slate-700">Humanising the draft — comparing before and after…</span>
            </div>
          )}
          {humanizeError && !isHumanizing && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium rounded-2xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{humanizeError}</span>
            </div>
          )}
          {humanizeDraft && !isHumanizing && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                <Wand2 className="w-4 h-4" style={{ color: brandColor(brand) }} />
                <span className="text-sm font-bold text-slate-800">Humanise draft — compare and choose</span>
                <span className="text-[11px] text-slate-400 font-medium">{humanizeDraft.note || 'Generated by Patina (Gemini).'}</span>
                {!humanizeDraft.changed && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">No meaningful change</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={discardHumanisedDraft}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition"
                  >
                    Keep original
                  </button>
                  <button
                    onClick={applyHumanisedDraft}
                    disabled={!humanizeDraft.changed}
                    className="px-3 py-1.5 rounded-xl text-white text-xs font-semibold hover:brightness-110 transition disabled:opacity-50"
                    style={{ backgroundColor: brandColor(brand) }}
                  >
                    Use humanised version
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                <div>
                  <div className="px-4 py-2 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wide flex items-center justify-between">
                    <span>Before — original draft</span>
                    <span className="tabular-nums">{countWords(humanizeDraft.original).toLocaleString()} words</span>
                  </div>
                  <div className="p-4 max-h-72 overflow-y-auto prose prose-sm text-sm text-slate-700"
                    dangerouslySetInnerHTML={{ __html: humanizeDraft.original }} />
                </div>
                <div>
                  <div className="px-4 py-2 bg-emerald-50/60 text-[11px] font-bold text-emerald-700 uppercase tracking-wide flex items-center justify-between">
                    <span>After — humanised</span>
                    <span className="tabular-nums">{countWords(humanizeDraft.humanized).toLocaleString()} words</span>
                  </div>
                  <div className="p-4 max-h-72 overflow-y-auto prose prose-sm text-sm text-slate-700"
                    dangerouslySetInnerHTML={{ __html: humanizeDraft.humanized }} />
                </div>
              </div>
            </div>
          )}

          {/* Full generation info panel: rules, live progress & history timeline */}
          {isGeneratingAi && genState && (
            <GenerationInfoPanel
              genState={genState}
              brandColor={brandColor(brand)}
              targetWordCount={editingItem.targetWordCount}
              onCancel={cancelGeneration}
            />
          )}

          {/* Word count meter */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-600 mb-2">
              <span className="flex items-center gap-1.5">
                <PenLine className="w-3.5 h-3.5 text-slate-400" /> Word count
              </span>
              <span className="tabular-nums">
                {wordCount.toLocaleString()}
                {editingItem.targetWordCount ? ` / ${editingItem.targetWordCount.toLocaleString()}` : ' words'}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${editingItem.targetWordCount && wordCount >= editingItem.targetWordCount ? 'bg-emerald-500' : ''}`}
                style={{
                  width: `${Math.min(100, (wordCount / (editingItem.targetWordCount || 900)) * 100)}%`,
                  ...(!(editingItem.targetWordCount && wordCount >= editingItem.targetWordCount)
                    ? { backgroundColor: brandColor(brand) }
                    : undefined),
                }}
              />
            </div>
          </div>

          {writeMode === 'visual' && (
            <div className="space-y-4">
              {(!editingItem.blocks || editingItem.blocks.length === 0) ? (
                <div className="bg-white border border-slate-200 border-dashed rounded-2xl p-12 text-center text-slate-500">
                  <Layout className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                  <p className="font-medium text-slate-700">
                    {isGeneratingAi ? 'Blocks are being generated…' : 'No content blocks yet.'}
                  </p>
                  <p className="text-sm mt-1 mb-6">
                    {isGeneratingAi
                      ? 'The article is being written live above — structured blocks (hero, paragraphs, FAQ) appear here the moment writing finishes.'
                      : 'Click Auto-Write to generate a full article, or add blocks manually.'}
                  </p>
                  {!isGeneratingAi && (
                    <button onClick={() => handleAddBlock('paragraph')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition">
                      + Add Paragraph Block
                    </button>
                  )}
                </div>
              ) : (
                editingItem.blocks.map((block, idx) => (
                  <div
                    key={block.id}
                    draggable
                    onDragStart={(e) => { handleBlockDragStart(idx); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragOver={(e) => handleBlockDragOver(idx, e)}
                    onDrop={handleBlockDrop}
                    onDragEnd={handleBlockDragEnd}
                    className={`bg-white rounded-2xl border p-5 shadow-sm space-y-4 group transition ${
                      dragBlockIdx === idx
                        ? 'border-indigo-300 opacity-50 ring-2 ring-indigo-200'
                        : dropTargetIdx === idx && dragBlockIdx !== null
                          ? 'border-indigo-400 ring-2 ring-indigo-300'
                          : 'border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          title="Drag to reorder"
                          className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                        >
                          <GripVertical className="w-4 h-4" />
                        </span>
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider truncate">
                          {idx + 1}. {block.type} Block
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleMoveBlock(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleMoveBlock(idx, 1)}
                          disabled={idx === editingItem.blocks.length - 1}
                          title="Move down"
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleRemoveBlock(block.id)} title="Delete block" className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {block.type !== 'image_banner' && (
                    <input
                      type="text"
                      value={block.title || ''}
                      onChange={(e) => {
                        const newBlocks = [...editingItem.blocks];
                        newBlocks[idx].title = e.target.value;
                        setEditingItem({ ...editingItem, blocks: newBlocks });
                      }}
                      placeholder="Section Title"
                      className="w-full text-lg font-serif font-bold text-slate-900 border-b border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none transition"
                    />
                    )}
                    {block.type === 'hero' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={block.subtitle || ''}
                          onChange={(e) => {
                            const newBlocks = [...editingItem.blocks];
                            newBlocks[idx].subtitle = e.target.value;
                            setEditingItem({ ...editingItem, blocks: newBlocks });
                          }}
                          placeholder="Hero subtitle (1–2 sentences)"
                          className="w-full text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                        />
                        <input
                          type="text"
                          value={block.badge || ''}
                          onChange={(e) => {
                            const newBlocks = [...editingItem.blocks];
                            newBlocks[idx].badge = e.target.value;
                            setEditingItem({ ...editingItem, blocks: newBlocks });
                          }}
                          placeholder="Badge (e.g. Featured Guide)"
                          className="w-full text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                        />
                      </div>
                    )}
                    {block.type === 'image_banner' ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Image — uploads to your WordPress media library</span>
                          <button
                            onClick={() => handleUploadForBlock(idx)}
                            disabled={uploadingImgFor === `block-${block.id}`}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                          >
                            {uploadingImgFor === `block-${block.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                            {uploadingImgFor === `block-${block.id}` ? 'Uploading…' : 'Upload from PC'}
                          </button>
                        </div>
                        {block.imageUrl ? (
                          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                            <img src={block.imageUrl} alt={block.imageAlt || ''} className="w-full max-h-64 object-contain" />
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic bg-slate-50 border border-dashed border-slate-300 rounded-xl px-3 py-6 text-center">
                            No image yet — upload one from your PC (added to your WordPress media library), or paste an image URL below.
                          </p>
                        )}
                        {uploadErr && <p className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadErr}</p>}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Image URL</label>
                            <input
                              type="text"
                              value={block.imageUrl || ''}
                              onChange={(e) => patchBlock(idx, { imageUrl: e.target.value })}
                              placeholder="https://… — or upload from PC above"
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Alt text (SEO)</label>
                            <input
                              type="text"
                              value={block.imageAlt || ''}
                              onChange={(e) => patchBlock(idx, { imageAlt: e.target.value })}
                              placeholder="Describe the image"
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Caption (optional)</label>
                            <input
                              type="text"
                              value={block.imageCaption || ''}
                              onChange={(e) => patchBlock(idx, { imageCaption: e.target.value })}
                              placeholder="Shown under the image"
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-semibold text-slate-500 mr-1">Layout</span>
                          {(['full', 'left', 'right', 'center'] as const).map((l) => (
                            <button
                              key={l}
                              onClick={() => patchBlock(idx, { imageLayout: l })}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${(block.imageLayout || 'full') === l ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                            >
                              {l === 'full' ? 'Full width' : l === 'left' ? 'Float left' : l === 'right' ? 'Float right' : 'Centered'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                    <>
                    <textarea
                      value={block.content || ''}
                      onChange={(e) => {
                        const newBlocks = [...editingItem.blocks];
                        newBlocks[idx].content = e.target.value;
                        setEditingItem({ ...editingItem, blocks: newBlocks });
                      }}
                      rows={5}
                      placeholder="Block content..."
                      className="w-full text-base text-slate-700 bg-slate-50 p-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/5 transition leading-relaxed"
                    />
                    <input
                      type="text"
                      value={block.keywords || ''}
                      onChange={(e) => {
                        const newBlocks = [...editingItem.blocks];
                        newBlocks[idx].keywords = e.target.value;
                        setEditingItem({ ...editingItem, blocks: newBlocks });
                      }}
                      placeholder="Keywords to emphasise in this block (optional, comma-separated) — used by Rewrite for per-section SEO"
                      className="w-full text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-900/5"
                    />
                    <div className="flex items-center gap-2 pt-2">
                      <input 
                        type="text" 
                        placeholder="Rewrite direction (e.g. 'Make it punchier')"
                        value={blockRewriteDirections[block.id] || ''}
                        onChange={(e) => setBlockRewriteDirections(prev => ({ ...prev, [block.id]: e.target.value }))}
                        className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none"
                      />
                      <button 
                        onClick={() => handleRewriteBlock(idx, block)}
                        disabled={isRewritingBlock[block.id]}
                        className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg transition flex items-center gap-2 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRewritingBlock[block.id] ? 'animate-spin' : ''}`} />
                        Rewrite
                      </button>
                    </div>

                    {/* Rich component editors (cards / quote / CTA band / carousel / product CTA / FAQ items) */}
                    {(block.type === 'cards' || block.type === 'cta_band' || block.type === 'quote' || block.type === 'carousel' || block.type === 'product_cta' || block.type === 'faq') && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-3">
                        {block.type === 'quote' && (
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-1">Author / attribution</label>
                            <input
                              type="text"
                              value={block.author || ''}
                              onChange={(e) => patchBlock(idx, { author: e.target.value })}
                              placeholder="e.g. Daniel — Founder, Daniel's Tasty Petfoods"
                              className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                            />
                          </div>
                        )}
                        {(block.type === 'cta_band' || block.type === 'product_cta') && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Button text</label>
                              <input
                                type="text"
                                value={block.buttonText || ''}
                                onChange={(e) => patchBlock(idx, { buttonText: e.target.value })}
                                placeholder="e.g. Shop the range"
                                className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-1">Button URL</label>
                              <input
                                type="text"
                                value={block.buttonUrl || ''}
                                onChange={(e) => patchBlock(idx, { buttonUrl: e.target.value })}
                                placeholder="https://… or #"
                                className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none"
                              />
                            </div>
                          </div>
                        )}
                        {block.type === 'product_cta' && (
                          <div>
                            <button
                              onClick={() => {
                                if (productPickerFor === idx) {
                                  setProductPickerFor(null);
                                } else {
                                  if (!shopProducts) loadShopProducts();
                                  setProductPickerFor(idx);
                                }
                              }}
                              className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 transition"
                            >
                              {productPickerFor === idx ? 'Close product picker' : 'Pick from shop'}
                            </button>
                            {productPickerFor === idx && (
                              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
                                {isLoadingProducts && (
                                  <div className="p-3 text-xs text-slate-500">Loading products…</div>
                                )}
                                {!isLoadingProducts && (!shopProducts || shopProducts.length === 0) && (
                                  <div className="p-3 text-xs text-slate-500">
                                    No products found — check the brand's WordPress URL.
                                  </div>
                                )}
                                {(shopProducts || []).map((p) => (
                                  <button
                                    key={p.id}
                                    onClick={() => applyShopProduct(idx, p)}
                                    className="w-full flex items-center gap-2 px-2.5 py-2 text-left hover:bg-emerald-50 transition"
                                  >
                                    {p.image ? (
                                      <img src={p.image} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
                                    ) : (
                                      <div className="w-8 h-8 rounded bg-slate-100 shrink-0" />
                                    )}
                                    <span className="flex-1 min-w-0">
                                      <span className="block text-xs font-semibold text-slate-700 truncate">
                                        {decodeEntities(p.name || '')}
                                      </span>
                                      <span className="block text-[10px] text-slate-400">
                                        {p.price ? `${currencySymbol(p.currency)}${p.price}` : ''}
                                      </span>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                        {block.type === 'cards' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Cards in this grid ({block.cards?.length || 0})</span>
                              <button onClick={() => addCard(idx)} className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 transition">+ Add card</button>
                            </div>
                            {(block.cards || []).map((c, ci) => (
                              <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={c.title || ''}
                                    onChange={(e) => patchCard(idx, ci, { title: e.target.value })}
                                    placeholder="Card title"
                                    className="flex-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                  <button onClick={() => removeCard(idx, ci)} title="Remove card" className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <textarea
                                  value={c.content || ''}
                                  onChange={(e) => patchCard(idx, ci, { content: e.target.value })}
                                  rows={2}
                                  placeholder="Card text (1–2 sentences)"
                                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                                <div className="grid grid-cols-3 gap-2">
                                  <input
                                    type="text"
                                    value={c.imageUrl || ''}
                                    onChange={(e) => patchCard(idx, ci, { imageUrl: e.target.value })}
                                    placeholder="Image URL (optional)"
                                    className="col-span-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                  <input
                                    type="text"
                                    value={c.buttonText || ''}
                                    onChange={(e) => patchCard(idx, ci, { buttonText: e.target.value })}
                                    placeholder="Button (optional)"
                                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {block.type === 'carousel' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Slides ({block.slides?.length || 0}) — swipeable on mobile</span>
                              <button onClick={() => addSlide(idx)} className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 transition">+ Add slide</button>
                            </div>
                            {(block.slides || []).map((s, si) => (
                              <div key={s.id} className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={s.title || ''}
                                    onChange={(e) => patchSlide(idx, si, { title: e.target.value })}
                                    placeholder="Slide title"
                                    className="flex-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                  <button onClick={() => removeSlide(idx, si)} title="Remove slide" className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={s.imageUrl || ''}
                                  onChange={(e) => patchSlide(idx, si, { imageUrl: e.target.value })}
                                  placeholder="Image URL (optional — brand-coloured panel shown without one)"
                                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                                <textarea
                                  value={s.content || ''}
                                  onChange={(e) => patchSlide(idx, si, { content: e.target.value })}
                                  rows={2}
                                  placeholder="Slide text"
                                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                                <div className="grid grid-cols-3 gap-2">
                                  <input
                                    type="text"
                                    value={s.buttonText || ''}
                                    onChange={(e) => patchSlide(idx, si, { buttonText: e.target.value })}
                                    placeholder="Button (optional)"
                                    className="col-span-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                  <input
                                    type="text"
                                    value={s.buttonUrl || ''}
                                    onChange={(e) => patchSlide(idx, si, { buttonUrl: e.target.value })}
                                    placeholder="URL"
                                    className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {block.type === 'faq' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Accordion questions ({block.faqItems?.length || 0}) — tap to expand on the live post</span>
                              <button onClick={() => addFaqItem(idx)} className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg px-2 py-1 transition">+ Add question</button>
                            </div>
                            {(block.faqItems || []).map((it, fi) => (
                              <div key={fi} className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="text"
                                    value={it.question || ''}
                                    onChange={(e) => patchFaqItem(idx, fi, { question: e.target.value })}
                                    placeholder="Question (e.g. How long do your treats stay fresh?)"
                                    className="flex-1 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                  />
                                  <button onClick={() => removeFaqItem(idx, fi)} title="Remove question" className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                                <textarea
                                  value={it.answer || ''}
                                  onChange={(e) => patchFaqItem(idx, fi, { answer: e.target.value })}
                                  rows={2}
                                  placeholder="Answer (2–3 sentences)"
                                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Renders as a fully responsive, brand-styled component in the final post — stacks on phones, fluid on desktop.
                        </p>
                      </div>
                    )}

                    {/* Per-block AI fine-tuning */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3 h-3" /> Fine-tune this block
                        </span>
                        <span className="text-[10px] text-slate-400 italic">Applies to the next Rewrite</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <label className="block">
                          <span className="text-[10px] font-semibold text-slate-500">Tone</span>
                          <select
                            value={block.tune?.tone || 'brand'}
                            onChange={(e) => {
                              const newBlocks = [...editingItem.blocks];
                              newBlocks[idx].tune = { ...(newBlocks[idx].tune || {}), tone: e.target.value as BlockTune['tone'] };
                              setEditingItem({ ...editingItem, blocks: newBlocks });
                            }}
                            className="w-full mt-0.5 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                          >
                            <option value="brand">Brand voice</option>
                            <option value="professional">Professional</option>
                            <option value="warm">Warm</option>
                            <option value="playful">Playful</option>
                            <option value="formal">Formal</option>
                            <option value="casual">Casual</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-semibold text-slate-500">Length</span>
                          <select
                            value={block.tune?.length || 'medium'}
                            onChange={(e) => {
                              const newBlocks = [...editingItem.blocks];
                              newBlocks[idx].tune = { ...(newBlocks[idx].tune || {}), length: e.target.value as BlockTune['length'] };
                              setEditingItem({ ...editingItem, blocks: newBlocks });
                            }}
                            className="w-full mt-0.5 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                          >
                            <option value="short">Short</option>
                            <option value="medium">Medium</option>
                            <option value="long">Long</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] font-semibold text-slate-500">Creativity</span>
                          <select
                            value={block.tune?.creativity || 'medium'}
                            onChange={(e) => {
                              const newBlocks = [...editingItem.blocks];
                              newBlocks[idx].tune = { ...(newBlocks[idx].tune || {}), creativity: e.target.value as BlockTune['creativity'] };
                              setEditingItem({ ...editingItem, blocks: newBlocks });
                            }}
                            className="w-full mt-0.5 text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </label>
                      </div>
                      <textarea
                        value={block.tune?.guidance || ''}
                        onChange={(e) => {
                          const newBlocks = [...editingItem.blocks];
                          newBlocks[idx].tune = { ...(newBlocks[idx].tune || {}), guidance: e.target.value };
                          setEditingItem({ ...editingItem, blocks: newBlocks });
                        }}
                        rows={2}
                        placeholder="Extra guidance (e.g. 'Emphasise the eco packaging, keep it under 60 words')"
                        className="w-full text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none placeholder:text-slate-400"
                      />
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Rewrites are woven from the article title "{editingItem.title || '—'}"{(() => {
                          const prevBlock = editingItem.blocks.slice(0, idx).filter((b: VisualBlock) => (b.content || '').trim()).slice(-1)[0];
                          const faqCount = editingItem.blocks.filter((b) => b.type === 'faq').flatMap((b) => b.faqItems || []).length;
                          return (
                            <>
                              , flowing on from {prevBlock ? `"${prevBlock.title || prevBlock.type}"` : 'the section above'}
                              {faqCount > 0 ? ` and into the ${faqCount} FAQ answers below` : ''}
                            </>
                          );
                        })()} — continuity is preserved no matter which model is used.
                      </p>
                    </div>
                    </>
                    )}
                  </div>
                ))
              )}
              
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => handleAddBlock('hero')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Hero</button>
                <button onClick={() => handleAddBlock('paragraph')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Paragraph</button>
                <button onClick={() => handleAddBlock('faq')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ FAQ</button>
                <button onClick={() => handleAddBlock('image_banner')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Image</button>
                <button onClick={() => handleAddBlock('cards')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Cards</button>
                <button onClick={() => handleAddBlock('quote')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Quote</button>
                <button onClick={() => handleAddBlock('cta_band')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ CTA Band</button>
                <button onClick={() => handleAddBlock('carousel')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Carousel</button>
                <button onClick={() => handleAddBlock('daniels_tip')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Daniel's Tip</button>
                <button onClick={() => handleAddBlock('newsletter')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Newsletter</button>
              </div>
            </div>
          )}

          {writeMode === 'html' && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
                <span className="text-xs font-semibold text-slate-500">HTML Editor</span>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${editingItem.targetWordCount && wordCount > 0 && Math.abs(wordCount - editingItem.targetWordCount) / editingItem.targetWordCount > 0.2 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                  {wordCount.toLocaleString()} words{editingItem.targetWordCount ? ` · target ${editingItem.targetWordCount.toLocaleString()}` : ''}
                </span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 bg-white flex-wrap">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5" /> Insert image
                </span>
                <button
                  onClick={handleHtmlInsertImage}
                  disabled={uploadingImgFor === 'html-editor'}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
                >
                  {uploadingImgFor === 'html-editor' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {uploadingImgFor === 'html-editor' ? 'Uploading…' : 'Upload from PC'}
                </button>
                <button onClick={handleHtmlInsertImageUrl} className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-semibold rounded-lg transition">
                  Paste image URL
                </button>
                <select
                  value={htmlImageLayout}
                  onChange={(e) => setHtmlImageLayout(e.target.value as any)}
                  className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none"
                >
                  <option value="full">Full width</option>
                  <option value="left">Float left</option>
                  <option value="right">Float right</option>
                  <option value="center">Centered</option>
                </select>
                {uploadErr && <span className="text-xs font-semibold text-red-600">{uploadErr}</span>}
              </div>
              <ReactQuill 
                theme="snow"
                value={editingItem.bodyHtml || ''}
                onChange={(value) => setEditingItem({ ...editingItem, bodyHtml: value })}
                className="bg-white min-h-[500px]"
              />
            </div>
          )}

          </div>
          )}

          {stepTab === 'seo' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap mb-5">
                <div>
                  <h3 className="font-bold text-slate-900 text-lg">Optimise & Refine</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Live on-page audit against Google's current guidelines, with one-click fixes.</p>
                </div>
                {liveSeoPct !== null && (
                  <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                    liveSeoPct >= 80 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    liveSeoPct >= 60 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                    'bg-red-50 text-red-600 border border-red-200'
                  }`}>
                    Score: {liveSeoPct}
                  </span>
                )}
              </div>
              <SeoPanel
                item={editingItem}
                onChange={(patch) =>
                  setEditingItem((prev) => {
                    const { blocks, ...rest } = patch as any;
                    return {
                      ...prev,
                      ...rest,
                      blocks: Array.isArray(blocks) && blocks.length ? blocks : prev.blocks,
                      status: 'Draft_Ready',
                      updatedAt: new Date().toISOString(),
                    };
                  })
                }
                siteUrl={brand?.wpUrl || undefined}
                wordCount={wordCount}
                onScore={setLiveSeoPct}
                onGeneration={logGeneration}
                modelPref={aiPref}
                brand={brand || null}
              />
            </div>
          )}

          {/* Step: Visuals — featured image & artwork */}
          {stepTab === 'visuals' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Featured image */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-slate-400" /> Featured Image
                  </h3>
                  {editingItem.featuredImageUrl && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Set ✓</span>
                  )}
                </div>

                {editingItem.featuredImageUrl ? (
                  <div className="relative rounded-xl overflow-hidden group border border-slate-200">
                    <img src={editingItem.featuredImageUrl} alt="Featured" className="w-full h-56 object-cover" />
                    <button
                      onClick={() => { setEditingItem({...editingItem, featuredImageUrl: undefined}); setNanoImageMeta(null); }}
                      className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    {nanoImageMeta?.isPlaceholder && (
                      <div className="absolute inset-x-0 bottom-0 bg-amber-500/95 text-white text-[11px] leading-snug p-2.5">
                        <strong>Placeholder — not an AI render.</strong>{' '}
                        {nanoImageMeta.message}
                      </div>
                    )}
                    {nanoImageMeta?.isAiGenerated && (
                      <span className="absolute top-2 left-2 bg-emerald-600/90 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm">
                        AI · {nanoImageMeta.provider} · {nanoImageMeta.model}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="h-56 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                    <ImagePlus className="w-8 h-8 mb-2" />
                    <span className="text-sm font-medium">No featured image yet</span>
                    <span className="text-xs text-slate-400 mt-1">Generate concepts on the right, then render one.</span>
                  </div>
                )}

                <button
                  onClick={handleFetchNanoPrompts}
                  disabled={isGeneratingPrompts}
                  className="w-full py-2.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 rounded-xl text-sm font-semibold transition"
                >
                  {isGeneratingPrompts ? 'Analyzing article...' : 'Generate Image Ideas'}
                </button>
              </div>

              {/* Secondary (in-body) image */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-slate-400" /> Secondary Image
                  </h3>
                  {editingItem.secondaryImageUrl && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Set ✓</span>
                  )}
                </div>

                {editingItem.secondaryImageUrl ? (
                  <div className="relative rounded-xl overflow-hidden group border border-slate-200">
                    <img src={editingItem.secondaryImageUrl} alt="Secondary" className="w-full h-56 object-cover" />
                    <button
                      onClick={() => { setEditingItem({ ...editingItem, secondaryImageUrl: undefined, updatedAt: new Date().toISOString() }); }}
                      className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="h-56 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                    <ImagePlus className="w-8 h-8 mb-2" />
                    <span className="text-sm font-medium">No secondary image yet</span>
                    <span className="text-xs text-slate-400 mt-1">Auto-Write generates one; it renders inside the article body.</span>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 leading-snug">
                  In-body editorial image generated from the article topic + context with the paid Nano Banana model. It appears as a figure inside the published post.
                </p>
              </div>

              {/* Prompt library + studio */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4 text-slate-400" /> Concept Library
                  </h3>
                  {nanoPrompts.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {visualCats.map((c) => (
                        <button
                          key={c}
                          onClick={() => setVisualCatFilter(c)}
                          className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border transition ${
                            visualCatFilter === c
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {filteredNanoPrompts.length === 0 ? (
                  <div className="py-10 text-center text-slate-400">
                    <Sparkles className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="text-sm font-medium text-slate-500">
                      {nanoPrompts.length === 0
                        ? 'Click "Generate Image Ideas" to get AI concept prompts for this article.'
                        : 'No concepts in this category.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {filteredNanoPrompts.map((p, idx) => (
                      <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 uppercase tracking-wider">
                            {p.category || 'Concept'}
                          </span>
                          {p.style && <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.style}</span>}
                          {p.lighting && <span className="text-[9px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.lighting}</span>}
                        </div>
                        <p className="text-xs text-slate-700 leading-snug">"{p.prompt}"</p>
                        <button
                          onClick={() => { setImagePromptText(p.prompt); setSelectedPromptIdx(idx); }}
                          disabled={isGeneratingImage}
                          className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                          <Pencil className="w-3 h-3" />
                          {selectedPromptIdx === idx ? 'Selected — edit below' : 'Use this prompt'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Prompt studio: editable + AI-refinable, always topic-bound */}
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Wand2 className="w-3.5 h-3.5 text-indigo-500" /> Prompt Studio
                    </h4>
                    {imageTopicContext && (
                      <span className="text-[10px] text-slate-400 flex items-center gap-1">
                        <Target className="w-3 h-3" /> Auto-locked to: <span className="text-slate-500 max-w-[220px] truncate">"{editingItem.title || editingItem.primaryKeyword}"</span>
                      </span>
                    )}
                  </div>
                  <textarea
                    value={imagePromptText}
                    onChange={(e) => { setImagePromptText(e.target.value); setSelectedPromptIdx(null); }}
                    placeholder="Type an image prompt, or pick a concept above and tweak it…"
                    rows={3}
                    className="w-full text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-y"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleRefineImagePrompt}
                      disabled={isRefiningPrompt || isGeneratingImage}
                      className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isRefiningPrompt ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                      Refine with AI
                    </button>
                    <button
                      onClick={handleRenderImage}
                      disabled={isRefiningPrompt || isGeneratingImage || !imagePromptText?.trim()}
                      className="px-4 py-2 rounded-lg text-xs font-bold text-white transition disabled:opacity-50 flex items-center gap-1.5"
                      style={{ backgroundColor: brandColor(brand?.name) }}
                    >
                      {isGeneratingImage ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {isGeneratingImage ? 'Rendering…' : 'Render as featured image'}
                    </button>
                    {imagePromptText?.trim() && (
                      <span className="text-[10px] text-slate-400">
                        {imagePromptText.trim().length} chars · rendered with topic context
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step: Publish — launch to WordPress */}
          {stepTab === 'publish' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                      <Rocket className="w-5 h-5 text-indigo-500" /> Launch to WordPress
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Confirm the pre-flight checklist, then sync to the live site.</p>
                  </div>
                  {wpState !== 'none' && (
                    <div className={`w-full rounded-xl border px-4 py-3 flex items-start gap-3 ${
                      wpState === 'live'
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-sky-50 border-sky-200'
                    }`}>
                      <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
                        wpState === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-sky-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 flex items-center gap-2 flex-wrap">
                          {wpState === 'live' ? (
                            <><CheckCircle2 className="w-4 h-4 text-emerald-600" /> LIVE on the site — visitors can see this post</>
                          ) : (
                            <><EyeOff className="w-4 h-4 text-sky-600" /> DRAFT — saved to WordPress, hidden from visitors</>
                          )}
                        </p>
                        <p className="text-xs text-slate-500 mt-1 truncate">
                          Post #{editingItem.wpPostId}{wpSlug ? ` · ${wpSlug}` : ''}
                          {wpState === 'live' && wpLiveUrl && (
                            <> · <a href={wpLiveUrl} target="_blank" rel="noreferrer" className="text-emerald-700 font-semibold hover:underline">view live post ↗</a></>
                          )}
                          {wpState === 'draft' && wpPreviewUrl && (
                            <> · <a href={wpPreviewUrl} target="_blank" rel="noreferrer" className="text-sky-700 font-semibold hover:underline">open WP preview ↗</a></>
                          )}
                          {editingItem.lastSyncedAt && <> · synced {new Date(editingItem.lastSyncedAt).toLocaleString()}</>}
                        </p>
                      </div>
                      <button
                        onClick={handleRefreshWpState}
                        disabled={isSyncingWp}
                        className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition flex items-center gap-1"
                        title="Re-check the real status of this post on WordPress"
                      >
                        <RefreshCw className="w-3 h-3" /> Refresh status
                      </button>
                    </div>
                  )}
                  {wpState === 'none' && (
                    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-3">
                      <Rocket className="w-4 h-4 text-slate-400 shrink-0" />
                      <div>
                        <p className="text-sm font-bold text-slate-700">Not on WordPress yet</p>
                        <p className="text-xs text-slate-500 mt-0.5">Save as a draft to park it hidden, or publish live when ready — syncing always updates the same post.</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2.5">
                  {publishChecks.map((c) => (
                    <div key={c.label} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                      <span className="text-sm font-medium text-slate-700">{c.label}</span>
                      <span className="flex items-center gap-1.5">
                        {c.ok ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Ready</span>
                        ) : c.na ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Run SEO audit</span>
                        ) : c.warn ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Low score</span>
                        ) : c.optional ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Optional</span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 flex items-center gap-1">
                            <XCircle className="w-3 h-3" /> Not ready
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Schedule for later — date/time picker */}
                {editingItem.status !== 'Published' && (
                  <div className="flex items-end gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                    <Calendar className="w-4 h-4 text-slate-400 shrink-0 mb-1.5" />
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Schedule for later</label>
                      <input
                        type="date"
                        defaultValue={editingItem.scheduledPublishAt ? new Date(editingItem.scheduledPublishAt).toISOString().split('T')[0] : ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            const time = editingItem.scheduledPublishAt
                              ? new Date(editingItem.scheduledPublishAt).toTimeString().slice(0, 5)
                              : '09:00';
                            const dt = new Date(`${e.target.value}T${time}:00`);
                            if (dt.getTime() <= Date.now()) {
                              setAiError('Cannot schedule in the past — pick a future date/time.');
                              return;
                            }
                            setEditingItem((prev) => prev ? { ...prev, scheduledPublishAt: dt.toISOString() } : prev);
                            onSaveItem({ ...editingItem, scheduledPublishAt: dt.toISOString(), updatedAt: new Date().toISOString() });
                          }
                        }}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Time</label>
                      <input
                        type="time"
                        defaultValue={editingItem.scheduledPublishAt ? new Date(editingItem.scheduledPublishAt).toTimeString().slice(0, 5) : '09:00'}
                        onChange={(e) => {
                          const date = editingItem.scheduledPublishAt
                            ? new Date(editingItem.scheduledPublishAt).toISOString().split('T')[0]
                            : new Date().toISOString().split('T')[0];
                          if (e.target.value) {
                            const dt = new Date(`${date}T${e.target.value}:00`);
                            if (dt.getTime() <= Date.now()) {
                              setAiError('Cannot schedule in the past — pick a future date/time.');
                              return;
                            }
                            setEditingItem((prev) => prev ? { ...prev, scheduledPublishAt: dt.toISOString() } : prev);
                            onSaveItem({ ...editingItem, scheduledPublishAt: dt.toISOString(), updatedAt: new Date().toISOString() });
                          }
                        }}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-500 outline-none"
                      />
                    </div>
                    {editingItem.scheduledPublishAt && (
                      <button
                        onClick={() => {
                          setEditingItem((prev) => prev ? { ...prev, scheduledPublishAt: undefined } : prev);
                          onSaveItem({ ...editingItem, scheduledPublishAt: undefined, updatedAt: new Date().toISOString() });
                        }}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium transition"
                      >
                        Clear
                      </button>
                    )}
                    {editingItem.scheduledPublishAt && (
                      <span className="text-[11px] text-violet-600 font-medium ml-1 mb-1.5">
                        🔵 Scheduled: {new Date(editingItem.scheduledPublishAt).toLocaleDateString()} {new Date(editingItem.scheduledPublishAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    onClick={() => handleSyncToWordPress('draft')}
                    disabled={isSyncingWp || !(draftReady || wpState === 'live')}
                    className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition shadow-sm ${
                      wpState === 'live'
                        ? 'bg-sky-50 border border-sky-300 text-sky-700 hover:bg-sky-100'
                        : 'disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed bg-white border border-slate-300 hover:bg-slate-50 text-slate-700'
                    }`}
                    title={wpState === 'live'
                      ? 'Move this post back to a hidden draft on WordPress — one click, same post'
                      : draftReady ? 'Save to WordPress as a draft (not visible on the site)' : 'Set a title, write 50+ words and add WordPress credentials first'}
                  >
                    <Save className="w-4 h-4" />
                    {isSyncingWp ? 'Saving…' : wpState === 'live' ? 'Switch to draft (hide)' : 'Save as draft'}
                  </button>
                  <button
                    onClick={() => handleSyncToWordPress('publish')}
                    disabled={isSyncingWp || !(publishReady || wpState === 'live')}
                    className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-bold transition shadow-sm ${
                      wpState === 'live'
                        ? 'text-white hover:brightness-110'
                        : 'disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white hover:brightness-110'
                    }`}
                    style={(publishReady || wpState === 'live') && !isSyncingWp ? { backgroundColor: brandColor(brand) } : undefined}
                    title={wpState === 'live'
                      ? 'Re-publish the latest content to the existing live post — one click, same post'
                      : publishReady ? 'Publish live on the site (or update the existing live post)' : 'Complete the required checklist items first'}
                  >
                    <Send className="w-4 h-4" />
                    {isSyncingWp ? 'Publishing…' : wpState === 'live' ? 'Update live post' : 'Publish live'}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 -mt-1">
                  <strong className="text-slate-500">Live</strong> makes the post public with a clean permalink.
                  <strong className="text-slate-500"> Draft</strong> keeps it hidden until you're ready.
                  Both switch in one click and always update the same WordPress post — never a duplicate.
                </p>

                {syncStatusMsg && (
                  <div className={`px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-3 ${
                    /error|Error|Network/i.test(syncStatusMsg)
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  }`}>
                    <RefreshCw className={`w-4 h-4 ${isSyncingWp ? 'animate-spin' : ''}`} />
                    {syncStatusMsg}
                  </div>
                )}
                {editingItem.lastSyncedAt && (
                  <p className="text-[11px] text-slate-400">Last synced {new Date(editingItem.lastSyncedAt).toLocaleString()}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <button
                  onClick={handleOpenPreview}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-left hover:border-indigo-200 hover:shadow-md transition group"
                >
                  <Eye className="w-5 h-5 text-slate-400 mb-3 group-hover:text-indigo-500 transition" />
                  <p className="font-bold text-slate-900 text-sm">Preview Post</p>
                  <p className="text-xs text-slate-500 mt-1">See the post exactly as it renders on the site.</p>
                </button>
                {wpState !== 'live' && wpPreviewUrl && (
                  <a
                    href={wpPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm block hover:border-sky-200 hover:shadow-md transition group"
                  >
                    <ExternalLink className="w-5 h-5 text-slate-400 mb-3 group-hover:text-sky-500 transition" />
                    <p className="font-bold text-slate-900 text-sm">Open WordPress Preview</p>
                    <p className="text-xs text-slate-500 mt-1">Native WP draft preview in a new tab.</p>
                  </a>
                )}
                {wpState === 'live' && wpLiveUrl && (
                  <a
                    href={wpLiveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm block hover:border-emerald-200 hover:shadow-md transition group"
                  >
                    <ExternalLink className="w-5 h-5 text-slate-400 mb-3 group-hover:text-emerald-500 transition" />
                    <p className="font-bold text-slate-900 text-sm">View Live Post</p>
                    <p className="text-xs text-emerald-600 mt-1 truncate">{wpLiveUrl}</p>
                  </a>
                )}
              </div>
            </div>
          )}

      {/* Unified Post Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex p-4 md:p-8">
          <div className="bg-white rounded-2xl shadow-2xl flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900">Post Preview</h3>
                {previewData && (
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wider ${
                    previewData.mode === 'live'
                      ? 'bg-emerald-50 text-emerald-700'
                      : previewData.mode === 'draft'
                      ? 'bg-sky-50 text-sky-700'
                      : previewData.fallback
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-indigo-50 text-indigo-700'
                  }`}>
                    {previewModeLabel(previewData.mode, previewData.fallback)}
                  </span>
                )}
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                  {wordCount.toLocaleString()} words
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex rounded-lg border border-slate-200 overflow-hidden">
                  <button
                    onClick={() => setPreviewDevice('desktop')}
                    className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition ${
                      previewDevice === 'desktop' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" /> Desktop
                  </button>
                  <button
                    onClick={() => setPreviewDevice('mobile')}
                    className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition ${
                      previewDevice === 'mobile' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" /> Mobile
                  </button>
                </div>
                <button
                  onClick={handleOpenPreview}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                  title="Re-fetch the preview"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${previewLoading ? 'animate-spin' : ''}`} />
                </button>
                {previewData?.url && (
                  <a
                    href={previewData.url}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Open New Tab
                  </a>
                )}
                <button onClick={() => setPreviewOpen(false)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition">
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-100 p-4 md:p-6">
              {previewLoading && (
                <div className="h-full min-h-[420px] flex items-center justify-center text-sm text-slate-500 gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading preview…
                </div>
              )}
              {!previewLoading && previewError && (
                <div className="h-full min-h-[420px] flex items-center justify-center">
                  <div className="text-center max-w-sm">
                    <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                    <p className="text-sm font-semibold text-slate-700">Couldn't load the preview</p>
                    <p className="text-xs text-slate-500 mt-1">{previewError}</p>
                    <button onClick={handleOpenPreview} className="mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition">
                      Try again
                    </button>
                  </div>
                </div>
              )}
              {!previewLoading && previewData && (
                <div className={`mx-auto transition-all ${previewDevice === 'mobile' ? 'max-w-[390px]' : 'max-w-[1100px]'}`}>
                  <iframe
                    srcDoc={previewData.html}
                    sandbox="allow-same-origin allow-scripts"
                    className="w-full bg-white shadow-lg rounded-xl border border-slate-200"
                    style={{ minHeight: previewDevice === 'mobile' ? '780px' : 'calc(100vh - 240px)' }}
                    title="Post preview"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
