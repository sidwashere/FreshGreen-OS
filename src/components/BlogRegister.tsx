import React, { useMemo, useState } from 'react';
import { ContentItem, Brand } from '../types';
import { BlogRegisterEntry, resolveBrandCode } from '../lib/blogRegister';
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
} from 'lucide-react';

interface BlogRegisterProps {
  register: BlogRegisterEntry[];
  items: ContentItem[];
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
  onEditItem: (item: ContentItem) => void;
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

export const BlogRegister: React.FC<BlogRegisterProps> = ({
  register,
  items,
  brands,
  selectedBrandId,
  onSelectBrand,
  onEditItem,
}) => {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'number' | 'created' | 'published'>('number');
  const [sortAsc, setSortAsc] = useState(true);

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
          <select
            value={selectedBrandId}
            onChange={(e) => onSelectBrand(e.target.value)}
            className="text-[13px] font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
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

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60">
                <th className="px-4 py-2.5"><SortBtn label="Blog No." k="number" /></th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Title</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Keywords</th>
                <th className="px-4 py-2.5"><SortBtn label="Created" k="created" /></th>
                <th className="px-4 py-2.5"><SortBtn label="Published" k="published" /></th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Refreshed</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Status</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Link</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center">
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
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-300" /> {fmtDate(entry.dateCreated)}</span>
                    </td>
                    <td className="px-4 py-3 text-[11px] text-slate-500 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3 text-slate-300" /> {fmtDate(entry.datePublished)}</span>
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
