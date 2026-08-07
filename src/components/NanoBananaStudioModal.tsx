import { fetchGlobalKeys } from "../lib/keys";
import React, { useState } from 'react';
import { Brand } from '../types';
import { Sparkles, Wand2, Image as ImageIcon, RefreshCw, Check, Copy } from 'lucide-react';

interface NanoBananaStudioModalProps {
  brands: Brand[];
  selectedBrandId: string;
}

export const NanoBananaStudioModal: React.FC<NanoBananaStudioModalProps> = ({
  brands,
  selectedBrandId,
}) => {
  const currentBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];
  const [topic, setTopic] = useState('Fresh Organic Salmon Kibble for Senior Dogs');
  const [subject, setSubject] = useState('Wild-caught salmon fillet on dark slate');
  const [environment, setEnvironment] = useState('Minimalist rustic wooden kitchen table');
  const [lighting, setLighting] = useState('Warm morning sunlight, soft bokeh, 8k studio lighting');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [modelProvider, setModelProvider] = useState('gemini');

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
  };

  const handleGenerateImage = async () => {
    setIsLoading(true);
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
          byokKeys
        }),
      });
      const data = await res.json();
      if (data.success && data.imageUrl) {
        setGeneratedImage(data.imageUrl);
      } else if (data.error) {
        alert('Generation Error: ' + data.error);
      }
    } catch (e) {
      console.error(e);
      alert('Generation Failed. Check console for details.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="pb-4 border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-amber-500" />
          Nano Banana AI Image Studio
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Architect high-impact AI visual prompts and generate brand-tailored featured images for WordPress.
        </p>
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
                <option value="gemini">Gemini 3.1 Flash (Text-to-Image)</option>
                <option value="huggingface">Hugging Face (Stable Diffusion - Free/BYOK)</option>
                <option value="openai">OpenAI (DALL-E 3 - BYOK)</option>
                <option value="replicate">Replicate (Flux/SDXL - BYOK)</option>
              </select>
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

            <div className="pt-2 flex gap-3">
              <button
                onClick={handleBuildPrompt}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs border border-slate-300 transition"
              >
                Build Nano Formula String
              </button>
              <button
                onClick={handleGenerateImage}
                disabled={isLoading}
                className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-sm disabled:opacity-50"
              >
                {isLoading ? 'Rendering Image...' : '🎨 Render Image Now'}
              </button>
            </div>
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
              <img
                src={generatedImage}
                alt="AI Generated"
                className="w-full h-80 object-cover"
                referrerPolicy="no-referrer"
              />
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
