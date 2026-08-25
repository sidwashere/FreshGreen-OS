import React, { useState, useMemo } from 'react';
import {
  Plus, Search, CheckCircle2, Circle, Clock, Pause, Rocket,
  ChevronDown, X, Tag, User, Calendar, MessageSquare, Edit3,
  Trash2, Filter, ArrowUpDown, ExternalLink
} from 'lucide-react';
import {
  FeatureRequest, FeatureStatus, FeaturePriority, FeatureArea
} from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<FeatureStatus, { label: string; color: string; bg: string; icon: React.FC<any> }> = {
  requested:    { label: 'Requested',    color: 'text-slate-600',   bg: 'bg-slate-100',   icon: Circle },
  planned:      { label: 'Planned',      color: 'text-blue-600',    bg: 'bg-blue-50',     icon: Circle },
  'in-progress':{ label: 'In Progress',  color: 'text-amber-600',   bg: 'bg-amber-50',    icon: Clock },
  shipped:      { label: 'Shipped',      color: 'text-emerald-600', bg: 'bg-emerald-50',  icon: CheckCircle2 },
  deferred:     { label: 'Deferred',     color: 'text-slate-400',   bg: 'bg-slate-50',    icon: Pause },
};

const PRIORITY_CONFIG: Record<FeaturePriority, { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'text-red-600',    dot: 'bg-red-500' },
  high:     { label: 'High',     color: 'text-orange-600', dot: 'bg-orange-500' },
  medium:   { label: 'Medium',   color: 'text-yellow-600', dot: 'bg-yellow-500' },
  low:      { label: 'Low',      color: 'text-slate-400',  dot: 'bg-slate-300' },
};

const AREA_OPTIONS: FeatureArea[] = ['editor', 'autoblog', 'seo', 'wordpress', 'dashboard', 'images', 'brands', 'deployment', 'other'];

const STATUS_FLOW: FeatureStatus[] = ['requested', 'planned', 'in-progress', 'shipped'];

