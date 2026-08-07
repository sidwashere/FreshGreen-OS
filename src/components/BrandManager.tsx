import React, { useState } from 'react';
import { Brand } from '../types';
import { Building2, Plus, Key, Globe, Palette, ShieldAlert, Sparkles, Check, Trash2, Edit3, Save } from 'lucide-react';

interface BrandManagerProps {
  brands: Brand[];
  selectedBrandId: string;
  onSaveBrand: (brand: Brand) => void;
  onDeleteBrand: (brandId: string) => void;
  onSelectBrand: (brandId: string) => void;
}

export const BrandManager: React.FC<BrandManagerProps> = ({
  brands,
  selectedBrandId,
  onSaveBrand,
  onDeleteBrand,
  onSelectBrand,
}) => {
  const activeBrand = brands.find((b) => b.id === selectedBrandId) || brands[0];
  const [editingBrand, setEditingBrand] = useState<Brand | null>(activeBrand || null);
  const [showAppPassword, setShowAppPassword] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [newBannedWord, setNewBannedWord] = useState('');
  const [newTemplateSlug, setNewTemplateSlug] = useState('');
  const [brandToDelete, setBrandToDelete] = useState<string | null>(null);

  // Switch form when selected brand changes
  React.useEffect(() => {
    if (activeBrand) {
      setEditingBrand(activeBrand);
    } else {
      setEditingBrand(null);
    }
  }, [selectedBrandId, activeBrand]);

  const handleCreateNew = () => {
    const newId = 'brand-' + Date.now();
    const newBrand: Brand = {
      id: newId,
      name: 'New Brand Property',
      slug: 'new-brand-' + Date.now(),
      wpUrl: 'https://mynewbrand.com',
      wpUsername: 'admin',
      wpAppPassword: '',
      voiceGuidelines: 'Friendly, helpful, authoritative, human-centric',
      bannedWords: ['cheap', 'spam'],
      primaryColor: '#3b82f6',
      pageTemplates: ['default', 'template-full-width.php'],
      defaultStatus: 'draft',
      createdAt: new Date().toISOString(),
    };
    onSaveBrand(newBrand);
    onSelectBrand(newId);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBrand) return;
    onSaveBrand(editingBrand);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleAddBannedWord = () => {
    if (!newBannedWord.trim() || !editingBrand) return;
    setEditingBrand({
      ...editingBrand,
      bannedWords: [...(editingBrand.bannedWords || []), newBannedWord.trim().toLowerCase()],
    });
    setNewBannedWord('');
  };

  const handleRemoveBannedWord = (word: string) => {
    if (!editingBrand) return;
    setEditingBrand({
      ...editingBrand,
      bannedWords: (editingBrand.bannedWords || []).filter((w) => w !== word),
    });
  };

  const handleAddTemplateSlug = () => {
    if (!newTemplateSlug.trim() || !editingBrand) return;
    setEditingBrand({
      ...editingBrand,
      pageTemplates: [...(editingBrand.pageTemplates || []), newTemplateSlug.trim()],
    });
    setNewTemplateSlug('');
  };

  const handleRemoveTemplateSlug = (slug: string) => {
    if (!editingBrand) return;
    setEditingBrand({
      ...editingBrand,
      pageTemplates: (editingBrand.pageTemplates || []).filter((s) => s !== slug),
    });
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6 text-emerald-600" />
            Multi-Brand Configuration Engine
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Store digital DNA, encrypted WordPress REST API credentials, voice guidelines, and custom template mappings.
          </p>
        </div>

        <button
          onClick={handleCreateNew}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm transition shadow-sm"
        >
          <Plus className="w-4 h-4 text-emerald-400" />
          <span>Add New Brand Property</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Brand Selector Cards */}
        <div className="lg:col-span-4 space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
            Managed Brands ({brands.length})
          </h2>

          <div className="space-y-2">
            {brands.map((b) => {
              const isSelected = editingBrand ? b.id === editingBrand.id : false;
              return (
                <div
                  key={b.id}
                  onClick={() => {
                    onSelectBrand(b.id);
                    setEditingBrand(b);
                  }}
                  className={`p-4 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-md ring-2 ring-emerald-500/30'
                      : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-800 shadow-sm'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div
                      className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: b.primaryColor || '#10b981' }}
                    />
                    <div>
                      <h3 className="font-semibold text-sm leading-tight">{b.name}</h3>
                      <p className={`text-xs mt-0.5 font-mono truncate max-w-[170px] ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                        {b.wpUrl.replace(/^https?:\/\//, '')}
                      </p>
                    </div>
                  </div>
                  {brandToDelete === b.id ? (
                    <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          onDeleteBrand(b.id);
                          if (isSelected) setEditingBrand(null);
                          setBrandToDelete(null);
                        }}
                        className="px-2 py-1 text-[10px] font-bold bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setBrandToDelete(null)}
                        className="px-2 py-1 text-[10px] font-bold bg-slate-200 text-slate-600 rounded hover:bg-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setBrandToDelete(b.id);
                      }}
                      className={`p-1.5 rounded-lg transition ${
                        isSelected ? 'hover:bg-slate-800 text-slate-400 hover:text-red-400' : 'hover:bg-slate-200 text-slate-400 hover:text-red-600'
                      }`}
                      title="Delete Brand"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Detailed Edit Form */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          {!editingBrand ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-4 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center">
                <Building2 className="w-8 h-8 text-slate-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">No Brand Selected</h3>
                <p className="text-sm text-slate-500 max-w-sm mt-1">Select a brand from the left to edit its configuration, or create a new one.</p>
              </div>
              <button
                onClick={handleCreateNew}
                className="mt-4 flex items-center space-x-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition"
              >
                <Plus className="w-4 h-4" />
                <span>Create Brand</span>
              </button>
            </div>
          ) : (
          <form onSubmit={handleSave} className="space-y-6">
            {/* Top Bar inside Form */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div
                  className="w-5 h-5 rounded-full shadow-inner"
                  style={{ backgroundColor: editingBrand.primaryColor }}
                />
                <h2 className="text-lg font-bold text-slate-900">Editing: {editingBrand.name}</h2>
              </div>

              <div className="flex items-center space-x-2">
                {savedNotice && (
                  <span className="flex items-center text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Saved Successfully
                  </span>
                )}
                <button
                  type="submit"
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition shadow-sm"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Brand DNA</span>
                </button>
              </div>
            </div>

            {/* Section 1: Basic Brand Identity & Styling */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Brand Name</label>
                <input
                  type="text"
                  value={editingBrand.name}
                  onChange={(e) => setEditingBrand({ ...editingBrand, name: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Brand Primary Accent Color</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={editingBrand.primaryColor || '#10b981'}
                    onChange={(e) => setEditingBrand({ ...editingBrand, primaryColor: e.target.value })}
                    className="w-10 h-10 rounded-xl border border-slate-300 cursor-pointer p-0.5"
                  />
                  <input
                    type="text"
                    value={editingBrand.primaryColor || '#10b981'}
                    onChange={(e) => setEditingBrand({ ...editingBrand, primaryColor: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: WordPress REST API Bridge Vault */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex items-center space-x-2 text-slate-900 font-semibold text-sm">
                <Key className="w-4 h-4 text-emerald-600" />
                <span>WordPress REST API Vault (Hostinger / cPanel Target)</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">WordPress Base URL</label>
                  <input
                    type="url"
                    value={editingBrand.wpUrl}
                    onChange={(e) => setEditingBrand({ ...editingBrand, wpUrl: e.target.value })}
                    placeholder="https://daniels-tasty-petfoods.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">WP Username</label>
                  <input
                    type="text"
                    value={editingBrand.wpUsername}
                    onChange={(e) => setEditingBrand({ ...editingBrand, wpUsername: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-700">Application Password (Encrypted Vault)</label>
                  <button
                    type="button"
                    onClick={() => setShowAppPassword(!showAppPassword)}
                    className="text-[11px] font-semibold text-emerald-600 hover:underline"
                  >
                    {showAppPassword ? 'Hide' : 'Reveal'} Password
                  </button>
                </div>
                <input
                  type={showAppPassword ? 'text' : 'password'}
                  value={editingBrand.wpAppPassword || ''}
                  onChange={(e) => setEditingBrand({ ...editingBrand, wpAppPassword: e.target.value })}
                  placeholder="xxxx xxxx xxxx xxxx"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Generate via <strong>WordPress Admin ➔ Users ➔ Profile ➔ Application Passwords</strong>.
                </p>
              </div>
            </div>

            {/* Section 3: AI Gemini Tone of Voice Guidelines */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                  Brand Voice & Tone Guidelines (Gemini DNA Prompt)
                </span>
              </label>
              <textarea
                value={editingBrand.voiceGuidelines}
                onChange={(e) => setEditingBrand({ ...editingBrand, voiceGuidelines: e.target.value })}
                rows={3}
                placeholder="Warm, energetic, pet-focused, scientific yet approachable..."
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            {/* Section 4: Banned Words */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                Banned Words & Competitor Terms (Strict AI Filter)
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newBannedWord}
                  onChange={(e) => setNewBannedWord(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddBannedWord())}
                  placeholder="e.g. cheap, synthetic, artificial"
                  className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddBannedWord}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs border border-slate-300"
                >
                  Add Word
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(editingBrand.bannedWords || []).map((word) => (
                  <span
                    key={word}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-medium border border-red-200"
                  >
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBannedWord(word)}
                      className="hover:text-red-900 font-bold"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Section 5: Target WordPress Page Templates */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                WordPress Page Template Slugs (Preserves Theme Header & Footer)
              </label>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={newTemplateSlug}
                  onChange={(e) => setNewTemplateSlug(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTemplateSlug())}
                  placeholder="e.g. template-full-width.php or landing-page.php"
                  className="flex-1 px-3 py-1.5 rounded-xl border border-slate-300 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddTemplateSlug}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium text-xs border border-slate-300"
                >
                  Add Template
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(editingBrand.pageTemplates || ['default']).map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 text-xs font-mono border border-slate-300"
                  >
                    <span>{slug}</span>
                    {slug !== 'default' && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTemplateSlug(slug)}
                        className="hover:text-slate-900 font-bold ml-1"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  );
};
