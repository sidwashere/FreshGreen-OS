import { fetchGlobalKeys } from "../lib/keys";
import React, { useState, useEffect, useMemo } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ContentItem, Brand, VisualBlock, VisualBlockType, PipelineStatus, SeoAuditResult } from '../types';
import { 
  Sparkles, 
  Image as ImageIcon, 
  BarChart2, 
  Eye, 
  Save, 
  Send, 
  Trash2, 
  Layout, 
  Code, 
  ExternalLink,
  RefreshCw,
  Settings2,
  ImagePlus
} from 'lucide-react';

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
  const [editorTab, setEditorTab] = useState<'visual' | 'html' | 'seo'>('visual');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSyncingWp, setIsSyncingWp] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  
  const [nanoPrompts, setNanoPrompts] = useState<any[]>([]);
  const [isGeneratingPrompts, setIsGeneratingPrompts] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);
  const [blockRewriteDirections, setBlockRewriteDirections] = useState<Record<string, string>>({});
  const [isRewritingBlock, setIsRewritingBlock] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState<'Saved' | 'Saving...' | 'Edited'>('Saved');
  const [seoAudit, setSeoAudit] = useState<SeoAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showSitePreview, setShowSitePreview] = useState(false);
  const [previewChrome, setPreviewChrome] = useState<{ headLinks?: string; headerHtml?: string; footerHtml?: string; siteTitle?: string } | null>(null);
  const [previewChromeState, setPreviewChromeState] = useState<'site' | 'brand' | 'loading'>('brand');

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

  const handleRunSeoAudit = async () => {
    setIsAuditing(true);
    try {
      const res = await fetch('/api/ai/seo-audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editingItem.title,
          primaryKeyword: editingItem.primaryKeyword,
          secondaryKeywords: editingItem.secondaryKeywords,
          bodyHtml: editingItem.bodyHtml || '',
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      if (data.success && data.data) {
        setSeoAudit(data.data);
      }
    } catch (e: any) {
      console.error('Error running SEO audit:', e);
      alert('SEO Audit Error: ' + e.message);
    } finally {
      setIsAuditing(false);
    }
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
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded tracking-wider ${editingItem.status === 'Published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {editingItem.status.replace('_', ' ')}
            </span>
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
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <button
            onClick={handleOpenSitePreview}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition shadow-sm"
            title="Preview the article inside the site's layout"
          >
            <Eye className="w-4 h-4 text-slate-400" />
            Preview
          </button>

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
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-semibold hover:bg-slate-800 transition disabled:opacity-70 shadow-sm"
          >
            {isGeneratingAi ? (
              <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
            ) : (
              <Sparkles className="w-4 h-4 text-emerald-400" />
            )}
            {isGeneratingAi ? 'Generating...' : 'Auto-Write'}
          </button>
          
          <button
            onClick={handleSave}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition shadow-sm"
          >
            <Save className="w-4 h-4 text-slate-400" />
            {saveStatus === 'Saving...' ? 'Saving...' : saveStatus === 'Saved' ? 'Saved' : 'Save'}
          </button>

          <button
            onClick={handleSyncToWordPress}
            disabled={isSyncingWp}
            className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-xl text-sm font-semibold hover:bg-indigo-100 transition disabled:opacity-70 shadow-sm"
          >
            <Send className="w-4 h-4" />
            {isSyncingWp ? 'Syncing...' : 'Publish to WP'}
          </button>
        </div>
      </div>

      {syncStatusMsg && (
        <div className="bg-slate-900 text-white px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-3">
          <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
          {syncStatusMsg}
        </div>
      )}

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Editor Area */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-100 p-1 rounded-xl inline-flex mb-2">
            <button
              onClick={() => setEditorTab('visual')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${editorTab === 'visual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Layout className="w-4 h-4" /> Visual Blocks
            </button>
            <button
              onClick={() => setEditorTab('html')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${editorTab === 'html' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Code className="w-4 h-4" /> HTML Editor
            </button>
            <button
              onClick={() => setEditorTab('seo')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 transition ${editorTab === 'seo' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Settings2 className="w-4 h-4" /> Meta Settings
            </button>
          </div>

          {editorTab === 'visual' && (
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
                      <button onClick={() => handleRemoveBlock(block.id)} className="text-slate-400 hover:text-red-500 p-1 transition opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-4 h-4" />
                      </button>
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

          {editorTab === 'html' && (
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

          {editorTab === 'seo' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Meta Title</label>
                <input
                  type="text"
                  value={editingItem.metaTitle || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, metaTitle: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Meta Description</label>
                <textarea
                  value={editingItem.metaDescription || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, metaDescription: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Target Keyword</label>
                  <input
                    type="text"
                    value={editingItem.primaryKeyword || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, primaryKeyword: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">WP Template</label>
                  <select
                    value={editingItem.wpTemplate || 'default'}
                    onChange={(e) => setEditingItem({ ...editingItem, wpTemplate: e.target.value })}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50 cursor-pointer"
                  >
                    {(brand?.pageTemplates || ['default']).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Secondary Keywords <span className="font-normal text-slate-400">(comma separated)</span></label>
                <input
                  type="text"
                  value={(editingItem.secondaryKeywords || []).join(', ')}
                  onChange={(e) => setEditingItem({ ...editingItem, secondaryKeywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="e.g. grain-free treats, puppy training snacks"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">SEO Brief</label>
                <textarea
                  value={editingItem.seoBrief || ''}
                  onChange={(e) => setEditingItem({ ...editingItem, seoBrief: e.target.value })}
                  rows={3}
                  placeholder="Target audience, search intent, and what the page should rank for..."
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">Target Word Count</label>
                  <input
                    type="number"
                    min={300}
                    max={3000}
                    step={50}
                    value={editingItem.targetWordCount || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, targetWordCount: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="e.g. 900"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-slate-400 bg-slate-50"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">Generation aims within ±15% of this. Current: {wordCount.toLocaleString()} words.</p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-slate-400" />
                    SEO Score
                  </h3>
                  <button
                    onClick={handleRunSeoAudit}
                    disabled={isAuditing || !editingItem.bodyHtml}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {isAuditing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <BarChart2 className="w-3 h-3" />}
                    {isAuditing ? 'Auditing...' : 'Run SEO Audit'}
                  </button>
                </div>
                {seoAudit ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-lg ${seoAudit.score >= 80 ? 'bg-emerald-500' : seoAudit.score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}>
                        {seoAudit.score}
                      </div>
                      <div className="space-y-1 text-sm">
                        <p className="font-semibold text-slate-700">Readability: <span className="text-slate-500 font-normal">{seoAudit.readability}</span></p>
                        <p className="font-semibold text-slate-700">Word count: <span className="text-slate-500 font-normal">{seoAudit.wordCount}</span></p>
                        <p className="font-semibold text-slate-700">Keyword density: <span className="text-slate-500 font-normal">{seoAudit.keywordDensity}%</span></p>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-2">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Suggested Improvements</p>
                      {(seoAudit.suggestions || []).map((s, i) => (
                        <p key={i} className="text-sm text-slate-700">• {s}</p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">Generate content first, then run an audit to check keyword density, readability and SEO health.</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar Area (Featured Image) */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-slate-400" />
              Featured Image
            </h3>
            
            {editingItem.featuredImageUrl ? (
              <div className="relative rounded-xl overflow-hidden group border border-slate-200">
                <img src={editingItem.featuredImageUrl} alt="Featured" className="w-full h-48 object-cover" />
                <button 
                  onClick={() => setEditingItem({...editingItem, featuredImageUrl: undefined})}
                  className="absolute top-2 right-2 bg-white/90 text-red-600 p-1.5 rounded-lg shadow-sm opacity-0 group-hover:opacity-100 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="h-48 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                <ImagePlus className="w-8 h-8 mb-2" />
                <span className="text-sm font-medium">No Image</span>
              </div>
            )}

            <button 
              onClick={handleFetchNanoPrompts}
              disabled={isGeneratingPrompts}
              className="w-full py-2.5 bg-yellow-50 hover:bg-yellow-100 text-yellow-800 border border-yellow-200 rounded-xl text-sm font-semibold transition"
            >
              {isGeneratingPrompts ? 'Analyzing...' : 'Generate Image Ideas'}
            </button>

            {nanoPrompts.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Concepts</p>
                {nanoPrompts.map((p, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <p className="text-xs text-slate-700 leading-snug">"{p.prompt}"</p>
                    <button
                      onClick={() => handleGenerateImage(p.prompt)}
                      disabled={isGeneratingImage}
                      className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 flex justify-center items-center gap-2"
                    >
                      {isGeneratingImage ? <RefreshCw className="w-3 h-3 animate-spin" /> : '🎨'}
                      Render
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {(editingItem.wpLiveUrl || editingItem.wpPreviewUrl) && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Eye className="w-4 h-4 text-slate-400" />
                Preview
              </h3>
              <button
                onClick={() => setShowPreviewModal(true)}
                className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-sm font-semibold transition flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                View WP Preview
              </button>
            </div>
          )}
        </div>
      </div>

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