const VERSION_PRESETS = [
  'v0.1 — Foundation',
  'v0.2 — Core Blog Engine',
  'v0.3 — AutoBlog & Sheets',
  'v0.4 — WP Integration',
  'v1.0 — First Stable',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => `fr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ─── Add/Edit Modal ───────────────────────────────────────────────────────────

interface ModalProps {
  item?: FeatureRequest;
  onSave: (item: FeatureRequest) => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
}

const FeatureModal: React.FC<ModalProps> = ({ item, onSave, onClose, onDelete }) => {
  const isNew = !item;
  const [title, setTitle] = useState(item?.title || '');
  const [description, setDescription] = useState(item?.description || '');
  const [priority, setPriority] = useState<FeaturePriority>(item?.priority || 'medium');
  const [area, setArea] = useState<FeatureArea>(item?.area || 'other');
  const [requestedBy, setRequestedBy] = useState(item?.requestedBy || '');
  const [tags, setTags] = useState(item?.tags?.join(', ') || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const [status, setStatus] = useState<FeatureStatus>(item?.status || 'requested');
  const [shippedVersion, setShippedVersion] = useState(item?.shippedInVersion || '');

  const handleSave = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: item?.id || uid(),
      userId: item?.userId || '',
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      area,
      requestedBy: requestedBy.trim() || 'Unknown',
      requestedAt: item?.requestedAt || now,
      completedAt: status === 'shipped' ? (item?.completedAt || now) : undefined,
      shippedInVersion: status === 'shipped' ? shippedVersion : undefined,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      notes: notes.trim(),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-start justify-center pt-[8vh] px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[84vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10 rounded-t-2xl">
          <h3 className="text-lg font-bold text-slate-900">{isNew ? 'New Feature Request' : 'Edit Feature'}</h3>
          <div className="flex items-center gap-2">
            {!isNew && onDelete && (
              <button onClick={() => { onDelete(item!.id); onClose(); }} className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="What's needed?"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Details, context, why it matters…"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none" />
          </div>

          {/* Row: Priority + Area */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">Priority</label>
              <div className="flex gap-1.5">
                {(Object.entries(PRIORITY_CONFIG) as [FeaturePriority, typeof PRIORITY_CONFIG.low][]).map(([key, cfg]) => (
                  <button key={key} onClick={() => setPriority(key)}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold transition border ${
                      priority === key ? `${cfg.dot}/20 text-current border-current` : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                    }`} style={priority === key ? { backgroundColor: `color-mix(in srgb, ${getComputedStyle(document.documentElement).getPropertyValue('--tw-' + cfg.dot.replace('bg-', ''))} 15%, white)` } : undefined}>
                    {cfg.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">Area</label>
              <select value={area} onChange={e => setArea(e.target.value as FeatureArea)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                {AREA_OPTIONS.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
              </select>
            </div>
          </div>

          {/* Row: Status + Requested by */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as FeatureStatus)}
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none">
                {(Object.entries(STATUS_CONFIG) as [FeatureStatus, typeof STATUS_CONFIG.requested][]).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">Requested by</label>
              <input value={requestedBy} onChange={e => setRequestedBy(e.target.value)} placeholder="e.g. Carol"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
            </div>
          </div>

          {/* Version (when shipped or planning to ship) */}
          {(status === 'shipped' || status === 'in-progress') && (
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1.5">
                {status === 'shipped' ? 'Shipped in version *' : 'Target version'}
              </label>
              <input value={shippedVersion} onChange={e => setShippedVersion(e.target.value)} list="version-presets"
                placeholder="e.g. v0.3 — AutoBlog & Sheets"
                className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
              <datalist id="version-presets">
                {VERSION_PRESETS.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>
          )}

          {/* Tags */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Tags</label>
            <input value={tags} onChange={e => setTags(e.target.value)} placeholder="comma-separated, e.g. automation, scheduling"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">Internal Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Implementation notes, blockers, links…"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-none" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-slate-100 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition">Cancel</button>
          <button onClick={handleSave} disabled={!title.trim()}
            className="px-6 py-2.5 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
            {isNew ? 'Add Request' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface FeatureTrackerProps {
  features: FeatureRequest[];
  onSave: (item: FeatureRequest) => void;
  onDelete: (id: string) => void;
}

export const FeatureTracker: React.FC<FeatureTrackerProps> = ({ features, onSave, onDelete }) => {
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<FeatureStatus | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<FeaturePriority | 'all'>('all');
  const [filterArea, setFilterArea] = useState<FeatureArea | 'all'>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'date' | 'status'>('priority');
  const [modalItem, setModalItem] = useState<FeatureRequest | null | undefined>(undefined); // undefined = closed, null = new
  const [quickShipVersion, setQuickShipVersion] = useState<string | null>(null);

  // ─── Stats ───────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const s = { requested: 0, planned: 0, 'in-progress': 0, shipped: 0, deferred: 0, total: features.length };
    features.forEach(f => s[f.status]++);
    return s;
  }, [features]);

  // ─── Filter + Sort ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = features;

    if (filterStatus !== 'all') result = result.filter(f => f.status === filterStatus);
    if (filterPriority !== 'all') result = result.filter(f => f.priority === filterPriority);
    if (filterArea !== 'all') result = result.filter(f => f.area === filterArea);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(f =>
        f.title.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.tags.some(t => t.toLowerCase().includes(q)) ||
        f.requestedBy.toLowerCase().includes(q)
      );
    }

    const priorityOrder: Record<FeaturePriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const statusOrder: Record<FeatureStatus, number> = { 'in-progress': 0, requested: 1, planned: 2, shipped: 3, deferred: 4 };

    return [...result].sort((a, b) => {
      if (sortBy === 'priority') return priorityOrder[a.priority] - priorityOrder[b.priority];
      if (sortBy === 'status') return statusOrder[a.status] - statusOrder[b.status];
      return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
    });
  }, [features, filterStatus, filterPriority, filterArea, search, sortBy]);

  // ─── Quick Status Advance ────────────────────────────────────────────────
  const advanceStatus = (item: FeatureRequest) => {
    const idx = STATUS_FLOW.indexOf(item.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    if (next === 'shipped') {
      setQuickShipVersion(item.id);
      return;
    }
    onSave({ ...item, status: next, completedAt: undefined, shippedInVersion: undefined });
  };

  const confirmShip = (item: FeatureRequest, version: string) => {
    onSave({
      ...item,
      status: 'shipped',
      completedAt: new Date().toISOString(),
      shippedInVersion: version || 'unversioned',
    });
    setQuickShipVersion(null);
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Feature Tracker</h1>
          <p className="text-sm text-slate-500 mt-1">Track, prioritise, and ship across every build.</p>
        </div>
        <button onClick={() => setModalItem(null)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition shadow-sm shrink-0">
          <Plus className="w-4 h-4" /> New Request
        </button>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-5 gap-3">
        {(Object.entries(stats) as [string, number][]).filter(([k]) => k !== 'total').map(([key, count]) => {
          const cfg = STATUS_CONFIG[key as FeatureStatus];
          const Icon = cfg.icon;
          return (
            <button key={key} onClick={() => setFilterStatus(filterStatus === key ? 'all' : key as FeatureStatus)}
              className={`p-3 rounded-xl border text-center transition ${
                filterStatus === key ? 'ring-2 ring-indigo-500 border-indigo-300' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <div className={`inline-flex p-1.5 rounded-lg ${cfg.bg} mb-1`}>
                <Icon className={`w-4 h-4 ${cfg.color}`} />
              </div>
              <div className="text-xl font-bold text-slate-900">{count}</div>
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{cfg.label}</div>
            </button>
          );
        })}
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search features…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
        </div>

        {/* Priority filter */}
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as any)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none">
          <option value="all">All Priorities</option>
          {(Object.entries(PRIORITY_CONFIG) as [FeaturePriority, any][]).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Area filter */}
        <select value={filterArea} onChange={e => setFilterArea(e.target.value as any)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none">
          <option value="all">All Areas</option>
          {AREA_OPTIONS.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
        </select>

        {/* Sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm bg-white outline-none">
          <option value="priority">Sort: Priority</option>
          <option value="status">Sort: Status</option>
          <option value="date">Sort: Newest</option>
        </select>

        {(filterStatus !== 'all' || filterPriority !== 'all' || filterArea !== 'all' || search) && (
          <button onClick={() => { setFilterStatus('all'); setFilterPriority('all'); setFilterArea('all'); setSearch(''); }}
            className="text-xs text-indigo-600 font-semibold hover:underline">Clear filters</button>
        )}
      </div>

      {/* Feature List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <Circle className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-semibold">No features match your filters</p>
          <p className="text-sm mt-1">{features.length === 0 ? 'Add your first feature request above.' : 'Try clearing some filters.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {filtered.map(item => {
            const scfg = STATUS_CONFIG[item.status];
            const pcfg = PRIORITY_CONFIG[item.priority];
            const StatusIcon = scfg.icon;
            const canAdvance = STATUS_FLOW.includes(item.status) && STATUS_FLOW.indexOf(item.status) < STATUS_FLOW.length - 1;

            return (
              <div key={item.id} className="group px-5 py-4 hover:bg-slate-50/60 transition-colors">
                <div className="flex items-start gap-4">
                  {/* Status Toggle */}
                  <button onClick={() => canAdvance && advanceStatus(item)}
                    disabled={!canAdvance}
                    title={canAdvance ? `Advance to ${STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(item.status) + 1]]?.label}` : 'Final status'}
                    className={`mt-0.5 p-1 rounded-lg transition ${
                      canAdvance ? 'hover:bg-slate-100 cursor-pointer' : 'cursor-default opacity-40'
                    }`}>
                    <StatusIcon className={`w-5 h-5 ${scfg.color}`} />
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Priority dot */}
                      <span className={`w-2 h-2 rounded-full shrink-0 ${pcfg.dot}`} title={pcfg.label} />
                      <h3 className="text-sm font-bold text-slate-900 truncate">{item.title}</h3>
                      {/* Status badge */}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${scfg.bg} ${scfg.color} shrink-0`}>
                        {scfg.label}
                      </span>
                      {/* Area tag */}
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 shrink-0">
                        {item.area}
                      </span>
                      {item.shippedInVersion && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                          {item.shippedInVersion}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-slate-400">
                      {item.requestedBy && (
                        <span className="flex items-center gap-1">
                          <User className="w-3 h-3" /> {item.requestedBy}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {timeAgo(item.requestedAt)}
                      </span>
                      {item.completedAt && (
                        <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                          <CheckCircle2 className="w-3 h-3" /> shipped {timeAgo(item.completedAt)}
                        </span>
                      )}
                      {item.tags.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Tag className="w-3 h-3" /> {item.tags.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                    {canAdvance && (
                      <button onClick={() => advanceStatus(item)}
                        title={`Move to ${STATUS_CONFIG[STATUS_FLOW[STATUS_FLOW.indexOf(item.status) + 1]]?.label}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition">
                        <ArrowUpDown className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => setModalItem(item)}
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition">
                      <Edit3 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Quick Ship version input */}
                {quickShipVersion === item.id && (
                  <div className="ml-9 mt-3 flex items-center gap-2 bg-emerald-50 rounded-xl px-4 py-3 border border-emerald-200">
                    <Rocket className="w-4 h-4 text-emerald-600 shrink-0" />
                    <input autoFocus placeholder="Version, e.g. v0.3 — AutoBlog & Sheets"
                      className="flex-1 bg-transparent text-sm outline-none placeholder:text-emerald-400"
                      onKeyDown={e => {
                        if (e.key === 'Enter') confirmShip(item, (e.target as HTMLInputElement).value);
                        if (e.key === 'Escape') setQuickShipVersion(null);
                      }}
                      onBlur={e => { if (e.target.value) confirmShip(item, e.target.value); else setQuickShipVersion(null); }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Summary footer */}
      <div className="text-center text-xs text-slate-400">
        {stats.total} total · {stats.shipped} shipped · {stats['in-progress'] + stats.planned + stats.requested} active
      </div>

      {/* Modal */}
      {modalItem !== undefined && (
        <FeatureModal
          item={modalItem || undefined}
          onSave={onSave}
          onClose={() => setModalItem(undefined)}
          onDelete={onDelete}
        />
      )}
    </div>
  );
};
