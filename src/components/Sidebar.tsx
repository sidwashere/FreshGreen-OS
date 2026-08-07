import React from 'react';
import { 
  Kanban, 
  FileEdit, 
  Sparkles, 
  Building2, 
  Globe2, 
  Server,
  Cloud,
  ChevronRight,
  Settings
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  plannedCount: number;
  draftCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigateTab,
  plannedCount,
  draftCount
}) => {
  const menuItems = [
    {
      id: 'pipeline',
      label: 'Dashboard',
      icon: Kanban,
      badge: plannedCount + draftCount > 0 ? plannedCount + draftCount : null,
      description: 'Overview & Creation'
    },
    {
      id: 'editor',
      label: 'Blog Editor',
      icon: FileEdit,
      description: 'Modular Blocks & AI Writer'
    },
    {
      id: 'nano-banana',
      label: 'Nano Banana AI Studio',
      icon: Sparkles,
      badge: 'Visuals',
      badgeColor: 'bg-yellow-400/20 text-yellow-300 border-yellow-500/30',
      description: 'Image Prompt Studio'
    },
    {
      id: 'workspace',
      label: 'Workspace Hub',
      icon: Cloud,
      badge: 'Google',
      badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
      description: 'Sheets, Gmail, Calendar'
    },
    {
      id: 'brands',
      label: 'Brand DNA & Vault',
      icon: Building2,
      description: 'Voice Guidelines & WP Secrets'
    },
    {
      id: 'settings',
      label: 'Settings & Configs',
      icon: Settings,
      description: 'API, Deployment & WP'
    }
  ];

  return (
    <aside className="w-[280px] bg-transparent text-slate-600 flex flex-col justify-between shrink-0 select-none h-full relative z-20">
      <div className="py-6">
        <div className="flex items-center gap-3 px-6 mb-8">
          <div className="w-10 h-10 rounded-[14px] bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            FreshGreenOps
          </span>
        </div>
        
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 mb-3">
          Menu
        </div>
        
        <nav className="space-y-1 px-3">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigateTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-3 text-left transition-all rounded-2xl relative group ${
                  isActive
                    ? 'text-indigo-700 bg-indigo-50/50 font-bold'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50 font-medium'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-indigo-600 rounded-r-full" />
                )}
                <div className="flex items-center space-x-3 truncate">
                  <Icon className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                    isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                  }`} />
                  <div className="truncate text-[13px]">{item.label}</div>
                </div>

                {item.badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 shrink-0 ${
                    isActive 
                      ? 'bg-indigo-600 text-white' 
                      : item.badgeColor || 'bg-slate-100 text-slate-600'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info Box */}
      <div className="p-4 mx-4 mb-6 bg-[#f4f6f3] rounded-2xl relative overflow-hidden group border border-slate-200/50">
        <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-600/5 rounded-full blur-2xl group-hover:bg-indigo-600/10 transition-colors" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-bold text-slate-900">cPanel Stack</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed mb-4">
            Laravel 11 + MySQL + Gemini AI + WP REST API.
          </p>
          <button
            onClick={() => onNavigateTab('settings')}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[11px] font-bold transition-colors shadow-sm"
          >
            Deployment & Configs
          </button>
        </div>
      </div>
    </aside>
  );
};

