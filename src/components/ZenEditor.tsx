import { fetchGlobalKeys, fetchAiPref, saveAiPref, AI_MODEL_OPTIONS } from "../lib/keys";
import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ContentItem, Brand, VisualBlock, VisualBlockType, PipelineStatus, GenerationLogEntry, AiModelPref } from '../types';
import { SeoPanel } from './SeoPanel';
import { 
  Sparkles, 
  Image as ImageIcon, 
  Eye, 
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
  GripVertical
} from 'lucide-react';

// Blog production workflow — the order every post moves through
const WORKFLOW_STAGES = [
  { status: 'Planned', label: 'Plan', icon: Lightbulb, hint: 'Idea, outline & keyword brief' },
  { status: 'Researching', label: 'Research', icon: Compass, hint: 'Competitor & source research' },
  { status: 'Generating', label: 'Write', icon: PenLine, hint: 'Auto-write & structure content' },
  { status: 'Draft_Ready', label: 'Review', icon: SearchCheck, hint: 'SEO audit & final polish' },
  { status: 'Published', label: 'Live', icon: Rocket, hint: 'Synced to WordPress' },
] as const;

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
// Rough word count for streamed HTML text (client-side live counter)
const countWords = (text: string = '') =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;

interface ZenEditorProps {
  item?: ContentItem | null;
  brand: Brand;
  onSaveItem: (updatedItem: ContentItem) => Promise<void> | void;
  onSyncToWP: (contentItem: ContentItem) => Promise<void>;
  onCreateNewItem?: (title: string, brandId: string, contentType: 'post' | 'page') => void;
}

