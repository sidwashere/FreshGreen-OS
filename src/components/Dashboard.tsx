import React, { useState, useMemo } from 'react';
import { ContentItem, Brand, PipelineStatus } from '../types';
import { 
  Plus, 
  Search, 
  Sparkles, 
  Calendar,
  TrendingUp,
  FileText,
  Activity,
  MousePointerClick,
  ChevronRight,
  Clock,
  MoreVertical,
  CheckCircle2,
  Globe,
  RefreshCcw
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

interface DashboardProps {
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (brandId: string) => void;
  onEditItem: (item: ContentItem) => void;
  onCreateNewItem: (title: string, brandId: string, contentType: 'post' | 'page') => void;
  onImportWPPost?: (post: any) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
  onCreateNewItem,
  onImportWPPost,
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBrandId, setNewBrandId] = useState(selectedBrandId === 'all' ? (brands[0]?.id || '') : selectedBrandId);
  const [newType, setNewType] = useState<'post' | 'page'>('post');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(new Date().toISOString());
  const [brandStats, setBrandStats] = useState<Record<string, any>>({});
  const [livePosts, setLivePosts] = useState<any[]>([]);
  
  const handleSyncData = async () => {
    setIsSyncing(true);
    try {
      const newStats: Record<string, any> = {};
      const newPosts: any[] = [];
      
      for (const brand of brands) {
        try {
          const res = await fetch('/api/wp/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wpUrl: brand.wpUrl,
              wpUsername: brand.wpUsername,
              wpAppPassword: brand.wpAppPassword
            })
          });
          const data = await res.json();
          if (data.success && data.stats) {
            newStats[brand.id] = data.stats;
          } else {
            newStats[brand.id] = { totalPosts: 0, totalPages: 0, totalComments: 0, totalMedia: 0, error: true };
          }

          // Fetch recent posts
          const postsRes = await fetch('/api/wp/posts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wpUrl: brand.wpUrl,
              wpUsername: brand.wpUsername,
              wpAppPassword: brand.wpAppPassword,
              per_page: 50
            })
          });
          const postsData = await postsRes.json();
          if (postsData.success && postsData.posts) {
             postsData.posts.forEach((post: any) => {
                 newPosts.push({
                     ...post,
                     brandId: brand.id,
                     brandName: brand.name,
                     brandColor: brand.primaryColor
                 });
             });
          }
        } catch (e) {
          newStats[brand.id] = { totalPosts: 0, totalPages: 0, totalComments: 0, totalMedia: 0, error: true };
        }
      }
      
      // Sort posts by date descending
      newPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      setLivePosts(newPosts);
      setBrandStats(newStats);
      setLastSyncTime(new Date().toISOString());
    } finally {
      setIsSyncing(false);
    }
  };

  React.useEffect(() => {
    if (brands.length > 0 && Object.keys(brandStats).length === 0) {
      handleSyncData();
    }
  }, [brands]);

  const currentStats = useMemo(() => {
    if (selectedBrandId === 'all') {
      let totalPosts = 0;
      let totalPages = 0;
      let totalComments = 0;
      let totalMedia = 0;
      Object.values(brandStats).forEach((stat: any) => {
        if (!stat.error) {
          totalPosts += parseInt(stat.totalPosts || '0', 10);
          totalPages += parseInt(stat.totalPages || '0', 10);
          totalComments += parseInt(stat.totalComments || '0', 10);
          totalMedia += parseInt(stat.totalMedia || '0', 10);
        }
      });
      return { totalPosts, totalPages, totalComments, totalMedia };
    } else {
      const stat = brandStats[selectedBrandId];
      if (!stat || stat.error) {
        return { totalPosts: 0, totalPages: 0, totalComments: 0, totalMedia: 0 };
      }
      return {
        totalPosts: parseInt(stat.totalPosts || '0', 10),
        totalPages: parseInt(stat.totalPages || '0', 10),
        totalComments: parseInt(stat.totalComments || '0', 10),
        totalMedia: parseInt(stat.totalMedia || '0', 10),
      };
    }
  }, [brandStats, selectedBrandId]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesBrand = selectedBrandId === 'all' || item.brandId === selectedBrandId;
      const matchesQuery = searchQuery === '' || 
        item.title.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesBrand && matchesQuery;
    });
  }, [items, selectedBrandId, searchQuery]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onCreateNewItem(newTitle.trim(), newBrandId, newType);
    setNewTitle('');
    setShowCreateModal(false);
  };

  const chartData = [
    { name: 'Mon', traffic: 1240, generated: 2 },
    { name: 'Tue', traffic: 1350, generated: 4 },
    { name: 'Wed', traffic: 1800, generated: 1 },
    { name: 'Thu', traffic: 1950, generated: 3 },
    { name: 'Fri', traffic: 2200, generated: 5 },
    { name: 'Sat', traffic: 2500, generated: 2 },
    { name: 'Sun', traffic: 2800, generated: 0 },
  ];

  return (
    <div className="p-8 max-w-[1600px] mx-auto min-h-full font-sans bg-slate-50 text-slate-900">
      
      {/* Top Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center space-x-4">
          <div className="relative w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search content..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-100 border-none text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-none text-slate-800 placeholder:text-slate-500"
            />
          </div>
          <select
            value={selectedBrandId}
            onChange={(e) => onSelectBrand(e.target.value)}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
          >
            <option value="all">All Brands Properties ({items.length})</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={handleSyncData}
            disabled={isSyncing}
            className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm disabled:opacity-70 disabled:cursor-wait"
          >
            <RefreshCcw className={`w-4 h-4 text-slate-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? 'Syncing...' : 'Sync Data'}</span>
          </button>
          <button className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span>Last 7 Days</span>
          </button>
          <button
            onClick={() => {
              if (selectedBrandId !== 'all') setNewBrandId(selectedBrandId);
              setShowCreateModal(true);
            }}
            disabled={brands.length === 0}
            title={brands.length === 0 ? "Please create a brand first" : ""}
            className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Blog</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {[
          { label: 'Live Published Posts', value: currentStats.totalPosts.toLocaleString(), subtext: 'Successfully fetched from WP', icon: Activity, color: 'text-white', bg: 'bg-white/20', trend: 'Live Data', trendUp: true, isPrimary: true, details: `Total live post count returned by WordPress REST API for ${selectedBrandId === 'all' ? 'all brands' : 'the selected brand'}.` },
          { label: 'Live Published Pages', value: currentStats.totalPages.toLocaleString(), subtext: 'Successfully fetched from WP', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', trend: 'Live Data', trendUp: true, details: 'Total live page count returned by WordPress REST API.' },
          { label: 'Total Comments', value: currentStats.totalComments.toLocaleString(), subtext: 'User engagement', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50', trend: 'Live Data', trendUp: true, details: 'Total approved comments on published content.' },
          { label: 'Media Library Items', value: currentStats.totalMedia.toLocaleString(), subtext: 'Images and assets', icon: Clock, color: 'text-purple-600', bg: 'bg-purple-50', trend: 'Live Data', trendUp: true, details: 'Total attachments and media items available on the WordPress media library.' }
        ].map((metric, idx) => (
          <div 
            key={idx} 
            onClick={() => setExpandedInsight(expandedInsight === idx ? null : idx)}
            className={`p-6 rounded-[24px] border cursor-pointer ${metric.isPrimary ? 'bg-[#185e46] border-[#134937] text-white shadow-lg shadow-[#185e46]/20' : 'bg-white border-slate-200/60 shadow-sm'} flex flex-col justify-between hover:shadow-md transition group relative overflow-hidden`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${metric.bg}`}>
                <metric.icon className={`w-5 h-5 ${metric.color}`} />
              </div>
              <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${metric.isPrimary ? 'bg-white/20 text-white' : metric.trendUp ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                {metric.trend}
              </span>
            </div>
            <div>
              <div className={`text-4xl font-extrabold tracking-tight mb-2 ${metric.isPrimary ? 'text-white' : 'text-slate-900'}`}>{metric.value}</div>
              <div className={`text-[13px] font-bold ${metric.isPrimary ? 'text-emerald-50' : 'text-slate-900'}`}>{metric.label}</div>
              <div className={`text-[11px] font-medium mt-1 ${metric.isPrimary ? 'text-emerald-200' : 'text-slate-500'}`}>{metric.subtext}</div>
            </div>
            
            {/* Expanded Insight Details */}
            <div className={`mt-4 border-t ${metric.isPrimary ? 'border-white/20' : 'border-slate-100'} transition-all duration-300 ${expandedInsight === idx ? 'max-h-40 opacity-100 pt-4' : 'max-h-0 opacity-0 overflow-hidden pt-0 border-transparent'}`}>
                <p className={`text-[12px] font-medium leading-relaxed ${metric.isPrimary ? 'text-emerald-50' : 'text-slate-600'}`}>{metric.details}</p>
                <p className={`text-[10px] mt-2 ${metric.isPrimary ? 'text-emerald-200' : 'text-slate-400'}`}>Pulled: {new Date(lastSyncTime).toLocaleTimeString()}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Chart & Content Grid */}
        <div className="lg:col-span-2 space-y-6">
          {/* Chart Section */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Organic Traffic Correlation Index</h2>
                <p className="text-sm text-slate-500">Matching published article volume against 14-day organic traffic growth. <span className="text-xs text-slate-400 ml-2">Updated: {new Date(lastSyncTime).toLocaleTimeString()}</span></p>
              </div>
              <button className="p-2 text-slate-400 hover:bg-slate-50 rounded-lg transition-colors">
                <RefreshCcw onClick={handleSyncData} className={`w-5 h-5 ${isSyncing ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dx={-10} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line type="monotone" dataKey="traffic" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="generated" stroke="#10b981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Structured Card Grid */}
          <div className="bg-white rounded-[24px] border border-slate-200/60 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Pipeline Breakdown</h2>
                <p className="text-xs text-slate-500 mt-1">Real-time snapshot of where posts sit in the workflow.</p>
              </div>
              <button className="text-sm font-semibold text-indigo-600 hover:text-indigo-700 flex items-center transition-colors">
                View All <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
            
            {filteredItems.length === 0 ? (
              <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-[20px] bg-slate-50/50">
                <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-slate-900">No content found</h3>
                <p className="text-xs text-slate-500 mt-1 mb-4">Start by creating a new blog from scratch.</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition"
                >
                  Create New Blog
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredItems.slice(0, 6).map(item => {
                  const brand = brands.find(b => b.id === item.brandId);
                  return (
                    <div key={item.id} className="p-4 rounded-[16px] border border-slate-100 hover:border-indigo-200 hover:shadow-md transition bg-slate-50/50 hover:bg-white group cursor-pointer" onClick={() => onEditItem(item)}>
                      <div className="flex items-center justify-between mb-2 text-xs">
                        <span 
                          className="px-2 py-1 rounded-md font-bold uppercase tracking-wider text-[10px]"
                          style={{ backgroundColor: `${brand?.primaryColor || '#4f46e5'}20`, color: brand?.primaryColor || '#4f46e5' }}
                        >
                          {brand?.name}
                        </span>
                        <span className="text-slate-400 font-medium flex items-center">
                          <Clock className="w-3 h-3 mr-1" /> {item.status}
                        </span>
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2 group-hover:text-indigo-600 transition">
                        {item.title}
                      </h4>
                      <div className="mt-3 flex items-center text-xs text-slate-500 justify-between">
                        <span className="font-mono bg-white px-2 py-1 rounded border border-slate-200 truncate max-w-[150px]">
                          {item.primaryKeyword || 'No keyword'}
                        </span>
                        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Multi-Brand Health & Activity Logs */}
        <div className="space-y-6">
          {/* Multi-Brand Portfolio Health */}
          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Portfolio Health</h2>
              <span className="bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2 py-1 rounded-full border border-emerald-100">
                ALL SYSTEMS GO
              </span>
            </div>
            <div className="space-y-5">
              {brands.map((brand, i) => {
                const stat = brandStats[brand.id];
                const isError = stat?.error;
                const total = parseInt(stat?.totalPosts || '0', 10);
                // We'll calculate a percentage relative to a target of 100 posts for the progress bar
                const percent = isError ? 0 : Math.min(100, Math.round((total / 100) * 100));

                return (
                <div key={brand.id} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-[12px] flex items-center justify-center font-bold text-xs text-white shadow-sm transition-transform group-hover:scale-105"
                      style={{ backgroundColor: brand.primaryColor || '#4f46e5' }}
                    >
                      {brand.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm leading-tight group-hover:text-indigo-600 transition-colors">{brand.name}</div>
                      <div className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-1.5">
                        {isError ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                            </span>
                            Sync Failed
                          </>
                        ) : stat ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                            </span>
                            Live Sync Active
                          </>
                        ) : (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-300"></span>
                            </span>
                            Pending Sync
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-slate-700">{isError ? 'Error' : `${total} Posts`}</div>
                    <div className="w-16 h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-1000 ${isError ? 'bg-red-400' : ''}`} style={{ width: `${percent}%`, backgroundColor: !isError ? (brand.primaryColor || '#4f46e5') : undefined }} />
                    </div>
                  </div>
                </div>
              )})}
            </div>
          </div>

          <div className="bg-white p-6 rounded-[24px] border border-slate-200/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-slate-900">Live WordPress Posts</h2>
              <button className="text-slate-400 hover:text-slate-600">
                <Globe className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {livePosts.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-slate-500">No live posts fetched yet.</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Sync Data" to fetch recent posts directly from connected WordPress properties.</p>
                </div>
              ) : (
                livePosts
                  .filter(post => selectedBrandId === 'all' || post.brandId === selectedBrandId)
                  .map((post, i) => (
                  <button 
                    key={`${post.brandId}-${post.id}`} 
                    onClick={() => onImportWPPost && onImportWPPost(post)}
                    className="group block relative flex items-start gap-4 p-3 rounded-2xl hover:bg-slate-50 transition border border-transparent hover:border-slate-100 w-full text-left"
                  >
                    <div className="w-10 h-10 rounded-[12px] flex items-center justify-center font-bold text-xs text-white shadow-sm shrink-0"
                         style={{ backgroundColor: post.brandColor || '#4f46e5' }}>
                      {post.brandName ? post.brandName.substring(0, 2).toUpperCase() : 'WP'}
                    </div>
                    <div className="pt-0.5 flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 leading-snug truncate group-hover:text-indigo-600 transition" dangerouslySetInnerHTML={{ __html: post.title?.rendered || 'Untitled Post' }} />
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{post.brandName}</span>
                        <span className="text-[10px] font-medium text-slate-400">{new Date(post.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="pt-2 flex flex-col items-end gap-1">
                       <span className="text-[10px] text-indigo-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity">Edit directly</span>
                       <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Modal: Create New Content Item */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-8 shadow-2xl border border-slate-200 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                Plan New Blog Post
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Target Brand Property</label>
                <select
                  value={newBrandId}
                  onChange={(e) => setNewBrandId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Publish Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewType('post')}
                    className={`py-3 rounded-xl text-sm font-bold border transition ${
                      newType === 'post'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-500/20'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    📝 Blog Post
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewType('page')}
                    className={`py-3 rounded-xl text-sm font-bold border transition ${
                      newType === 'page'
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300 ring-2 ring-indigo-500/20'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    📄 Landing Page
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Topic or Working Title</label>
                <input
                  type="text"
                  placeholder="e.g. 10 Natural Dog Treats for Digestive Health"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none placeholder:text-slate-400"
                  required
                  autoFocus
                />
              </div>

              <div className="pt-4 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm transition shadow-md flex items-center gap-2"
                >
                  Create & Launch Editor <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
