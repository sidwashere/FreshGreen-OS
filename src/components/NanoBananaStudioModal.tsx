import { fetchGlobalKeys, fetchAiPref } from "../lib/keys";
import React, { useState } from 'react';
import { Brand } from '../types';
import { Sparkles, Wand2, Image as ImageIcon, RefreshCw, Check, Copy } from 'lucide-react';
import { BrandSwitcher } from './BrandSwitcher';

interface NanoBananaStudioModalProps {
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
}

export const NanoBananaStudioModal: React.FC<NanoBananaStudioModalProps> = ({
  brands,
  selectedBrandId,
  onSelectBrand,
}) => {
  const currentBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];
  const [topic, setTopic] = useState('Fresh Organic Salmon Kibble for Senior Dogs');
  const [subject, setSubject] = useState('Wild-caught salmon fillet on dark slate');
  const [environment, setEnvironment] = useState('Minimalist rustic wooden kitchen table');
  const [lighting, setLighting] = useState('Warm morning sunlight, soft bokeh, 8k studio lighting');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [modelProvider, setModelProvider] = useState('auto');
  // Meta about the last render: surfaces placeholder fallbacks clearly so a
  // random stock photo is never mistaken for a real AI image.
  const [renderMeta, setRenderMeta] = useState<{ isPlaceholder?: boolean; isAiGenerated?: boolean; provider?: string; model?: string; message?: string } | null>(null);
  const [aiPref] = useState(() => fetchAiPref());

  if (!currentBrand) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center text-slate-500">
        <p>No brand selected. Please create a brand first.</p>
      </div>
    );
  }

  const handleBuildPrompt = () => {
    const full = `${subject.trim()}, ${environment.trim()}, ${lighting.trim()}`;
    setGeneratedPrompt(full);
    setError(null);
  };

  const handleGenerateImage = async () => {
    setIsLoading(true);
    setError(null);
    const fullPrompt = generatedPrompt || `${subject}, ${environment}, ${lighting}`;
    const byokKeys = await fetchGlobalKeys();

    try {
      const res = await fetch('/api/ai/generate-nano-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: fullPrompt, 
          aspectRatio: '16:9',
          modelProvider,
          // The blog topic is prepended server-side so every render matches it,
          // even if the prompt formula drifts off-topic.
          topicContext: topic.trim()
            ? `Blog article topic: "${topic.trim()}". Brand: ${currentBrand?.name || ''}. Editorial, photorealistic, warm and authentic — no text or logos.`
            : '',
          byokKeys,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        setGeneratedImage(data.imageUrl);
        setRenderMeta({
          isPlaceholder: !!data.isPlaceholder,
          isAiGenerated: !!data.isAiGenerated,
          provider: data.provider,
          model: data.model,
          message: data.message,
        });
      } else if (data.error) {
        setError('Generation Error: ' + data.error);
      }
    } catch (e: any) {
      console.error(e);
      setError('Generation Failed: ' + (e?.message || 'Check console for details.'));
    } finally {
      setIsLoading(false);
    }
  };

  // AI refinement: rewrites the prompt so it stays on-topic and visual.
  const handleRefinePrompt = async () => {
    const fullPrompt = generatedPrompt || `${subject}, ${environment}, ${lighting}`;
    if (!fullPrompt.trim()) {
      setError('Build a prompt first, then refine it.');
      return;
    }
    setIsRefining(true);
    setError(null);
    const byokKeys = await fetchGlobalKeys();
    try {
      const res = await fetch('/api/ai/refine-image-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: fullPrompt,
          title: topic.trim(),
          brandName: currentBrand?.name || '',
          voiceGuidelines: currentBrand?.voiceGuidelines || '',
          byokKeys,
          modelPref: aiPref,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.success && data.data?.prompt) {
        setGeneratedPrompt(data.data.prompt);
      }
    } catch (e: any) {
      console.error('Refine failed:', e);
      setError('Refinement failed: ' + (e?.message || 'Please try again.'));
    } finally {
      setIsRefining(false);
    }
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="pb-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-amber-500" />
            AI Image Generator
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Architect high-impact AI visual prompts and generate brand-tailored featured images for WordPress.
          </p>
        </div>
        <BrandSwitcher
          brands={brands}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          size="sm"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left: Prompt Builder Formula */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-5">
          <h2 className="text-base font-bold text-slate-900 flex items-center justify-between">
            <span>Formula Builder: Subject + Style + Lighting</span>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-bold text-white"
              style={{ backgroundColor: currentBrand?.primaryColor || '#10b981' }}
            >
              {currentBrand?.name || 'No Brand Selected'}
            </span>
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Model Provider</label>
              <select
                value={modelProvider}
                onChange={(e) => setModelProvider(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500"
              >
                <option value="auto">Auto — best available (Gemini → DALL-E 3 → SDXL)</option>
                <option value="gemini">Gemini (Nano Banana — free server key)</option>
                <option value="huggingface">Hugging Face (Stable Diffusion - Free/BYOK)</option>
                <option value="openai">OpenAI (DALL-E 3 - BYOK)</option>
                <option value="replicate">Replicate (Flux Schnell - BYOK)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Blog Topic <span className="text-amber-600">· locked into every render</span>
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500"
                placeholder="e.g. Benefits of daily dog walking for senior pets"
              />
              <p className="text-[10px] text-slate-400 mt-1">The server prepends this topic to every image prompt, so renders always match the article.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">1. Main Subject Token</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500"
                placeholder="e.g. Golden Retriever enjoying fresh salmon treats"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">2. Environment & Aesthetic Token</label>
              <input
                type="text"
                value={environment}
                onChange={(e) => setEnvironment(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500"
                placeholder="e.g. Scandi bright kitchen, bamboo bowl, clean lines"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">3. Lighting & Quality Tokens</label>
              <input
                type="text"
                value={lighting}
                onChange={(e) => setLighting(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-amber-500"
                placeholder="e.g. Studio lighting, macro detail, 8k resolution, cinematic"
              />
            </div>

            <div className="pt-2 flex flex-wrap gap-3">
              <button
                onClick={handleBuildPrompt}
                className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300 transition"
              >
                Build Nano Formula String
              </button>
              <button
                onClick={handleRefinePrompt}
                disabled={isRefining || isLoading}
                className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs border border-indigo-200 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {isRefining ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {isRefining ? 'Refining...' : 'Refine with AI'}
              </button>
              <button
                onClick={handleGenerateImage}
                disabled={isLoading || isRefining}
                className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-sm disabled:opacity-50"
              >
                {isLoading ? 'Rendering Image...' : '🎨 Render Image Now'}
              </button>
            </div>

            {error && (
              <div className="flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 shrink-0">
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Generated Formula Box */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span>Final Prompt Formula</span>
              <button onClick={copyPrompt} className="text-amber-500 hover:underline flex items-center gap-1 text-[10px]">
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <textarea
              value={generatedPrompt}
              onChange={(e) => setGeneratedPrompt(e.target.value)}
              className="w-full px-3 py-3 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-amber-500 min-h-[80px]"
              placeholder="Your prompt will appear here. You can also edit it directly."
            />
          </div>
        </div>

        {/* Right: Render Preview Canvas */}
        <div className="lg:col-span-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-slate-900">Render Preview Canvas</h2>

          {generatedImage ? (
            <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-md space-y-3">
              <div className="relative">
                <img
                  src={generatedImage}
                  alt="AI Generated"
                  className="w-full h-80 object-cover"
                  referrerPolicy="no-referrer"
                />
                {renderMeta?.isPlaceholder && (
                  <div className="absolute inset-x-0 bottom-0 bg-amber-500/95 text-white text-[11px] leading-snug p-2.5">
                    <strong>Placeholder — not an AI render.</strong>{' '}
                    {renderMeta.message}
                  </div>
                )}
                {renderMeta?.isAiGenerated && (
                  <span className="absolute top-2 left-2 bg-emerald-600/90 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm">
                    AI · {renderMeta.provider} · {renderMeta.model}
                  </span>
                )}
              </div>
              <div className="p-4 bg-slate-50 flex items-center justify-between text-xs border-t border-slate-200">
                <span className="font-semibold text-slate-700">Ready for WordPress Sideloading</span>
                <a
                  href={generatedImage}
                  download="generated-image.jpg"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition shadow-sm"
                >
                  Download Image
                </a>
              </div>
            </div>
          ) : (
            <div className="h-80 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <ImageIcon className="w-12 h-12 text-slate-300" />
              <p className="text-sm text-slate-500 font-medium">Click "Render Image Now" to visualize your prompt formula.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
