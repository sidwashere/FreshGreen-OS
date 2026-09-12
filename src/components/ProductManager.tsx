import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package, Search, Plus, Pencil, Trash2, X, ChevronLeft, ChevronRight,
  Loader2, AlertTriangle, CheckCircle2, RefreshCw, FolderTree, Settings2, Trash
} from 'lucide-react';
import { BrandSwitcher } from './BrandSwitcher';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Brand { id: string; name: string; slug: string; wpUrl: string; wcConsumerKey?: string; wcConsumerSecret?: string; }

interface WCProduct {
  id: number; name: string; slug: string; status: string; type: string;
  permalink: string; description: string; short_description: string;
  price: string; regular_price: string; sale_price: string; on_sale: boolean;
  categories: { id: number; name: string; slug: string }[];
  images: { id: number; src: string; name: string; alt: string }[];
  attributes: { id: number; name: string; position: number; visible: boolean; variation: boolean; options: string[] }[];
  meta_data: { id: number; key: string; value: any }[];
  external_url: string; button_text: string; sku: string; stock_status: string;
  date_created: string; date_modified: string;
}

interface WCCategory { id: number; name: string; slug: string; parent: number; description: string; display: string; image: any; count: number; }
interface WCAttribute { id: number; name: string; slug: string; type: string; order_by: string; has_archives: boolean; }
interface WCTerm { id: number; name: string; slug: string; description: string; menu_order: number; count: number; }

type SubTab = 'products' | 'categories' | 'attributes';

// ─── API Helpers ──────────────────────────────────────────────────────────────

function wcParams(brand: Brand) {
  return { wpUrl: brand.wpUrl, key: brand.wcConsumerKey || '', secret: brand.wcConsumerSecret || '' };
}

async function api<T>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || `Request failed (${res.status})`);
  return data as T;
}

// ─── Shared UI Bits ───────────────────────────────────────────────────────────

const Badge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className={`inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 ${color}`}>{children}</span>
);

const Btn: React.FC<{
  size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  onClick?: () => void; disabled?: boolean; loading?: boolean;
  children: React.ReactNode; className?: string;
}> = ({ size = 'md', variant = 'secondary', onClick, disabled, loading, children, className = '' }) => {
  const base = 'inline-flex items-center gap-1.5 font-semibold rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm';
  const variants: Record<string, string> = {
    primary: 'bg-slate-900 text-white hover:bg-slate-800 shadow-sm',
    secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-sm',
    danger: 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 shadow-sm',
    ghost: 'text-slate-500 hover:text-slate-700 hover:bg-slate-100',
  };
  return (
    <button className={`${base} ${sizes} ${variants[variant]} ${className}`} onClick={onClick} disabled={disabled || loading}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
};

const Input: React.FC<{
  label?: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; rows?: number;
  className?: string; disabled?: boolean; mono?: boolean;
}> = ({ label, value, onChange, placeholder, type = 'text', rows, className = '', disabled, mono }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>}
    {rows ? (
      <textarea
        className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 outline-none transition resize-y ${mono ? 'font-mono text-xs' : ''} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} disabled={disabled}
      />
    ) : (
      <input
        type={type}
        className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 outline-none transition ${mono ? 'font-mono text-xs' : ''} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      />
    )}
  </div>
);

