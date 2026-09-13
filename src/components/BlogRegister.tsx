import React, { useMemo, useState } from 'react';
import { ContentItem, Brand } from '../types';
import { BlogRegisterEntry, resolveBrandCode } from '../lib/blogRegister';
import { BrandSwitcher } from './BrandSwitcher';
import {
  Search,
  ExternalLink,
  Hash,
  Calendar,
  Globe,
  FileText,
  Tag,
  ArrowUpDown,
  RefreshCw,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';

interface BlogRegisterProps {
  register: BlogRegisterEntry[];
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
  onEditItem: (item: ContentItem) => void;
  onDeleteItem: (item: ContentItem) => Promise<{ success: boolean; message?: string }>;
  onDeleteEntry: (entryId: string) => Promise<{ success: boolean; message?: string }>;
}

const statusChip: Record<string, string> = {
  Planned: 'bg-slate-100 text-slate-600',
  Researching: 'bg-violet-100 text-violet-700',
  Generating: 'bg-amber-100 text-amber-700',
  Draft_Ready: 'bg-sky-100 text-sky-700',
  Published: 'bg-emerald-100 text-emerald-700',
  Error: 'bg-red-100 text-red-700',
};

const fmtDate = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Full timestamp (date + time) — used for Created / Published columns.
const fmtDateTime = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const BlogRegister: React.FC<BlogRegisterProps> = ({
  register,
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
  onDeleteItem,
  onDeleteEntry,
}) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'number' | 'created' | 'published'>('number');
  const [sortAsc, setSortAsc] = useState(true);
  const [armId, setArmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ── Multiselect / bulk delete ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const brandScoped = selectedBrandId !== 'all';
  const scoped = useMemo(
    () => (brandScoped ? register.filter((r) => r.brandId === selectedBrandId) : register),
    [register, selectedBrandId, brandScoped],
  );

  // Merge register entries with live item data (title/keywords may have changed).
  const merged = useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    return scoped.map((r) => {
      const item = itemById.get(r.contentItemId);
      return {
        entry: r,
        item,
        title: item?.title || r.title,
        keywords: item?.primaryKeyword || r.primaryKeyword,
        status: item?.status || r.status,
        liveUrl: item?.wpLiveUrl || r.wpLiveUrl,
        wpPostId: item?.wpPostId || r.wpPostId,
      };
    });
  }, [scoped, items]);

  const sorted = useMemo(() => {
    const arr = [...merged];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sort === 'number') cmp = a.entry.blogNumber.localeCompare(b.entry.blogNumber, undefined, { numeric: true });
      else if (sort === 'created') cmp = (a.entry.dateCreated || '').localeCompare(b.entry.dateCreated || '');
      else cmp = (a.entry.datePublished || '').localeCompare(b.entry.datePublished || '');
      return sortAsc ? cmp : -cmp;
    });
    const q = search.trim().toLowerCase();
    if (q) return arr.filter((x) =>
      (x.title || '').toLowerCase().includes(q) ||
      x.entry.blogNumber.toLowerCase().includes(q) ||
      (x.keywords || '').toLowerCase().includes(q) ||
      (x.entry.slug || '').toLowerCase().includes(q),
    );
    return arr;
  }, [merged, sort, sortAsc, search]);

  const brandName = (brandId: string) => brands.find((b) => b.id === brandId)?.name || brandId;

  const toggleSort = (key: typeof sort) => {
    if (sort === key) setSortAsc(!sortAsc);
    else { setSort(key); setSortAsc(true); }
  };

  const SortBtn: React.FC<{ label: string; k: typeof sort }> = ({ label, k }) => (
    <button
      onClick={() => toggleSort(k)}
      className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition ${
        sort === k ? 'text-emerald-700' : 'text-slate-400 hover:text-slate-600'
      }`}
    >
      {label}
      <ArrowUpDown className="w-3 h-3" />
    </button>
  );

  // Two-step delete: first click arms the row, second click confirms.
  const handleDelete = async (row: { entry: BlogRegisterEntry; item?: ContentItem }) => {
    if (armId !== row.entry.id) { setArmId(row.entry.id); setError(null); return; }
    setArmId(null);
    setBusyId(row.entry.id);
    setError(null);
    try {
      const res = row.item
        ? await onDeleteItem(row.item)
        : await onDeleteEntry(row.entry.id);
      if (!res.success) setError(res.message || 'Delete failed.');
    } catch (err: any) {
      setError(err?.message || 'Delete failed.');
    } finally {
      setBusyId(null);
    }
  };

  // ── Multiselect helpers ───────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = sorted.length > 0 && sorted.every((r) => next.has(r.entry.id));
      if (allSelected) sorted.forEach((r) => next.delete(r.entry.id));
      else sorted.forEach((r) => next.add(r.entry.id));
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Selected rows that are currently visible under the active search/sort.
  const visibleSelected = useMemo(
    () => sorted.filter((r) => selectedIds.has(r.entry.id)),
    [sorted, selectedIds],
  );

  // Bulk delete: items with a content post also trash their WordPress post
  // (recoverable); orphaned register entries are removed directly. Failures
  // are isolated per row and reported in a summary.
  const handleBulkDelete = async () => {
    const sel = visibleSelected;
    if (sel.length === 0) return;
    if (!window.confirm(`Delete ${sel.length} selected register entr${sel.length > 1 ? 'ies' : 'y'}? Entries linked to a post also trash its WordPress post (recoverable).`)) return;
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    let ok = 0;
    let failed = 0;
    for (const row of sel) {
      try {
        const res = row.item ? await onDeleteItem(row.item) : await onDeleteEntry(row.entry.id);
        if (res.success) ok += 1;
        else failed += 1;
      } catch { failed += 1; }
    }
    setBulkBusy(false);
    if (failed) setError(`Deleted ${ok} entr${ok !== 1 ? 'ies' : 'y'}, ${failed} failed.`);
    else setNotice(`Deleted ${ok} register entr${ok !== 1 ? 'ies' : 'y'}.`);
    clearSelection();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2">
            <Hash className="w-4 h-4 text-emerald-600" /> Blog Register
          </h2>
          <p className="text-[12px] text-slate-500 mt-1">
            Every blog's permanent reference number, keywords, dates and live link — kept in sync with
            the published article so the number on the page always matches the records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Brand</span>
          <BrandSwitcher
            brands={brands}
            selectedBrandId={selectedBrandId}
            onSelectBrand={onSelectBrand}
            size="sm"
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, title, keyword, slug…"
          className="w-full text-[12px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200"
        />
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-[12px] font-semibold text-red-700">
          {error}
        </div>
      )}

      {notice && (
        <div className="px-4 py-2.5 rounded-xl border border-emerald-200 bg-emerald-50 text-[12px] font-semibold text-emerald-700">
          {notice}
        </div>
      )}

      {/* Bulk actions bar (multiselect) */}
      {visibleSelected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 bg-emerald-50/60 border border-emerald-200 rounded-2xl px-4 py-3">
          <span className="text-[12px] font-bold text-emerald-700">
            {visibleSelected.length} selected
          </span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => void handleBulkDelete()}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-600 hover:bg-red-700 text-white transition disabled:opacity-40"
              title="Delete the selected register entries (linked posts go to WordPress trash)"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button
              onClick={clearSelection}
              disabled={bulkBusy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 transition disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="px-4 py-2.5 w-10">
                  {sorted.length > 0 && (
                    <label className="inline-flex items-center cursor-pointer select-none" title="Select / deselect all visible entries">
                      <input
                        type="checkbox"
                        checked={sorted.length > 0 && sorted.every((r) => selectedIds.has(r.entry.id))}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </label>
                  )}
                </th>
                <th className="px-4 py-2.5"><SortBtn label="Blog No." k="number" /></th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Title</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Keywords</th>
                <th className="px-4 py-2.5"><SortBtn label="Created" k="created" /></th>
                <th className="px-4 py-2.5"><SortBtn label="Published" k="published" /></th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Refreshed</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Link</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center">
                    <p className="text-[13px] font-semibold text-slate-500">No register entries yet.</p>
                    <p className="text-[12px] text-slate-400 mt-1">
                      Blog numbers are assigned automatically when posts are created and published.
                    </p>
                  </td>
                </tr>
              ) : (
                sorted.map(({ entry, item, title, keywords, status, liveUrl, wpPostId }) => (
                  <tr key={entry.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition">
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center cursor-pointer select-none" title="Select for bulk actions">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(entry.id)}
                          onChange={() => toggleSelect(entry.id)}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                      </label>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 font-mono text-[12px] font-bold">
                        <Hash className="w-3 h-3" /> {entry.blogNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[240px]">
                      <button
                        onClick={() => item && onEditItem(item)}
                        className="text-[13px] font-semibold text-slate-800 hover:text-emerald-700 hover:underline text-left line-clamp-1"
                        title={title}
                      >
                        {title}
                      </button>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                        {brandName(entry.brandId)} · {entry.contentType}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <div className="flex items-center gap-1 text-[11px] text-slate-500">
                        <Tag className="w-3 h-3 text-slate-300 shrink-0" />
                        <span className="truncate">{keywords || '—'}</span>
                      </div>
                      {entry.secondaryKeywords?.length > 0 && (
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                          {entry.secondaryKeywords.slice(0, 3).join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1" title={entry.dateCreated ? new Date(entry.dateCreated).toLocaleString('en-GB') : undefined}>
                        <Calendar className="w-3 h-3 text-slate-300" /> {fmtDateTime(entry.dateCreated)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1" title={entry.datePublished ? new Date(entry.datePublished).toLocaleString('en-GB') : undefined}>
                        <Calendar className="w-3 h-3 text-slate-300" /> {fmtDateTime(entry.datePublished)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                      {entry.repurposeCount ? (
                        <span className="inline-flex items-center gap-1" title={`Refreshed ${entry.repurposeCount} time(s); last ${fmtDate(entry.lastRefreshedAt)}`}>
                          <RefreshCw className="w-3 h-3 text-amber-400" />
                          {fmtDate(entry.lastRefreshedAt)}
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5">{entry.repurposeCount}×</span>
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${statusChip[status] || 'bg-slate-100 text-slate-600'}`}>
                        <FileText className="w-3 h-3" /> {status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {liveUrl ? (
                        <a
                          href={liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 hover:underline"
                        >
                          <Globe className="w-3 h-3" /> View {wpPostId ? `#${wpPostId}` : ''}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => item && onEditItem(item)}
                          disabled={!item || busyId === entry.id}
                          title={item ? 'Open in ZenEditor' : 'No content item to edit (orphaned register entry)'}
                          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {armId === entry.id ? (
                          <span className="inline-flex items-center gap-1">
                            <button
                              onClick={() => handleDelete({ entry, item })}
                              disabled={busyId === entry.id}
                              className="p-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
                              title="Confirm delete"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setArmId(null)}
                              disabled={busyId === entry.id}
                              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition disabled:opacity-50"
                              title="Cancel"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => handleDelete({ entry, item })}
                            disabled={busyId === entry.id}
                            title={item ? 'Delete item + register entry (trashes WordPress post)' : 'Delete register entry'}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-300 hover:bg-red-50 transition disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {busyId === entry.id ? (
                              <span className="block w-3.5 h-3.5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400">
        {sorted.length} entr{sorted.length === 1 ? 'y' : 'ies'} in the register
        {brandScoped ? ` for ${brandName(selectedBrandId)}` : ' across all brands'}.
      </p>
    </div>
  );
};
