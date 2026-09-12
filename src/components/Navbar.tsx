import React from 'react';
import { Brand, AppUser } from '../types';
import { Globe, Plus, Settings, Menu, PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react';
import { BrandSwitcher } from './BrandSwitcher';

interface NavbarProps {
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (brandId: string) => void;
  onOpenBrandModal: () => void;
  onNavigateTab: (tab: string) => void;
  activeTab: string;
  onToggleSidebar?: () => void;
  sidebarCollapsed?: boolean;
  currentUser?: AppUser | null;
}

export const Navbar: React.FC<NavbarProps> = ({
  brands,
  selectedBrandId,
  onSelectBrand,
  onOpenBrandModal,
  onNavigateTab,
  activeTab,
  onToggleSidebar,
  sidebarCollapsed = false,
  currentUser,
}) => {
  const currentBrand = brands.find(b => b.id === selectedBrandId) || brands[0];

  return (
    <header className="h-[72px] bg-transparent text-slate-700 flex items-center justify-between px-3 md:px-6 sticky top-0 z-40">
      {/* Brand Identity / Left Side */}
      <div className="flex items-center space-x-2 md:space-x-4 min-w-0">
        {/* Sidebar Toggle: mobile opens drawer, desktop collapses rail */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex items-center justify-center w-9 h-9 rounded-xl bg-white hover:bg-slate-50 text-slate-500 border border-slate-200/60 shadow-sm transition shrink-0"
          >
            <Menu className="w-5 h-5 md:hidden" />
            {sidebarCollapsed ? (
              <PanelLeftOpen className="w-5 h-5 hidden md:block" />
            ) : (
              <PanelLeftClose className="w-5 h-5 hidden md:block" />
            )}
          </button>
        )}

        {/* Brand Selector Dropdown — global, applies to every screen */}
        <div className="min-w-0">
          <BrandSwitcher
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={onSelectBrand}
            showAll={false}
          />
        </div>
      </div>

      {/* Quick Status Bar & Actions */}
      <div className="flex items-center space-x-2 md:space-x-4 shrink-0">
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

        {/* Current User Chip */}
        {currentUser && (
          <button
            onClick={() => onNavigateTab('settings')}
            className="hidden md:flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-600 text-xs font-semibold border border-slate-200/60 shadow-sm transition"
            title={`Signed in as ${currentUser.username}${currentUser.role === 'admin' ? ' (admin)' : ''}`}
          >
            {currentUser.role === 'admin' && <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />}
            <span className="truncate max-w-[120px]">{currentUser.username}</span>
          </button>
        )}
      </div>
    </header>
  );
};