const Select: React.FC<{
  label?: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string;
}> = ({ label, value, onChange, options, className = '' }) => (
  <div className={className}>
    {label && <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>}
    <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 outline-none transition" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; title: string; desc: string; action?: React.ReactNode }> = ({ icon, title, desc, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-4">{icon}</div>
    <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
    <p className="text-xs text-slate-500 mt-1 max-w-xs">{desc}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ─── Delete Confirmation Modal ────────────────────────────────────────────────

const DeleteModal: React.FC<{
  name: string; type: string; deleting: boolean;
  onConfirm: () => void; onCancel: () => void;
}> = ({ name, type, deleting, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
    <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center"><Trash2 className="w-5 h-5 text-red-600" /></div>
        <div><h3 className="font-bold text-slate-900">Delete {type}</h3><p className="text-xs text-slate-500">This cannot be undone</p></div>
      </div>
      <p className="text-sm text-slate-600 mb-5">Are you sure you want to delete <strong>{name}</strong>?</p>
      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
        <Btn variant="danger" onClick={onConfirm} loading={deleting}><Trash2 className="w-3.5 h-3.5" /> Delete</Btn>
      </div>
    </div>
  </div>
);

// ─── Create Product Modal ─────────────────────────────────────────────────────

const CreateProductModal: React.FC<{
  categories: WCCategory[]; saving: boolean; error: string;
  onConfirm: (data: Partial<WCProduct>) => void; onCancel: () => void;
}> = ({ categories, saving, error, onConfirm, onCancel }) => {
  const [name, setName] = useState('');
  const [status, setStatus] = useState('draft');
  const [type, setType] = useState('simple');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [catId, setCatId] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 text-lg">New Product</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <Input label="Product name *" value={name} onChange={setName} placeholder="e.g. The Magic Forest" />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Status" value={status} onChange={setStatus} options={[{ value: 'draft', label: 'Draft' }, { value: 'publish', label: 'Published' }, { value: 'pending', label: 'Pending' }]} />
            <Select label="Type" value={type} onChange={setType} options={[{ value: 'simple', label: 'Simple' }, { value: 'variable', label: 'Variable' }, { value: 'external', label: 'External/Affiliate' }, { value: 'grouped', label: 'Grouped' }]} />
          </div>
          <Input label="Price (£)" value={price} onChange={setPrice} placeholder="0.00" type="number" />
          <Select label="Category" value={catId} onChange={setCatId} options={[{ value: '', label: '— None —' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]} />
          <Input label="Description" value={description} onChange={setDescription} rows={4} />
        </div>
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        <div className="flex gap-2 justify-end mt-6">
          <Btn variant="secondary" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={() => onConfirm({ name, status, type, regular_price: price, description, categories: catId ? [{ id: Number(catId), name: '', slug: '' }] : [] } as any)} disabled={!name.trim()} loading={saving}>
            <Plus className="w-4 h-4" /> Create Product
          </Btn>
        </div>
      </div>
    </div>
  );
};

// ─── Product Edit Panel ───────────────────────────────────────────────────────

const EditPanel: React.FC<{
  product: WCProduct; draft: Partial<WCProduct>; setDraft: (d: Partial<WCProduct>) => void;
  categories: WCCategory[]; saving: boolean; error: string;
  onSave: () => void; onClose: () => void;
  onAddAttr: () => void; onRemoveAttr: (i: number) => void;
  onAddOption: (ai: number) => void; onRemoveOption: (ai: number, oi: number) => void;
  onUpdateOption: (ai: number, oi: number, v: string) => void;
  onUpdateAttr: (ai: number, field: string, val: any) => void;
}> = ({ product, draft, setDraft, categories, saving, error, onSave, onClose, onAddAttr, onRemoveAttr, onAddOption, onRemoveOption, onUpdateOption, onUpdateAttr }) => {
  const updateField = (field: string, val: any) => setDraft({ ...draft, [field]: val });

  const toggleCategory = (catId: number) => {
    const current = draft.categories || [];
    const exists = current.some((c) => c.id === catId);
    if (exists) {
      setDraft({ ...draft, categories: current.filter((c) => c.id !== catId) });
    } else {
      const cat = categories.find((c) => c.id === catId);
      if (cat) setDraft({ ...draft, categories: [...current, { id: cat.id, name: cat.name, slug: cat.slug }] });
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-5 h-5" /></button>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Edit Product</h2>
            <p className="text-[10px] text-slate-400">#{product.id} · {product.type}</p>
          </div>
        </div>
        <a href={product.permalink} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">{product.permalink ? 'View live' : ''}</a>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        <Input label="Product Name" value={draft.name || ''} onChange={(v) => updateField('name', v)} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Status" value={draft.status || 'draft'} onChange={(v) => updateField('status', v)} options={[{ value: 'publish', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'pending', label: 'Pending' }, { value: 'trash', label: 'Trash' }]} />
          <Select label="Type" value={draft.type || 'simple'} onChange={(v) => updateField('type', v)} options={[{ value: 'simple', label: 'Simple' }, { value: 'variable', label: 'Variable' }, { value: 'external', label: 'External/Affiliate' }, { value: 'grouped', label: 'Grouped' }]} />
        </div>

        {/* Pricing */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Pricing</h3>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Regular Price (£)" value={draft.regular_price || ''} onChange={(v) => updateField('regular_price', v)} type="number" />
            <Input label="Sale Price (£)" value={draft.sale_price || ''} onChange={(v) => updateField('sale_price', v)} type="number" />
          </div>
          <Input label="SKU" value={draft.sku || ''} onChange={(v) => updateField('sku', v)} mono />
        </div>

        {/* External / Affiliate */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">External / Purchase Links</h3>
          <Input label="External URL" value={draft.external_url || ''} onChange={(v) => updateField('external_url', v)} placeholder="https://amazon.co.uk/..." />
          <Input label="Button Text" value={draft.button_text || ''} onChange={(v) => updateField('button_text', v)} placeholder="Buy on Amazon" />
          <p className="text-[10px] text-slate-400">Note: External URL &amp; Button Text only apply when Type is set to External/Affiliate. For purchase links on simple products (e.g. Kindle / Paperback / Hardback), use Custom Meta Fields instead.</p>
        </div>

        {/* Categories */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Categories</h3>
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const active = (draft.categories || []).some((dc) => dc.id === c.id);
              return (
                <button key={c.id} onClick={() => toggleCategory(c.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition font-medium ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {c.name} {active ? '✓' : ''}
                </button>
              );
            })}
          </div>
        </div>

        {/* Attributes */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Attributes</h3>
            <Btn size="sm" variant="ghost" onClick={onAddAttr}><Plus className="w-3 h-3" /> Add</Btn>
          </div>
          {(draft.attributes || []).length === 0 && <p className="text-xs text-slate-400">No attributes</p>}
          {(draft.attributes || []).map((attr, ai) => (
            <div key={ai} className="bg-white rounded-lg border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Input value={attr.name} onChange={(v) => onUpdateAttr(ai, 'name', v)} placeholder="Attribute name" className="flex-1" />
                <button onClick={() => onRemoveAttr(ai)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1 text-slate-500">
                  <input type="checkbox" checked={attr.visible} onChange={(e) => onUpdateAttr(ai, 'visible', e.target.checked)} className="rounded" /> Visible
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  <input type="checkbox" checked={attr.variation} onChange={(e) => onUpdateAttr(ai, 'variation', e.target.checked)} className="rounded" /> Variation
                </label>
              </div>
              <div className="space-y-1">
                {attr.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-1">
                    <input className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded-lg" value={opt} onChange={(e) => onUpdateOption(ai, oi, e.target.value)} placeholder="Option value" />
                    <button onClick={() => onRemoveOption(ai, oi)} className="text-slate-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <Btn size="sm" variant="ghost" onClick={() => onAddOption(ai)}><Plus className="w-3 h-3" /> Option</Btn>
              </div>
            </div>
          ))}
        </div>

        {/* Descriptions */}
        <div className="space-y-3">
          <Input label="Short Description" value={draft.short_description || ''} onChange={(v) => updateField('short_description', v)} rows={2} />
          <Input label="Full Description" value={draft.description || ''} onChange={(v) => updateField('description', v)} rows={6} />
        </div>

        {/* Images */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Images ({(draft.images || []).length})</h3>
          <div className="grid grid-cols-4 gap-2">
            {(draft.images || []).map((img, i) => (
              <div key={img.id || i} className="relative group">
                <img src={img.src} alt={img.alt || ''} className="w-full aspect-square object-cover rounded-lg border border-slate-200" />
                <button
                  onClick={() => {
                    const imgs = (draft.images || []).filter((_, ii) => ii !== i);
                    setDraft({ ...draft, images: imgs });
                  }}
                  className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Meta */}
        <div className="bg-slate-50 rounded-xl p-4 space-y-2">
          <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Custom Meta Fields</h3>
          {(draft.meta_data || []).map((m, i) => (
            <div key={i} className="grid grid-cols-5 gap-2">
              <input className="col-span-2 px-2 py-1 text-xs border border-slate-200 rounded-lg font-mono" value={m.key} readOnly />
              <input className="col-span-2 px-2 py-1 text-xs border border-slate-200 rounded-lg" value={String(m.value)} onChange={(e) => {
                const meta = [...(draft.meta_data || [])];
                meta[i] = { ...meta[i], value: e.target.value };
                setDraft({ ...draft, meta_data: meta });
              }} />
              <button onClick={() => {
                const meta = (draft.meta_data || []).filter((_, ii) => ii !== i);
                setDraft({ ...draft, meta_data: meta });
              }} className="text-slate-400 hover:text-red-500 flex items-center justify-center"><X className="w-3 h-3" /></button>
            </div>
          ))}
          <Btn size="sm" variant="ghost" onClick={() => {
            const meta = [...(draft.meta_data || []), { id: 0, key: '', value: '' }];
            setDraft({ ...draft, meta_data: meta });
          }}><Plus className="w-3 h-3" /> Add Meta</Btn>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3 text-[10px] text-slate-400">
          <div>Created: {product.date_created ? new Date(product.date_created).toLocaleString() : '—'}</div>
          <div>Modified: {product.date_modified ? new Date(product.date_modified).toLocaleString() : '—'}</div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
        {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
        <div className="flex gap-2 ml-auto">
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={onSave} loading={saving}><CheckCircle2 className="w-3.5 h-3.5" /> Save Changes</Btn>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface ProductManagerProps { brands: Brand[]; selectedBrandId: string; onSelectBrand: (id: string) => void; }

export const ProductManager: React.FC<ProductManagerProps> = ({ brands, selectedBrandId, onSelectBrand }) => {
  const activeBrand = useMemo(() => brands.find((b) => b.id === selectedBrandId) || brands[0], [brands, selectedBrandId]);
  const hasWcCreds = Boolean(activeBrand?.wcConsumerKey && activeBrand?.wcConsumerSecret);

  const [subTab, setSubTab] = useState<SubTab>('products');

  // Products
  const [products, setProducts] = useState<WCProduct[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productPage, setProductPage] = useState(1);
  const [productTotalPages, setProductTotalPages] = useState(1);
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);

  // Categories
  const [categories, setCategories] = useState<WCCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Partial<WCCategory> | null>(null);
  const [catSaving, setCatSaving] = useState(false);

  // Attributes
  const [attributes, setAttributes] = useState<WCAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [editingAttribute, setEditingAttribute] = useState<Partial<WCAttribute> | null>(null);
  const [attrSaving, setAttrSaving] = useState(false);
  const [expandedAttrId, setExpandedAttrId] = useState<number | null>(null);
  const [attrTerms, setAttrTerms] = useState<Record<number, WCTerm[]>>({});
  const [editingTerm, setEditingTerm] = useState<{ attrId: number; term: Partial<WCTerm> } | null>(null);
  const [termSaving, setTermSaving] = useState(false);

  // Product edit
  const [selectedProduct, setSelectedProduct] = useState<WCProduct | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<WCProduct>>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [showCreateProduct, setShowCreateProduct] = useState(false);

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: number; name: string; extraId?: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadProducts = useCallback(async () => {
    if (!activeBrand || !hasWcCreds) return;
    setProductsLoading(true);
    try {
      const p = wcParams(activeBrand);
      let qs = `/api/wc-mgmt/products?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}&per_page=50&page=${productPage}`;
      if (productSearch) qs += `&search=${encodeURIComponent(productSearch)}`;
      if (productCategoryFilter) qs += `&category=${encodeURIComponent(productCategoryFilter)}`;
      if (productStatusFilter) qs += `&status=${encodeURIComponent(productStatusFilter)}`;
      const res = await api<any>('GET', qs);
      setProducts(res.products || []);
      setProductTotal(res.total || 0);
      setProductTotalPages(res.totalPages || 1);
    } catch (err: any) {
      showToast(err.message || 'Failed to load products', false);
    } finally {
      setProductsLoading(false);
    }
  }, [activeBrand, hasWcCreds, productPage, productSearch, productCategoryFilter, productStatusFilter]);

  const loadCategories = useCallback(async () => {
    if (!activeBrand || !hasWcCreds) return;
    setCategoriesLoading(true);
    try {
      const p = wcParams(activeBrand);
      const res = await api<any>('GET', `/api/wc-mgmt/categories?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}`);
      setCategories(res.categories || []);
    } catch (err: any) { showToast(err.message, false); }
    finally { setCategoriesLoading(false); }
  }, [activeBrand, hasWcCreds]);

  const loadAttributes = useCallback(async () => {
    if (!activeBrand || !hasWcCreds) return;
    setAttributesLoading(true);
    try {
      const p = wcParams(activeBrand);
      const res = await api<any>('GET', `/api/wc-mgmt/attributes?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}`);
      setAttributes(res.attributes || []);
    } catch (err: any) { showToast(err.message, false); }
    finally { setAttributesLoading(false); }
  }, [activeBrand, hasWcCreds]);

  const loadAttrTerms = useCallback(async (attrId: number) => {
    if (!activeBrand || !hasWcCreds) return;
    try {
      const p = wcParams(activeBrand);
      const res = await api<any>('GET', `/api/wc-mgmt/attributes/${attrId}/terms?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}`);
      setAttrTerms((prev) => ({ ...prev, [attrId]: res.terms || [] }));
    } catch (err: any) { showToast(err.message, false); }
  }, [activeBrand, hasWcCreds]);

  useEffect(() => {
    if (hasWcCreds) {
      if (subTab === 'products') loadProducts();
      if (subTab === 'categories') loadCategories();
      if (subTab === 'attributes') loadAttributes();
    }
  }, [activeBrand?.id, subTab, hasWcCreds]);

  useEffect(() => { if (subTab === 'products' && hasWcCreds) loadProducts(); }, [productPage, productSearch, productCategoryFilter, productStatusFilter]);

  // ── Product CRUD ──────────────────────────────────────────────────────────

  const saveProduct = async () => {
    if (!activeBrand || !selectedProduct) return;
    setEditSaving(true); setEditError('');
    try {
      const p = wcParams(activeBrand);
      const payload: any = {
        ...p, name: editDraft.name, status: editDraft.status, type: editDraft.type,
        description: editDraft.description, short_description: editDraft.short_description,
        regular_price: editDraft.regular_price, sale_price: editDraft.sale_price || '',
        sku: editDraft.sku, external_url: editDraft.external_url, button_text: editDraft.button_text,
        categories: (editDraft.categories || []).map((c) => ({ id: c.id })),
        attributes: (editDraft.attributes || []).map((a) => ({
          id: a.id, name: a.name, position: a.position,
          visible: a.visible, variation: a.variation, options: a.options,
        })),
        images: (editDraft.images || []).map((img) => ({ id: img.id, src: img.src })),
        // WC merges meta_data by key — removed/cleared rows must be sent as value:null to actually delete them.
        meta_data: (() => {
          const draftMeta = (editDraft.meta_data || []).filter((m: any) => m.key && String(m.value).trim() !== '');
          const originalMeta = (selectedProduct.meta_data || []).filter((m: any) => m.key);
          const removed = originalMeta
            .filter((m: any) => !draftMeta.some((d: any) => d.key === m.key))
            .map((m: any) => ({ key: m.key, value: null }));
          return [...draftMeta.map((m: any) => ({ key: m.key, value: m.value })), ...removed];
        })(),
      };
      const res = await api<any>('PUT', `/api/wc-mgmt/products/${selectedProduct.id}`, payload);
      setSelectedProduct(res.product); setEditDraft(res.product);
      showToast('Product saved'); loadProducts();
    } catch (err: any) { setEditError(err.message || 'Save failed'); }
    finally { setEditSaving(false); }
  };

  const createProduct = async (data: Partial<WCProduct>) => {
    if (!activeBrand) return;
    setEditSaving(true); setEditError('');
    try {
      const p = wcParams(activeBrand);
      const res = await api<any>('POST', '/api/wc-mgmt/products', { ...p, ...data });
      setShowCreateProduct(false); setSelectedProduct(res.product); setEditDraft(res.product);
      showToast('Product created'); loadProducts();
    } catch (err: any) { setEditError(err.message || 'Create failed'); }
    finally { setEditSaving(false); }
  };

  const deleteItem = async () => {
    if (!activeBrand || !deleteConfirm) return;
    setDeleting(true);
    try {
      const p = wcParams(activeBrand);
      const base = `/api/wc-mgmt/${deleteConfirm.type === 'product' ? 'products' : deleteConfirm.type === 'category' ? 'categories' : 'attributes'}/${deleteConfirm.id}`;
      const qs = `?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}&force=true`;
      await api('DELETE', base + qs);
      if (deleteConfirm.type === 'product' && selectedProduct?.id === deleteConfirm.id) { setSelectedProduct(null); setEditDraft({}); }
      showToast(`${deleteConfirm.type} deleted`);
      if (deleteConfirm.type === 'product') loadProducts();
      if (deleteConfirm.type === 'category') loadCategories();
      if (deleteConfirm.type === 'attribute') loadAttributes();
    } catch (err: any) { showToast(err.message, false); }
    finally { setDeleting(false); setDeleteConfirm(null); }
  };

  // ── Attribute editing helpers ──────────────────────────────────────────────

  const updateAttrField = (ai: number, field: string, val: any) => {
    const attrs = [...(editDraft.attributes || [])];
    attrs[ai] = { ...attrs[ai], [field]: val };
    setEditDraft({ ...editDraft, attributes: attrs });
  };
  const updateOption = (ai: number, oi: number, v: string) => {
    const attrs = [...(editDraft.attributes || [])];
    const opts = [...attrs[ai].options]; opts[oi] = v;
    attrs[ai] = { ...attrs[ai], options: opts };
    setEditDraft({ ...editDraft, attributes: attrs });
  };
  const addOption = (ai: number) => {
    const attrs = [...(editDraft.attributes || [])];
    attrs[ai] = { ...attrs[ai], options: [...attrs[ai].options, ''] };
    setEditDraft({ ...editDraft, attributes: attrs });
  };
  const removeOption = (ai: number, oi: number) => {
    const attrs = [...(editDraft.attributes || [])];
    attrs[ai] = { ...attrs[ai], options: attrs[ai].options.filter((_, i) => i !== oi) };
    setEditDraft({ ...editDraft, attributes: attrs });
  };

  // ── Category / Attribute CRUD ─────────────────────────────────────────────

  const saveCategory = async () => {
    if (!activeBrand || !editingCategory) return;
    setCatSaving(true);
    try {
      const p = wcParams(activeBrand);
      const payload: any = { ...p, name: editingCategory.name, slug: editingCategory.slug, parent: editingCategory.parent || 0, description: editingCategory.description, display: editingCategory.display };
      if (editingCategory.id) await api('PUT', `/api/wc-mgmt/categories/${editingCategory.id}`, payload);
      else await api('POST', '/api/wc-mgmt/categories', payload);
      setEditingCategory(null); showToast(editingCategory.id ? 'Category updated' : 'Category created'); loadCategories();
    } catch (err: any) { showToast(err.message, false); }
    finally { setCatSaving(false); }
  };

  const saveAttribute = async () => {
    if (!activeBrand || !editingAttribute) return;
    setAttrSaving(true);
    try {
      const p = wcParams(activeBrand);
      const payload: any = { ...p, name: editingAttribute.name, slug: editingAttribute.slug, type: editingAttribute.type || 'select', order_by: editingAttribute.order_by || 'menu_order', has_archives: editingAttribute.has_archives || false };
      if (editingAttribute.id) await api('PUT', `/api/wc-mgmt/attributes/${editingAttribute.id}`, payload);
      else await api('POST', '/api/wc-mgmt/attributes', payload);
      setEditingAttribute(null); showToast(editingAttribute.id ? 'Attribute updated' : 'Attribute created'); loadAttributes();
    } catch (err: any) { showToast(err.message, false); }
    finally { setAttrSaving(false); }
  };

  const saveTerm = async () => {
    if (!activeBrand || !editingTerm) return;
    setTermSaving(true);
    try {
      const p = wcParams(activeBrand);
      const payload: any = { ...p, name: editingTerm.term.name, slug: editingTerm.term.slug, description: editingTerm.term.description, menu_order: editingTerm.term.menu_order || 0 };
      if (editingTerm.term.id) await api('PUT', `/api/wc-mgmt/attributes/${editingTerm.attrId}/terms/${editingTerm.term.id}`, payload);
      else await api('POST', `/api/wc-mgmt/attributes/${editingTerm.attrId}/terms`, payload);
      setEditingTerm(null); showToast(editingTerm.term.id ? 'Term updated' : 'Term created'); loadAttrTerms(editingTerm.attrId);
    } catch (err: any) { showToast(err.message, false); }
    finally { setTermSaving(false); }
  };

  // ── No credentials ────────────────────────────────────────────────────────

  if (!hasWcCreds) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center text-amber-600 mb-4"><AlertTriangle className="w-8 h-8" /></div>
        <h2 className="text-lg font-bold text-slate-800">WooCommerce credentials required</h2>
        <p className="text-sm text-slate-500 mt-2 max-w-md">
          <strong>{activeBrand?.name || 'No brand selected'}</strong> doesn't have WooCommerce REST API keys.
          Add them in Brand DNA & Vault.
        </p>
        <p className="text-xs text-slate-400 mt-3">WordPress admin → WooCommerce → Settings → Advanced → REST API</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col gap-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold ${toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center"><Package className="w-5 h-5 text-white" /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Product Manager</h1>
            <p className="text-xs text-slate-500">{activeBrand?.name} — {productTotal} products</p>
          </div>
        </div>
        <BrandSwitcher
          brands={brands}
          selectedBrandId={selectedBrandId}
          onSelectBrand={onSelectBrand}
          size="sm"
        />
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {([
          { id: 'products' as const, label: 'Products', icon: Package, count: productTotal },
          { id: 'categories' as const, label: 'Categories', icon: FolderTree, count: categories.length },
          { id: 'attributes' as const, label: 'Attributes', icon: Settings2, count: attributes.length },
        ]).map((tab) => (
          <button key={tab.id} onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition flex-1 justify-center ${subTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <tab.icon className="w-4 h-4" />{tab.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${subTab === tab.id ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-400'}`}>{tab.count}</span>
          </button>
        ))}
      </div>

      {/* ── PRODUCTS TAB ─────────────────────────────────────────────────── */}
      {subTab === 'products' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 outline-none"
                placeholder="Search products..." value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setProductPage(1); }} />
            </div>
            <Select value={productCategoryFilter} onChange={(v) => { setProductCategoryFilter(v); setProductPage(1); }}
              options={[{ value: '', label: 'All Categories' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]} className="w-44" />
            <Select value={productStatusFilter} onChange={(v) => { setProductStatusFilter(v); setProductPage(1); }}
              options={[{ value: '', label: 'All Status' }, { value: 'publish', label: 'Published' }, { value: 'draft', label: 'Draft' }, { value: 'pending', label: 'Pending' }, { value: 'trash', label: 'Trash' }]} className="w-36" />
            <Btn variant="ghost" onClick={loadProducts} loading={productsLoading}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Btn>
            <Btn variant="primary" onClick={() => setShowCreateProduct(true)}><Plus className="w-4 h-4" /> New Product</Btn>
          </div>

          <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-sm">
            {productsLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
            ) : products.length === 0 ? (
              <EmptyState icon={<Package className="w-6 h-6" />} title="No products found" desc="Create your first product or adjust filters." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 w-12"></th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Product</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Categories</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Price</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500">Stock</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className={`border-b border-slate-50 hover:bg-slate-50/80 cursor-pointer transition ${selectedProduct?.id === p.id ? 'bg-slate-50' : ''}`}
                      onClick={() => { setSelectedProduct(p); setEditDraft({ ...p }); setEditError(''); }}>
                      <td className="px-4 py-3">
                        {p.images?.[0]?.src ? <img src={p.images[0].src} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-100" />
                          : <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><Package className="w-5 h-5" /></div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-sm text-slate-800 truncate max-w-[200px]">{p.name}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">#{p.id} · {p.type}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.categories?.slice(0, 3).map((c) => <span key={c.id} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{c.name}</span>)}
                          {(p.categories?.length || 0) > 3 && <span className="text-[10px] text-slate-400">+{p.categories.length - 3}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-slate-800">£{p.price || p.regular_price || '—'}</span>
                        {p.on_sale && <Badge color="bg-red-50 text-red-600 ml-1">Sale</Badge>}
                      </td>
                      <td className="px-4 py-3"><Badge color={p.status === 'publish' ? 'bg-emerald-50 text-emerald-700' : p.status === 'draft' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}>{p.status}</Badge></td>
                      <td className="px-4 py-3"><Badge color={p.stock_status === 'instock' ? 'bg-emerald-50 text-emerald-700' : p.stock_status === 'outofstock' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-600'}>{p.stock_status || 'n/a'}</Badge></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                          <Btn size="sm" variant="ghost" onClick={() => { setSelectedProduct(p); setEditDraft({ ...p }); setEditError(''); }}><Pencil className="w-3 h-3" /></Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setDeleteConfirm({ type: 'product', id: p.id, name: p.name })}><Trash2 className="w-3 h-3 text-red-400" /></Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {productTotalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Page {productPage} of {productTotalPages} ({productTotal} total)</span>
              <div className="flex gap-1">
                <Btn size="sm" variant="secondary" onClick={() => setProductPage(Math.max(1, productPage - 1))} disabled={productPage <= 1}><ChevronLeft className="w-3 h-3" /> Prev</Btn>
                <Btn size="sm" variant="secondary" onClick={() => setProductPage(Math.min(productTotalPages, productPage + 1))} disabled={productPage >= productTotalPages}>Next <ChevronRight className="w-3 h-3" /></Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CATEGORIES TAB ───────────────────────────────────────────────── */}
      {subTab === 'categories' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">WooCommerce product categories</p>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={loadCategories} loading={categoriesLoading}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Btn>
              <Btn variant="primary" onClick={() => setEditingCategory({ name: '', slug: '', parent: 0, description: '', display: 'default' })}><Plus className="w-4 h-4" /> New Category</Btn>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-sm">
            {categoriesLoading ? <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
              : categories.length === 0 ? <EmptyState icon={<FolderTree className="w-6 h-6" />} title="No categories" desc="Create your first category." />
              : <div className="divide-y divide-slate-50">
                {categories.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/80 transition">
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{c.name}</div>
                      <div className="text-[10px] text-slate-400">#{c.id} · /{c.slug} · {c.count} products{c.parent > 0 ? ` · parent #${c.parent}` : ''}</div>
                    </div>
                    <div className="flex gap-1">
                      <Btn size="sm" variant="ghost" onClick={() => setEditingCategory(c)}><Pencil className="w-3 h-3" /></Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setDeleteConfirm({ type: 'category', id: c.id, name: c.name })}><Trash2 className="w-3 h-3 text-red-400" /></Btn>
                    </div>
                  </div>
                ))}
              </div>}
          </div>
        </div>
      )}

      {/* ── ATTRIBUTES TAB ───────────────────────────────────────────────── */}
      {subTab === 'attributes' && (
        <div className="flex-1 flex flex-col min-h-0 gap-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">WooCommerce product attributes and their terms</p>
            <div className="flex gap-2">
              <Btn variant="ghost" onClick={loadAttributes} loading={attributesLoading}><RefreshCw className="w-3.5 h-3.5" /> Refresh</Btn>
              <Btn variant="primary" onClick={() => setEditingAttribute({ name: '', slug: '', type: 'select', order_by: 'menu_order', has_archives: false })}><Plus className="w-4 h-4" /> New Attribute</Btn>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-sm">
            {attributesLoading ? <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
              : attributes.length === 0 ? <EmptyState icon={<Settings2 className="w-6 h-6" />} title="No attributes" desc="Create your first attribute." />
              : <div className="divide-y divide-slate-50">
                {attributes.map((a) => (
                  <div key={a.id}>
                    <div className="flex items-center justify-between px-5 py-3 hover:bg-slate-50/80 transition cursor-pointer"
                      onClick={() => { setExpandedAttrId(expandedAttrId === a.id ? null : a.id); if (expandedAttrId !== a.id && !attrTerms[a.id]) loadAttrTerms(a.id); }}>
                      <div>
                        <div className="font-semibold text-sm text-slate-800">{a.name}</div>
                        <div className="text-[10px] text-slate-400">#{a.id} · /{a.slug} · type: {a.type} · order: {a.order_by}</div>
                      </div>
                      <div className="flex gap-1 items-center" onClick={(e) => e.stopPropagation()}>
                        <Btn size="sm" variant="ghost" onClick={() => setEditingAttribute(a)}><Pencil className="w-3 h-3" /></Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setDeleteConfirm({ type: 'attribute', id: a.id, name: a.name })}><Trash2 className="w-3 h-3 text-red-400" /></Btn>
                      </div>
                    </div>
                    {expandedAttrId === a.id && (
                      <div className="px-5 pb-4 bg-slate-50/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-slate-600">Terms ({(attrTerms[a.id] || []).length})</span>
                          <Btn size="sm" variant="ghost" onClick={() => setEditingTerm({ attrId: a.id, term: { name: '', slug: '', description: '', menu_order: 0 } })}><Plus className="w-3 h-3" /> Add Term</Btn>
                        </div>
                        {(attrTerms[a.id] || []).length === 0 ? <p className="text-xs text-slate-400">No terms</p> : (
                          <div className="space-y-1">
                            {(attrTerms[a.id] || []).map((t) => (
                              <div key={t.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-slate-100">
                                <div><span className="text-sm font-medium text-slate-700">{t.name}</span> <span className="text-[10px] text-slate-400">/{t.slug} · {t.count} used</span></div>
                                <div className="flex gap-1">
                                  <Btn size="sm" variant="ghost" onClick={() => setEditingTerm({ attrId: a.id, term: t })}><Pencil className="w-3 h-3" /></Btn>
                                  <Btn size="sm" variant="ghost" onClick={() => setDeleteConfirm({ type: 'term', id: t.id, name: t.name, extraId: a.id })}><Trash2 className="w-3 h-3 text-red-400" /></Btn>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>}
          </div>
        </div>
      )}

      {/* ── MODALS ─────────────────────────────────────────────────────── */}

      {showCreateProduct && <CreateProductModal categories={categories} saving={editSaving} error={editError} onConfirm={createProduct} onCancel={() => setShowCreateProduct(false)} />}

      {selectedProduct && (
        <EditPanel product={selectedProduct} draft={editDraft} setDraft={setEditDraft} categories={categories} saving={editSaving} error={editError}
          onSave={saveProduct} onClose={() => { setSelectedProduct(null); setEditDraft({}); }}
          onAddAttr={() => { const a = [...(editDraft.attributes || [])]; a.push({ id: 0, name: '', position: a.length, visible: true, variation: false, options: [] }); setEditDraft({ ...editDraft, attributes: a }); }}
          onRemoveAttr={(i) => setEditDraft({ ...editDraft, attributes: (editDraft.attributes || []).filter((_, ii) => ii !== i) })}
          onAddOption={addOption} onRemoveOption={removeOption} onUpdateOption={updateOption} onUpdateAttr={updateAttrField} />
      )}

      {deleteConfirm && (
        <DeleteModal name={deleteConfirm.name} type={deleteConfirm.type} deleting={deleting} onConfirm={() => {
          if (deleteConfirm.type === 'term' && deleteConfirm.extraId) {
            (async () => {
              if (!activeBrand) return;
              setDeleting(true);
              try {
                const p = wcParams(activeBrand);
                await api('DELETE', `/api/wc-mgmt/attributes/${deleteConfirm.extraId}/terms/${deleteConfirm.id}?wpUrl=${encodeURIComponent(p.wpUrl)}&key=${encodeURIComponent(p.key)}&secret=${encodeURIComponent(p.secret)}&force=true`);
                showToast('Term deleted'); loadAttrTerms(deleteConfirm.extraId);
              } catch (err: any) { showToast(err.message, false); }
              finally { setDeleting(false); setDeleteConfirm(null); }
            })();
          } else {
            deleteItem();
          }
        }} onCancel={() => setDeleteConfirm(null)} />
      )}
    </div>
  );
};

export default ProductManager;
