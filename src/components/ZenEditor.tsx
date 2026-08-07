import { fetchGlobalKeys } from "../lib/keys";
import React, { useState, useEffect, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ContentItem, Brand, VisualBlock, VisualBlockType, PipelineStatus } from '../types';
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
  Layers
} from 'lucide-react';

// Blog production workflow — the order every post moves through
const WORKFLOW_STAGES = [
  { status: 'Planned', label: 'Plan', icon: Lightbulb, hint: 'Idea, outline & keyword brief' },
  { status: 'Researching', label: 'Research', icon: Compass, hint: 'Competitor & source research' },
  { status: 'Generating', label: 'Write', icon: PenLine, hint: 'Auto-write & structure content' },
  { status: 'Draft_Ready', label: 'Review', icon: SearchCheck, hint: 'SEO audit & final polish' },
  { status: 'Published', label: 'Live', icon: Rocket, hint: 'Synced to WordPress' },
] as const;

interface ZenEditorProps {
  item: ContentItem;
  brand: Brand;
  onSaveItem: (updatedItem: ContentItem) => Promise<void> | void;
  onSyncToWP: (contentItem: ContentItem) => Promise<void>;
}

export const ZenEditor: React.FC<ZenEditorProps> = ({
  item,
  brand,
  onSaveItem,
  onSyncToWP,
}) => {
  const [editingItem, setEditingItem] = useState<ContentItem>(item);
  const [applyHumanization, setApplyHumanization] = useState(true);
  // Workflow steps: Brief -> Write -> SEO -> Visuals -> Publish
  const [stepTab, setStepTab] = useState<'brief' | 'write' | 'seo' | 'visuals' | 'publish'>('write');
  const [writeMode, setWriteMode] = useState<'visual' | 'html'>('visual');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSyncingWp, setIsSyncingWp] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  
  const [nanoPrompts, setNanoPrompts] = useState<any[]>([]);
  const [visualCatFilter, setVisualCatFilter] = useState<string>('All');
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [blockRewriteDirections, setBlockRewriteDirections] = useState<Record<string, string>>({});
  const [isRewritingBlock, setIsRewritingBlock] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving...' | 'Edited'>('Saved');
  const [liveSeoPct, setLiveSeoPct] = useState<number | null>(null);
  const [showSitePreview, setShowSitePreview] = useState(false);
  const [previewChrome, setPreviewChrome] = useState<{ headLinks?: string; headerHtml?: string; footerHtml?: string; siteTitle?: string } | null>(null);
  const [previewChromeState, setPreviewChromeState] = useState<'site' | 'brand' | 'loading'>('brand');
  // Brief tab controls
  const [newSecondaryKeyword, setNewSecondaryKeyword] = useState('');

  // Live word count from the article body (HTML stripped)
  const wordCount = useMemo(() => {
    const plain = (editingItem.bodyHtml || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain ? plain.split(' ').filter(Boolean).length : 0;
  }, [editingItem.bodyHtml]);

  useEffect(() => {
    setEditingItem(item);
  }, [item.id]);

  useEffect(() => {
    if (editingItem === item) return;
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
  const currentStageIdx = WORKFLOW_STAGES.findIndex((s) => s.status === editingItem.status);
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
    { label: 'Article title set', ok: !!editingItem.title?.trim(), optional: false },
    { label: 'Content written (50+ words)', ok: wordCount >= 50, optional: false },
    { label: 'Focus keyphrase set', ok: !!editingItem.primaryKeyword?.trim(), optional: false },
    { label: 'SEO score ≥ 60', ok: liveSeoPct !== null && liveSeoPct >= 60, warn: liveSeoPct !== null && liveSeoPct < 60, na: liveSeoPct === null, optional: false },
    { label: 'Featured image', ok: !!editingItem.featuredImageUrl, optional: true },
    { label: 'WordPress credentials', ok: !!(brand?.wpUrl && brand?.wpAppPassword), optional: false },
  ];
  const publishReady = publishChecks.filter((c) => !c.optional).every((c) => c.ok);

  const visualCats = ['All', 'Product Focused', 'Lifestyle Focused', 'Abstract Minimalist'];
  const filteredNanoPrompts = (nanoPrompts || []).filter(
    (p) => visualCatFilter === 'All' || p.category === visualCatFilter
  );

  const handleGenerateWithGemini = async () => {
    setIsGeneratingAi(true);
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
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      
      if (data.success && data.data) {
        const aiData = data.data;
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
      }
    } catch (e: any) {
      console.error('Error generating article:', e);
      alert('Generation Error: ' + e.message);
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const loadSiteChrome = async (force = false) => {
    if (previewChrome && !force) return previewChrome;
    setPreviewChromeState('loading');
    try {
      const res = await fetch('/api/wp/site-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wpUrl: brand?.wpUrl || '' }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setPreviewChrome(data.data);
        setPreviewChromeState('site');
        return data.data;
      }
    } catch (e) {
      console.error('Failed to load live site chrome:', e);
    }
    setPreviewChromeState('brand');
    return null;
  };

  const handleOpenSitePreview = async () => {
    setShowSitePreview(true);
    await loadSiteChrome();
  };

  const buildPreviewDoc = (chrome: { headLinks?: string; headerHtml?: string; footerHtml?: string; siteTitle?: string } | null) => {
    const title = editingItem.metaTitle || editingItem.title || 'Untitled';
    const body = editingItem.bodyHtml || '<p style="color:#888">No content yet — run Auto-Write or add blocks first.</p>';
    const brandName = brand?.name || 'Brand';
    const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const baseStyles = `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;margin:0}.entry-content{line-height:1.75;color:#333}.entry-content h2{font-size:1.75rem;font-weight:700;margin:1.8em 0 .6em;color:#111}.entry-content h3{font-size:1.3rem;font-weight:600;margin:1.5em 0 .5em;color:#222}.entry-content p{margin:0 0 1.1em}.entry-content ol,.entry-content ul{margin:0 0 1.2em;padding-left:1.5em}.entry-content strong{color:#111}`;

    if (chrome && chrome.headerHtml) {
      return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>
${chrome.headLinks || ''}
<style>${baseStyles}.ast-container{max-width:1200px;margin:0 auto;padding:0 20px}.article-shell{max-width:820px;margin:0 auto;padding:40px 20px}</style>
</head>
<body class="wp-singular ast-desktop ast-plain-container ast-no-sidebar astra-theme">
${chrome.headerHtml}
<main id="main" class="site-main"><div class="ast-container"><div class="article-shell">
<article class="post type-post status-publish entry">
<header class="entry-header ast-no-thumbnail ast-header-without-markup">
<h1 class="entry-title" style="font-size:2.2rem;font-weight:800;margin:0 0 .3em">${title}</h1>
<div style="font-size:.85rem;color:#888;margin-bottom:1.6em">${today} · ${brandName}</div>
</header>
<div class="entry-content">${body}</div>
</article>
</div></div></main>
${chrome.footerHtml}
</body></html>`;
    }

    // Branded fallback chrome (live site unreachable)
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>
<style>${baseStyles}</style>
</head>
<body>
<header style="background:${brand?.primaryColor || '#4f46e5'};color:#fff">
<div style="max-width:1200px;margin:0 auto;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;gap:16px">
<div style="font-weight:800;font-size:1.15rem;letter-spacing:.2px">${brandName}</div>
<nav style="display:flex;gap:18px;font-size:.9rem;flex-wrap:wrap">${['Home', 'Shop', 'Blog', 'About', 'Contact'].map((l) => `<span style="opacity:.9">${l}</span>`).join('')}</nav>
</div>
</header>
<main style="max-width:820px;margin:0 auto;padding:40px 20px">
<article>
<h1 style="font-size:2.2rem;font-weight:800;margin:0 0 .3em;color:#111">${title}</h1>
<div style="font-size:.85rem;color:#888;margin-bottom:1.6em">${today} · ${brandName}</div>
<div class="entry-content">${body}</div>
</article>
</main>
<footer style="background:#111;color:#aaa;margin-top:60px">
<div style="max-width:1200px;margin:0 auto;padding:24px 20px;font-size:.85rem;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
<span>© ${new Date().getFullYear()} ${brandName}</span>
<span>${brand?.wpUrl || ''}</span>
</div>
</footer>
</body></html>`;
  };

  const handleFetchNanoPrompts = async () => {
    setIsGeneratingPrompts(true);
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
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.success && Array.isArray(data.data)) {
        setNanoPrompts(data.data);
      }
    } catch (e: any) {
      console.error('Error fetching prompts:', e);
      alert('Prompt Generation Error: ' + e.message);
    } finally {
      setIsGeneratingPrompts(false);
    }
  };

  const handleGenerateImage = async (promptToUse: string) => {
    setIsGeneratingImage(true);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/generate-nano-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          aspectRatio: '16:9',
          modelProvider: 'gemini',
          byokKeys,
          applyHumanization,
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
      }
    } catch (e) {
      console.error('Error generating image:', e);
    } finally {
      setIsGeneratingImage(false);
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
          applyHumanization
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (data.success && data.data) {
        const updatedBlock = { ...block, ...data.data };
        const updatedBlocks = [...editingItem.blocks];
        updatedBlocks[blockIdx] = updatedBlock;
        setEditingItem({ ...editingItem, blocks: updatedBlocks });
      }
    } catch (e: any) {
      console.error('Error rewriting block:', e);
      alert('Generation Error: ' + e.message);
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

  if (!editingItem) return <div className="p-8">Loading editor...</div>;

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header Area */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex-1 w-full">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded tracking-wider">
              {editingItem.contentType}
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
                      <div className={`flex-1 h-0.5 rounded-full min-w-[8px] ${isDone || isCurrent ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                    )}
                    <button
                      onClick={() => handleSetStage(stage.status as PipelineStatus)}
                      disabled={isCurrent}
                      title={isCurrent ? `${stage.label}: ${stage.hint}` : `Move to ${stage.label}: ${stage.hint}`}
                      className="group flex flex-col items-center gap-1.5"
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${
                        isCurrent
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-4 ring-indigo-100'
                          : isDone
                          ? 'bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer'
                          : 'bg-slate-100 text-slate-400 border border-slate-200 hover:bg-slate-200 hover:text-slate-600 cursor-pointer'
                      }`}>
                        {isDone ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <span className={`text-[9px] md:text-[10px] font-bold whitespace-nowrap transition-colors ${
                        isCurrent ? 'text-indigo-600' : isDone ? 'text-emerald-600' : 'text-slate-400 group-hover:text-slate-600'
                      }`}>
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
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 transition group"
                >
                  Next: <span className="underline underline-offset-2 decoration-indigo-300">{nextStage.label}</span>
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

      {/* Workflow Step Tabs: Brief -> Write -> SEO -> Visuals -> Publish */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-1.5 flex gap-1 overflow-x-auto">
        <button
          onClick={() => setStepTab('brief')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'brief' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
        >
          <ClipboardList className="w-4 h-4" /> Brief
        </button>
        <button
          onClick={() => setStepTab('write')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'write' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
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
            stepTab === 'seo' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
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
            stepTab === 'visuals' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
        >
          <ImageIcon className="w-4 h-4" /> Visuals
          {editingItem.featuredImageUrl && (
            <span className={`w-1.5 h-1.5 rounded-full ${stepTab === 'visuals' ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
          )}
        </button>
        <button
          onClick={() => setStepTab('publish')}
          className={`flex-1 min-w-[100px] px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition ${
            stepTab === 'publish' ? 'bg-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
          }`}
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
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition shadow-sm"
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
              ].map((p) => (
                <button
                  key={p.w}
                  onClick={() => setEditingItem({ ...editingItem, targetWordCount: p.w })}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                    editingItem.targetWordCount === p.w
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-500/20'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {p.label} · {p.w.toLocaleString()}
                </button>
              ))}
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
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-70 shadow-sm"
              >
                {isGeneratingAi ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                ) : (
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                )}
                {isGeneratingAi ? 'Generating...' : 'Auto-Write'}
              </button>
            </div>
          </div>

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
                className={`h-full rounded-full transition-all ${editingItem.targetWordCount && wordCount >= editingItem.targetWordCount ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min(100, (wordCount / (editingItem.targetWordCount || 900)) * 100)}%` }}
              />
            </div>
          </div>

          {writeMode === 'visual' && (
            <div className="space-y-4">
              {(!editingItem.blocks || editingItem.blocks.length === 0) ? (
                <div className="bg-white border border-slate-200 border-dashed rounded-2xl p-12 text-center text-slate-500">
                  <Layout className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                  <p className="font-medium text-slate-700">No content blocks yet.</p>
                  <p className="text-sm mt-1 mb-6">Click Auto-Write to generate a full article, or add blocks manually.</p>
                  <button onClick={() => handleAddBlock('paragraph')} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition">
                    + Add Paragraph Block
                  </button>
                </div>
              ) : (
                editingItem.blocks.map((block, idx) => (
                  <div key={block.id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4 group">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{block.type} Block</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
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

              {/* Prompt library */}
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
                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
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
                          onClick={() => handleGenerateImage(p.prompt)}
                          disabled={isGeneratingImage}
                          className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 flex justify-center items-center gap-2"
                        >
                          {isGeneratingImage ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          Render as featured image
                        </button>
                      </div>
                    ))}
                  </div>
                )}
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
                  className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold transition shadow-sm"
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
                  onClick={handleOpenSitePreview}
                  className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-left hover:border-indigo-200 hover:shadow-md transition group"
                >
                  <Eye className="w-5 h-5 text-slate-400 mb-3 group-hover:text-indigo-500 transition" />
                  <p className="font-bold text-slate-900 text-sm">Article Preview</p>
                  <p className="text-xs text-slate-500 mt-1">See the post inside the live site's layout.</p>
                </button>
                {editingItem.wpPreviewUrl && (
                  <button
                    onClick={() => setShowPreviewModal(true)}
                    className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-left hover:border-indigo-200 hover:shadow-md transition group"
                  >
                    <ExternalLink className="w-5 h-5 text-slate-400 mb-3 group-hover:text-indigo-500 transition" />
                    <p className="font-bold text-slate-900 text-sm">WordPress Draft Preview</p>
                    <p className="text-xs text-slate-500 mt-1">Open the WP preview iframe.</p>
                  </button>
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

      {/* Site Layout Preview Modal */}
      {showSitePreview && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex p-4 md:p-8">
          <div className="bg-white rounded-2xl shadow-2xl flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <h3 className="font-bold text-slate-900">Article Preview</h3>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600 uppercase tracking-wider">
                  {previewChromeState === 'site' ? 'Live site layout' : previewChromeState === 'loading' ? 'Loading site…' : 'Brand template'}
                </span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-indigo-50 text-indigo-600 uppercase tracking-wider">
                  Template: {editingItem.wpTemplate || 'default'}
                </span>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                  {wordCount.toLocaleString()} words
                </span>
              </div>
              <div className="flex gap-2">
                {previewChromeState === 'brand' && (
                  <button
                    onClick={() => loadSiteChrome(true)}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold transition"
                    title="Re-fetch the live site's header/footer"
                  >
                    <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                    Use live site
                  </button>
                )}
                <button onClick={() => setShowSitePreview(false)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition">
                  Close
                </button>
              </div>
            </div>
            <iframe
              srcDoc={buildPreviewDoc(previewChrome)}
              sandbox="allow-same-origin allow-scripts allow-popups"
              className="flex-1 w-full bg-white"
              title="Article preview"
            />
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && editingItem.wpPreviewUrl && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex p-4 md:p-8">
          <div className="bg-white rounded-2xl shadow-2xl flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">WordPress Preview</h3>
              <div className="flex gap-2">
                <a href={editingItem.wpPreviewUrl} target="_blank" rel="noreferrer" className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold transition">
                  Open New Tab
                </a>
                <button onClick={() => setShowPreviewModal(false)} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition">
                  Close
                </button>
              </div>
            </div>
            <iframe src={editingItem.wpPreviewUrl} className="flex-1 w-full bg-slate-50" title="Preview" />
          </div>
        </div>
      )}
    </div>
  );
};
