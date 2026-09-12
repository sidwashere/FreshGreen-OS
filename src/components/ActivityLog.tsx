import React, { useState, useEffect, useMemo } from 'react';
import { 
  ActivityLog as LogEntry, 
  ActivityCategory, 
  ActivityStatus, 
  subscribeToLogs, 
  logActivity 
} from '../lib/activityLogger';
import { Brand } from '../types';
import { BrandSwitcher } from './BrandSwitcher';
import {
  Activity,
  Search,
  Filter,
  Download,
  Terminal,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  Info,
  Sparkles,
  Globe,
  FileCode,
  Layers,
  Clock,
  User,
  ChevronRight,
  ChevronDown,
  X,
  RefreshCw,
  Copy,
  Check
} from 'lucide-react';

interface ActivityLogProps {
  brands: Brand[];
  selectedBrandId?: string;
  onSelectBrand?: (id: string) => void;
}

export const ActivityLogView: React.FC<ActivityLogProps> = ({ brands, selectedBrandId, onSelectBrand }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ActivityCategory | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ActivityStatus | 'all'>('all');
  const [brandFilter, setBrandFilter] = useState<string>(selectedBrandId || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Subscribe to real-time Firestore activity logs
  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToLogs((fetchedLogs) => {
      setLogs(fetchedLogs);
      setLoading(false);
    }, { maxLogs: 300 });

    return () => unsubscribe();
  }, []);

  // Synchronize prop brand selection if changed externally
  useEffect(() => {
    if (selectedBrandId) {
      setBrandFilter(selectedBrandId);
    }
  }, [selectedBrandId]);

  // Filter logs based on active controls
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Category tab filter
      if (activeTab !== 'all' && log.category !== activeTab) return false;
      // Status filter
      if (statusFilter !== 'all' && log.status !== statusFilter) return false;
      // Brand filter
      if (brandFilter !== 'all' && log.brandId !== brandFilter) return false;
      // Search query filter (matches title, message, action, user email, brand)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const textToSearch = `${log.title} ${log.message} ${log.action} ${log.userEmail || ''} ${log.brandName || ''}`.toLowerCase();
        if (!textToSearch.includes(q)) return false;
      }
      return true;
    });
  }, [logs, activeTab, statusFilter, brandFilter, searchQuery]);

  // Log counts for category tabs
  const categoryCounts = useMemo(() => {
    const counts = { all: logs.length, generation: 0, api_request: 0, error: 0, event: 0, output: 0 };
    logs.forEach((log) => {
      if (counts[log.category] !== undefined) {
        counts[log.category]++;
      }
    });
    return counts;
  }, [logs]);

  // Export logs to JSON file
  const exportLogsAsJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(filteredLogs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `fgos_activity_logs_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Export logs to CSV file
  const exportLogsAsCsv = () => {
    const headers = ['Timestamp', 'Category', 'Status', 'Action', 'Title', 'Brand', 'User', 'Message'];
    const rows = filteredLogs.map((l) => [
      `"${l.timestamp}"`,
      `"${l.category}"`,
      `"${l.status}"`,
      `"${l.action}"`,
      `"${(l.title || '').replace(/"/g, '""')}"`,
      `"${(l.brandName || '').replace(/"/g, '""')}"`,
      `"${l.userEmail || 'system'}"`,
      `"${(l.message || '').replace(/"/g, '""')}"`
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `fgos_activity_logs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getStatusBadge = (status: ActivityStatus) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Success
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-600 border border-rose-500/20">
            <AlertCircle className="w-3.5 h-3.5" />
            Error
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5" />
            Warning
          </span>
        );
      case 'info':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/10 text-sky-600 border border-sky-500/20">
            <Info className="w-3.5 h-3.5" />
            Info
          </span>
        );
    }
  };

  const getCategoryIcon = (category: ActivityCategory) => {
    switch (category) {
      case 'generation':
        return <Sparkles className="w-4 h-4 text-purple-500" />;
      case 'api_request':
        return <Globe className="w-4 h-4 text-indigo-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      case 'output':
        return <FileCode className="w-4 h-4 text-teal-500" />;
      case 'event':
      default:
        return <Layers className="w-4 h-4 text-blue-500" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Activity Counter Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center font-bold">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                System Activity Log
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" title="Live stream active"></span>
                </span>
              </h1>
              <p className="text-sm text-slate-500">
                Real-time persistent audit trail of AI generations, API requests, system events, and errors.
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onSelectBrand && (
            <BrandSwitcher
              brands={brands}
              selectedBrandId={selectedBrandId || 'all'}
              onSelectBrand={onSelectBrand}
              allLabel="All brands"
              size="sm"
            />
          )}
          <button
            onClick={() => {
              logActivity({
                category: 'event',
                status: 'info',
                action: 'audit_check',
                title: 'Manual Audit Health Check',
                message: 'System audit log status verified by operator.',
              });
            }}
            className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition flex items-center gap-1.5"
            title="Inject test audit heartbeat"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Health Check
          </button>
          
          <button
            onClick={exportLogsAsCsv}
            disabled={filteredLogs.length === 0}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition shadow-sm flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          
          <button
            onClick={exportLogsAsJson}
            disabled={filteredLogs.length === 0}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition shadow-sm flex items-center gap-1.5"
          >
            <Terminal className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        {/* Category Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-100 pb-3 overflow-x-auto scrollbar-none">
          {[
            { id: 'all', label: 'All Activities', count: categoryCounts.all },
            { id: 'generation', label: 'Generations', count: categoryCounts.generation },
            { id: 'api_request', label: 'API Requests', count: categoryCounts.api_request },
            { id: 'error', label: 'Errors', count: categoryCounts.error },
            { id: 'event', label: 'System Events', count: categoryCounts.event },
            { id: 'output', label: 'Outputs', count: categoryCounts.output },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition flex items-center gap-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === tab.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Filters & Search Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          {/* Search input */}
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search activity by title, message, action, email, brand..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-slate-800 placeholder-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="md:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-slate-700"
            >
              <option value="all">Filter Status: All</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
          </div>

          {/* Brand Filter */}
          <div className="md:col-span-3">
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className="w-full py-2 px-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition text-slate-700"
            >
              <option value="all">Filter Brand: All Brands</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table / List */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
            <p className="text-xs font-medium">Connecting to persistent activity stream...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <Terminal className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-sm font-semibold text-slate-700">No activity logs found</p>
            <p className="text-xs text-slate-400">
              {searchQuery || activeTab !== 'all' || statusFilter !== 'all' || brandFilter !== 'all'
                ? 'Try adjusting your filters or search criteria.'
                : 'Activities will populate automatically as AI generations, API syncs, and system events occur.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const dateObj = new Date(log.timestamp);
              const formattedDate = dateObj.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              });
              const formattedTime = dateObj.toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });

              return (
                <div key={log.id} className="hover:bg-slate-50/80 transition">
                  {/* Summary Row */}
                  <div
                    onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                    className="p-4 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start md:items-center gap-3 min-w-0">
                      <button className="text-slate-400 mt-0.5 md:mt-0">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-indigo-600" /> : <ChevronRight className="w-4 h-4" />}
                      </button>

                      <div className="p-2 rounded-lg bg-slate-100 shrink-0">
                        {getCategoryIcon(log.category)}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900 truncate">
                            {log.title}
                          </span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200/60">
                            {log.action}
                          </span>
                          {log.brandName && (
                            <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium text-[10px] border border-indigo-100">
                              {log.brandName}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-500 line-clamp-1">{log.message}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end md:self-auto text-slate-500">
                      {log.durationMs !== undefined && (
                        <span className="font-mono text-[11px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {log.durationMs}ms
                        </span>
                      )}

                      {getStatusBadge(log.status)}

                      <div className="text-right font-mono text-[11px] text-slate-400">
                        <div>{formattedTime}</div>
                        <div className="text-[10px] text-slate-400/80">{formattedDate}</div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Detail Inspector Drawer */}
                  {isExpanded && (
                    <div className="px-6 py-4 bg-slate-950 text-slate-200 border-t border-slate-800 space-y-4 font-mono text-xs">
                      <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-4">
                          <span>Log ID: <span className="text-slate-200">{log.id}</span></span>
                          <span>User: <span className="text-slate-200">{log.userEmail || 'system'}</span></span>
                          <span>ISO: <span className="text-slate-200">{log.timestamp}</span></span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyToClipboard(JSON.stringify(log, null, 2), log.id);
                          }}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1 text-[11px]"
                        >
                          {copiedId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copiedId === log.id ? 'Copied' : 'Copy Payload'}
                        </button>
                      </div>

                      {/* Log Message Detailed */}
                      <div>
                        <div className="text-[11px] text-slate-400 mb-1">Description / Log Message:</div>
                        <div className="p-3 rounded bg-slate-900 border border-slate-800 text-slate-200 font-sans">
                          {log.message}
                        </div>
                      </div>

                      {/* Payload Inspector */}
                      {log.payload && Object.keys(log.payload).length > 0 && (
                        <div>
                          <div className="text-[11px] text-slate-400 mb-1">Request Payload / Context:</div>
                          <pre className="p-3 rounded bg-slate-900 border border-slate-800 text-emerald-400 overflow-x-auto max-h-60 scrollbar-thin">
                            {JSON.stringify(log.payload, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Response / Output Inspector */}
                      {log.response && Object.keys(log.response).length > 0 && (
                        <div>
                          <div className="text-[11px] text-slate-400 mb-1">Response Output / Diagnostic:</div>
                          <pre className="p-3 rounded bg-slate-900 border border-slate-800 text-sky-300 overflow-x-auto max-h-60 scrollbar-thin">
                            {JSON.stringify(log.response, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
