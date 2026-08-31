import React from 'react';
import { 
  Kanban, 
  FileEdit, 
  Sparkles, 
  Building2, 
  ChevronLeft,
  ChevronRight,
  Settings,
  LayoutDashboard,
  Library,
  CalendarClock,
  ListChecks
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  onNavigateTab: (tab: string) => void;
  plannedCount: number;
  draftCount: number;
  contentCount?: number;
  featureCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onNavigateTab,
  plannedCount,
  draftCount,
  contentCount = 0,
  featureCount = 0,
  collapsed = false,
  onToggleCollapse
}) => {
  // Nav is grouped to mirror the blog production workflow:
  // Overview -> Production -> Distribution -> Administration
  const sections = [
    {
      label: 'Overview',
      items: [
        {
          id: 'pipeline',
          label: 'Dashboard',
          icon: LayoutDashboard,
          badge: plannedCount + draftCount > 0 ? plannedCount + draftCount : null,
          description: 'Command center & planning'
        }
      ]
    },
    {
      label: 'Production',
      items: [
        {
          id: 'editor',
          label: 'Blog Editor',
          icon: FileEdit,
          description: 'Write, structure & SEO'
        },
        {
          id: 'content-hub',
          label: 'Blog Manager',
          icon: Library,
          badge: contentCount > 0 ? contentCount : null,
          description: 'Posts, register & stats'
        },
        {
          id: 'nano-banana',
          label: 'AI Image Generator',
          icon: Sparkles,
          badge: 'Visuals',
          badgeColor: 'bg-yellow-400/20 text-yellow-300 border-yellow-500/30',
          description: 'Featured images & artwork'
        }
      ]
    },
    {
      label: 'Distribution',
      items: [
        {
          id: 'autoblog',
          label: 'AutoBlog Scheduler',
          icon: CalendarClock,
          badge: 'Auto',
          badgeColor: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
          description: 'Sheet → Generate → Schedule → Publish'
        }
      ]
    },
    {
      label: 'Administration',
      items: [
        {
          id: 'features',
          label: 'Feature Tracker',
          icon: ListChecks,
          badge: featureCount > 0 ? featureCount : null,
          description: 'Requests, priorities & builds'
        },
        {
          id: 'brands',
          label: 'Brand DNA & Vault',
          icon: Building2,
          description: 'Voice guidelines & WP secrets'
        },
        {
          id: 'settings',
          label: 'Settings & Configs',
          icon: Settings,
          description: 'API, deployment & WP bridge'
        }
      ]
    }
  ];

  return (
    <aside className={`bg-white h-full relative z-20 flex flex-col justify-between shrink-0 select-none transition-[width] duration-300 ease-in-out ${collapsed ? 'w-[280px] md:w-[76px]' : 'w-[280px]'}`}>
      {/* Collapse/Expand Toggle (desktop) */}
      {onToggleCollapse && (
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="hidden md:flex absolute -right-3.5 top-10 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-md items-center justify-center text-slate-400 hover:text-slate-700 hover:border-slate-300 transition z-30"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      )}

      <div className="py-6">
        {/* Logo */}
        <div className={`flex items-center gap-3 mb-8 ${collapsed ? 'md:justify-center px-0' : 'px-6'}`}>
          <div className="w-10 h-10 rounded-[14px] bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-600/20 shrink-0">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className={`text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap ${collapsed ? 'md:hidden' : ''}`}>
            FGOS
          </span>
        </div>

        {/* Grouped Workflow Nav */}
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.label}>
              <div className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 ${collapsed ? 'md:hidden' : ''} px-6`}>
                {section.label}
              </div>
              <nav className={`space-y-1 ${collapsed ? 'md:px-3' : 'px-3'}`}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => onNavigateTab(item.id)}
                      title={collapsed ? item.label : undefined}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-all rounded-2xl relative group ${
                        isActive
                          ? 'text-indigo-700 bg-indigo-50/50 font-bold'
                          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50 font-medium'
                      } ${collapsed ? 'md:justify-center md:px-0' : ''}`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-6 bg-indigo-600 rounded-r-full" />
                      )}
                      <div className={`flex items-center truncate ${collapsed ? 'md:space-x-0 space-x-3' : 'space-x-3'}`}>
                        <Icon className={`w-[18px] h-[18px] shrink-0 transition-colors ${
                          isActive ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'
                        }`} />
                        <div className={`truncate text-[13px] ${collapsed ? 'md:hidden' : ''}`}>{item.label}</div>
                      </div>

                      {item.badge && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-2 shrink-0 ${
                          isActive 
                            ? 'bg-indigo-600 text-white' 
                            : item.badgeColor || 'bg-slate-100 text-slate-600'
                        } ${collapsed ? 'md:hidden' : ''}`}>
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Info Box (hidden when collapsed on desktop) */}
      <div className={`p-4 mx-4 mb-6 bg-[#f4f6f3] rounded-2xl relative overflow-hidden group border border-slate-200/50 ${collapsed ? 'md:hidden' : ''}`}>
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