export const ZenEditor: React.FC<ZenEditorProps> = ({
  item,
  brand,
  onSaveItem,
  onSyncToWP,
  onCreateNewItem,
}) => {
  const [editingItem, setEditingItem] = useState<ContentItem | null>(item || null);
  const [newDraftTitle, setNewDraftTitle] = useState('');
  const [newDraftType, setNewDraftType] = useState<'post' | 'page'>('post');
  const [applyHumanization, setApplyHumanization] = useState(true);
  // Workflow steps: Brief -> Write -> SEO -> Visuals -> Publish
  const [stepTab, setStepTab] = useState<'brief' | 'write' | 'seo' | 'visuals' | 'publish'>('write');
  const [writeMode, setWriteMode] = useState<'visual' | 'html'>('visual');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  // Live generation transparency: percentage, phase message, the model's text
  // as it writes, and heartbeat info so "slow" is never confused with "stuck".
  const [genState, setGenState] = useState<{
    phase: string;
    percent: number;
    words: number;
    text: string;
    elapsed: number;
    lastUpdate: number;
    stalled: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUpdateRef = useRef<number>(Date.now());
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
  // Generation history: timestamped, model-attributed record of every AI action.
  const logGeneration = (entry: GenerationLogEntry) => {
    setEditingItem((prev) => ({
      ...prev,
      generationLog: [entry, ...(prev.generationLog || [])].slice(0, 30),
    }));
  };
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

  const visualCats = ['All', 'Product Focused', 'Lifestyle Focused', 'Abstract Minimalist'];
  const filteredNanoPrompts = (nanoPrompts || []).filter(
    (p) => visualCatFilter === 'All' || p.category === visualCatFilter
  );

  const handleGenerateWithGemini = async () => {
    setIsGeneratingAi(true);
    setAiError(null);
    lastUpdateRef.current = Date.now();
    setGenState({ phase: 'Connecting…', percent: 2, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false });
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
          applyHumanization,
          targetWordCount: editingItem.targetWordCount,
          modelPref: aiPref,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText?.slice(0, 200) || `Generation failed (HTTP ${res.status}).`);
      }

      // NDJSON stream: {"type":"status"|"stream"|"heartbeat"|"done"|"error", ...}
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamedText = '';
      let completed = false;

      const handleEvent = (evt: any) => {
        if (evt.type === 'status') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => ({ ...(prev || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false }), phase: evt.message || evt.phase || '', percent: evt.percent ?? prev?.percent ?? 0, stalled: false }));
        } else if (evt.type === 'stream') {
          lastUpdateRef.current = Date.now();
          streamedText += evt.text || '';
          setGenState((prev) => ({ ...(prev || { phase: '', percent: 0, words: 0, text: '', elapsed: 0, lastUpdate: Date.now(), stalled: false }), phase: evt.phase || prev?.phase || 'Writing…', percent: evt.percent ?? prev?.percent ?? 0, words: evt.words ?? countWords(streamedText), text: streamedText, stalled: false }));
        } else if (evt.type === 'heartbeat') {
          lastUpdateRef.current = Date.now();
          setGenState((prev) => (prev ? { ...prev, elapsed: evt.elapsed ?? prev.elapsed, stalled: false } : prev));
        } else if (evt.type === 'error') {
          throw new Error(evt.error || 'Generation failed.');
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

    setEditingItem((prev) => ({
      ...prev,
      bodyHtml: aiData.bodyHtml || prev.bodyHtml,
      seoBrief: aiData.seoBrief || prev.seoBrief,
      metaTitle: aiData.metaTitle || prev.metaTitle,
      metaDescription: aiData.metaDescription || prev.metaDescription,
      nanoBananaPrompt: aiData.suggestedNanoPrompt || prev.nanoBananaPrompt,
      blocks: updatedBlocks.length > 0 ? updatedBlocks : prev.blocks,
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
          modelProvider: 'gemini',
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
          updatedAt: new Date().toISOString(),
        }));
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

  const handleSyncToWordPress = async () => {
    setIsSyncingWp(true);
    setSyncStatusMsg('Syncing to WP...');
    try {
      const res = await fetch('/api/wp/sync-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          contentItem: editingItem,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const updated = {
          ...editingItem,
          wpPostId: data.wpPostId,
          wpPreviewUrl: data.previewUrl,
          wpLiveUrl: data.link,
          status: (data.status || 'Published') as PipelineStatus,
          lastSyncedAt: new Date().toISOString(),
        };
        setEditingItem(updated);
        onSaveItem(updated);
        setSyncStatusMsg('Synced successfully!');
      } else {
        setSyncStatusMsg(`Sync error: ${data.message}`);
      }
    } catch (err: any) {
      setSyncStatusMsg(`Network error: ${err.message}`);
    } finally {
      setIsSyncingWp(false);
      // Keep error messages visible; only auto-clear successes.
      setTimeout(() => {
        setSyncStatusMsg((msg) => (msg && msg.includes('Synced') ? null : msg));
      }, 3000);
    }
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
    const newBlock: VisualBlock = {
      id: `block-${Date.now()}`,
      type,
      title: type === 'hero' ? 'New Hero Heading' : type === 'faq' ? 'FAQ Section' : 'Section Title',
      subtitle: 'Section Subtitle',
      content: 'Write content here...',
      buttonText: 'Learn More',
      buttonUrl: '#',
    };
    setEditingItem({
      ...editingItem,
      blocks: [...(editingItem.blocks || []), newBlock],
    });
  };

  const handleRemoveBlock = (id: string) => {
    setEditingItem({
      ...editingItem,
      blocks: (editingItem.blocks || []).filter((b) => b.id !== id),
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
              {nextStage ? (
                <button
                  onClick={() => handleSetStage(nextStage.status as PipelineStatus)}
                  className="text-[11px] font-bold hover:opacity-80 flex items-center gap-1.5 transition group"
                  style={{ color: brandColor(brand) }}
                >
                  Next: <span className="underline underline-offset-2">{nextStage.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              ) : (
                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> This post is live — use Publish to WP to re-sync changes
                </span>
              )}
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
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Focus Keyphrase</label>
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
          {/* Write controls */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-wrap items-center gap-3">
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
              <label
                title="Rewrites generated content to read as naturally human-written"
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer select-none hover:bg-slate-50 transition shadow-sm"
              >
                <input
                  type="checkbox"
                  checked={applyHumanization}
                  onChange={(e) => setApplyHumanization(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
                Humanise
              </label>
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
          </div>

          {/* Live generation progress: percent, phase, heartbeat, live draft */}
          {isGeneratingAi && genState && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      {!genState.stalled && <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style={{ backgroundColor: brandColor(brand) }} />}
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: genState.stalled ? '#f59e0b' : brandColor(brand) }} />
                    </span>
                    <span className="text-sm font-bold text-slate-800 truncate">
                      {genState.stalled ? '⚠ Waiting on the model…' : genState.phase}
                    </span>
                  </div>
                  <span className="text-xs font-bold tabular-nums px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                    {genState.percent}%
                  </span>
                </div>

                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(2, genState.percent)}%`,
                      backgroundColor: genState.stalled ? '#f59e0b' : brandColor(brand),
                    }}
                  />
                </div>

                <div className="flex items-center justify-between flex-wrap gap-2 text-[11px] text-slate-500">
                  <span className="tabular-nums">
                    {genState.words.toLocaleString()} words written
                    {editingItem.targetWordCount ? ` · target ${editingItem.targetWordCount.toLocaleString()}` : ''}
                  </span>
                  <span className={`tabular-nums font-semibold ${genState.stalled ? 'text-amber-600' : 'text-slate-400'}`}>
                    {genState.elapsed}s elapsed · last update {genState.stalled ? '> 45s ago' : 'live'}
                  </span>
                </div>

                {genState.stalled && (
                  <div className="px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium">
                    No updates for 45+ seconds. The model may be slow (quota pressure) — you can keep waiting or cancel and retry.
                  </div>
                )}

                <details className="group">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-600 hover:text-slate-800 select-none flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    Live draft — watch the model write
                    <span className="ml-auto text-[10px] font-normal text-slate-400 group-open:hidden">tap to expand</span>
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-slate-900 text-slate-100 text-[11px] leading-relaxed font-mono p-3 whitespace-pre-wrap">
                    {genState.text || 'Waiting for the first words…'}
                  </div>
                </details>

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={cancelGeneration}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition"
                  >
                    Cancel generation
                  </button>
                </div>
              </div>
            </div>
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

          {/* Generation history: timestamped, model-attributed AI activity */}
          {!!editingItem.generationLog?.length && (
            <details className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden group">
              <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-slate-700 flex items-center gap-2 hover:bg-slate-50 select-none">
                <ClipboardList className="w-4 h-4 text-slate-400" />
                Generation history
                <span className="ml-auto text-[11px] font-normal text-slate-400 group-open:hidden">tap to expand</span>
              </summary>
              <div className="px-4 pb-4 space-y-1.5">
                {editingItem.generationLog.map((g, idx) => (
                  <div key={idx} className="flex items-center gap-2.5 text-xs py-1.5 border-b border-slate-100 last:border-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${g.ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
                    <span className="tabular-nums text-slate-400 shrink-0">
                      {new Date(g.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="font-semibold text-slate-700 shrink-0">{g.action}</span>
                    <span
                      className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 font-mono text-[10px] min-w-0 truncate"
                      title={`${g.provider}/${g.model}${g.fallback ? ' (auto-fallback)' : ''}`}
                    >
                      {g.provider}/{g.model}
                      {g.fallback ? ' · fallback' : ''}
                    </span>
                    {typeof g.words === 'number' && g.words > 0 && (
                      <span className="tabular-nums text-slate-500 shrink-0">{g.words.toLocaleString()} words</span>
                    )}
                    {!!g.durationMs && <span className="tabular-nums text-slate-400 shrink-0">{(g.durationMs / 1000).toFixed(0)}s</span>}
                    {!g.ok && g.error && <span className="text-red-500 truncate">{g.error}</span>}
                  </div>
                ))}
              </div>
            </details>
          )}

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
                  </div>
                ))
              )}
              
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={() => handleAddBlock('hero')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Hero</button>
                <button onClick={() => handleAddBlock('paragraph')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ Paragraph</button>
                <button onClick={() => handleAddBlock('faq')} className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-xl text-sm font-semibold transition shadow-sm">+ FAQ</button>
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
                onChange={(patch) => setEditingItem({ ...editingItem, ...patch })}
                siteUrl={brand?.wpUrl || undefined}
                wordCount={wordCount}
                onScore={setLiveSeoPct}
                onGeneration={logGeneration}
                modelPref={aiPref}
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
                      onClick={() => setEditingItem({...editingItem, featuredImageUrl: undefined})}
                      className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
                  {editingItem.status === 'Published' && (
                    <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Live on {brand?.wpUrl ? brand.wpUrl.replace(/^https?:\/\//, '') : 'WordPress'}
                    </span>
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

                <button
                  onClick={handleSyncToWordPress}
                  disabled={isSyncingWp || !publishReady}
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition shadow-sm hover:brightness-110"
                  style={publishReady && !isSyncingWp ? { backgroundColor: brandColor(brand) } : undefined}
                  title={publishReady ? 'Sync article to WordPress' : 'Complete the required checklist items first'}
                >
                  <Send className="w-4 h-4" />
                  {isSyncingWp ? 'Syncing to WordPress…' : editingItem.status === 'Published' ? 'Update on WordPress' : 'Publish to WordPress'}
                </button>

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
                {editingItem.wpPreviewUrl && (
                  <a
                    href={editingItem.wpPreviewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm block hover:border-sky-200 hover:shadow-md transition group"
                  >
                    <ExternalLink className="w-5 h-5 text-slate-400 mb-3 group-hover:text-sky-500 transition" />
                    <p className="font-bold text-slate-900 text-sm">Open WordPress Preview</p>
                    <p className="text-xs text-slate-500 mt-1">Native WP draft preview in a new tab.</p>
                  </a>
                )}
                {editingItem.wpLiveUrl && (
                  <a
                    href={editingItem.wpLiveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm block hover:border-emerald-200 hover:shadow-md transition group"
                  >
                    <ExternalLink className="w-5 h-5 text-slate-400 mb-3 group-hover:text-emerald-500 transition" />
                    <p className="font-bold text-slate-900 text-sm">View Live Post</p>
                    <p className="text-xs text-emerald-600 mt-1 truncate">{editingItem.wpLiveUrl}</p>
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
