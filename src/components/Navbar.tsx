import React from 'react';
import { Brand } from '../types';
import { Sparkles, Globe, ChevronDown, Plus, Server, LogOut, Settings } from 'lucide-react';
import { logout } from '../lib/firebase';

interface NavbarProps {
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (brandId: string) => void;
  onOpenBrandModal: () => void;
  onNavigateTab: (tab: string) => void;
  activeTab: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  brands,
  selectedBrandId,
  onSelectBrand,
  onOpenBrandModal,
  onNavigateTab,
  activeTab
}) => {
  const currentBrand = brands.find(b => b.id === selectedBrandId) || brands[0];

  return (
    <header className="h-[72px] bg-transparent text-slate-700 flex items-center justify-between px-6 sticky top-0 z-40">
      {/* Brand Identity / Left Side */}
      <div className="flex items-center space-x-4">
        {/* Brand Selector Dropdown */}
        <div className="relative group">
          <div className="flex items-center space-x-3 bg-white hover:bg-slate-50 border border-slate-200/60 shadow-sm rounded-xl px-4 py-2 transition cursor-pointer">
            <div 
              className="w-3 h-3 rounded-full shadow-sm"
              style={{ backgroundColor: currentBrand?.primaryColor || '#4f46e5' }}
            />
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:inline">Active Brand:</span>
            <select
              value={selectedBrandId}
              onChange={(e) => onSelectBrand(e.target.value)}
              className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer pr-4 appearance-none"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id} className="text-slate-900">
                  {b.name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Quick Status Bar & Actions */}
      <div className="flex items-center space-x-4">
        {/* WP Bridge Status Indicator */}
        <button
          onClick={() => onNavigateTab('settings')}
          className="hidden lg:flex items-center space-x-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/60 text-xs text-slate-600 shadow-sm transition"
        >
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <Globe className="w-4 h-4 text-emerald-500" />
          <span className="font-medium text-xs truncate max-w-[160px]">{currentBrand?.wpUrl?.replace(/^https?:\/\//, '')}</span>
        </button>

        {/* Add Brand Quick Button */}
        <button
          onClick={onOpenBrandModal}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold border border-slate-200/60 shadow-sm transition"
        >
          <Plus className="w-4 h-4 text-indigo-500" />
          <span className="hidden sm:inline">New Brand</span>
        </button>

        {/* Settings Button */}
        <button
          onClick={() => onNavigateTab('settings')}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition shadow-sm border ${
            activeTab === 'settings' 
              ? 'bg-indigo-50 text-indigo-600 border-indigo-200'
              : 'bg-white hover:bg-slate-50 text-slate-400 border-slate-200/60'
          }`}
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Logout Button */}
        <button
          onClick={logout}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-white hover:bg-slate-50 text-slate-400 border border-slate-200/60 shadow-sm transition"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

