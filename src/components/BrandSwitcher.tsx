import React, { useEffect, useRef, useState } from 'react';
import { Brand } from '../types';
import { Check, ChevronDown, Globe, Layers } from 'lucide-react';

interface BrandSwitcherProps {
  brands: Brand[];
  selectedBrandId: string;
  onSelectBrand: (id: string) => void;
  /** Include an "All Brands" option at the top (default true). */
  showAll?: boolean;
  /** Label for the "All Brands" option, e.g. "All Brands Properties (66)". */
  allLabel?: string;
  /** Compact variant for in-page toolbars. */
  size?: 'sm' | 'md';
  /** Dropdown alignment relative to the trigger. */
  align?: 'left' | 'right';
}

/**
 * Unified brand switcher — the single, consistent way to switch the active
 * brand on every screen. Shows the brand's color dot + name (+ WP domain),
 * and opens a dropdown with all brands and an optional "All Brands" entry.
 * Closes on outside click or Escape.
 */
export const BrandSwitcher: React.FC<BrandSwitcherProps> = ({
  brands,
  selectedBrandId,
  onSelectBrand,
  showAll = true,
  allLabel,
  size = 'md',
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = brands.find((b) => b.id === selectedBrandId) || null;
  const isAll = selectedBrandId === 'all' || !current;
  const bc = current?.primaryColor || '#4f46e5';

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    onSelectBrand(id);
    setOpen(false);
  };

  const sm = size === 'sm';

  return (
    <div ref={rootRef} className="relative shrink-0">
      {/* Trigger */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch active brand"
        className={`flex items-center gap-2 rounded-xl border border-slate-200/70 bg-white shadow-sm transition hover:bg-slate-50 ${
          sm ? 'px-2.5 py-1.5' : 'px-3 py-2'
        }`}
      >
        {isAll ? (
          <span className="w-3 h-3 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shrink-0" />
        ) : (
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: bc }} />
        )}
        <span className={`font-bold text-slate-800 truncate ${sm ? 'text-[12px] max-w-[110px]' : 'text-[13px] max-w-[150px]'}`}>
          {isAll ? (allLabel || 'All Brands') : current?.name}
        </span>
        {!isAll && (
          <span className={`hidden md:inline text-[10px] text-slate-400 truncate ${sm ? 'max-w-[90px]' : 'max-w-[130px]'}`}>
            {current?.wpUrl?.replace(/^https?:\/\//, '')}
          </span>
        )}
        <ChevronDown className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${sm ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white shadow-xl py-1.5 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {showAll && (
            <button
              role="option"
              aria-selected={isAll}
              onClick={() => pick('all')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-slate-50 ${
                isAll ? 'bg-indigo-50/60' : ''
              }`}
            >
              <span className="w-4 h-4 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shrink-0" />
              <span className={`flex-1 text-[13px] font-bold ${isAll ? 'text-indigo-700' : 'text-slate-700'}`}>
                {allLabel || 'All Brands'}
              </span>
              {isAll && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
            </button>
          )}
          {showAll && <div className="mx-3 my-1 border-t border-slate-100" />}
          {brands.map((b) => {
            const active = b.id === selectedBrandId;
            return (
              <button
                key={b.id}
                role="option"
                aria-selected={active}
                onClick={() => pick(b.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition hover:bg-slate-50 ${
                  active ? 'bg-indigo-50/60' : ''
                }`}
              >
                <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: b.primaryColor || '#4f46e5' }} />
                <span className="flex-1 min-w-0">
                  <span className={`block text-[13px] font-bold truncate ${active ? 'text-indigo-700' : 'text-slate-700'}`}>
                    {b.name}
                  </span>
                  {b.wpUrl && (
                    <span className="block text-[10px] text-slate-400 truncate">
                      {b.wpUrl.replace(/^https?:\/\//, '')}
                    </span>
                  )}
                </span>
                {active && <Check className="w-4 h-4 text-indigo-600 shrink-0" />}
              </button>
            );
          })}
          {brands.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-slate-400 flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" /> No brands yet
            </div>
          )}
          {brands.length > 0 && (
            <div className="mx-3 my-1 border-t border-slate-100" />
          )}
          <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
            <Layers className="w-3 h-3" /> Active brand applies to every screen
          </div>
        </div>
      )}
    </div>
  );
};