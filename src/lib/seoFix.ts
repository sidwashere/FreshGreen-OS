import type { AiModelPref, Brand, ContentItem, VisualBlock } from '../types';
import { fetchGlobalKeys, fetchAiPref } from './keys';
import { countWords } from './wpSync';

/**
 * One-click "Fix with AI" pipeline, shared by the Content Hub and the SEO tab.
 *
 * 1. Runs the same on-page audit as the SEO tab (/api/seo/analyze) and collects
 *    every failing ("poor") and improvable ("ok") check.
 * 2. Fixes metadata deterministically using known best practices — no AI call
 *    needed for things that are pure heuristics:
 *      - focus keyphrase derived from the title when missing
 *      - meta title rebuilt keyword-first, 50–60 chars, brand suffix
 *      - meta description written from the opening copy, 120–160 chars
 *      - slug generated from the title when missing
 * 3. Rewrites the article body with AI (/api/seo/improve, mode 'fix-failures')
 *    so the listed checks are addressed as much as possible, then humanises the
 *    result (Patina) so it reads naturally before you re-test and publish.
 * 4. Re-runs the audit and reports the before/after score.
 */

export interface SeoFixInput {
  title: string;
  contentType?: string;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  bodyHtml?: string;
  targetWordCount?: number;
  featuredImageUrl?: string;
  brand?: Brand | null;
  siteUrl?: string;
  modelPref?: AiModelPref;
  /** Run the humanisation pass after the AI rewrite. Default true. */
  humanize?: boolean;
}

export interface SeoFixResult {
  ok: boolean;
  message: string;
  /** Apply these fields to the item to persist the fix. */
  patch: Partial<ContentItem>;
  before: { pct: number | null; poor: number; ok: number };
  after: { pct: number | null; poor: number; ok: number };
  /** Human-readable list of what was fixed, for the success notice. */
  fixed: string[];
  humanized: boolean;
  provider?: string;
  model?: string;
  fallback?: boolean;
}

const INTENT_BY_CONTENT_TYPE: Record<string, string> = {
  page: 'commercial',
  landing: 'commercial',
  product: 'transactional',
  article: 'informational',
  blog: 'informational',
};

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on',
  'or', 'the', 'to', 'with', 'your', 'you', 'it', 'is', 'that', 'this',
]);

function capitalize(value: string): string {
  const v = value.trim();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : v;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-practice keyphrase derivation from a title: drop filler prefixes
 * ("The Ultimate Guide to …", "How to …"), keep the first few meaningful
 * words, trim trailing stopwords.
 */
export function deriveKeyphrase(title: string): string {
  const t = title.trim().replace(/[.,!?;:]+$/g, '');
  if (!t) return '';
  let core = t
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^(ultimate|complete|definitive|essential|simple|quick|easy|best|top)?\s*(guide|guides|how[- ]to|tips|ideas|ways|secrets|steps|mistakes|facts)?\s+(to|for|on)\s+/i, '')
    .replace(/^how[- ]to\s+/i, '')
    .trim();
  if (!core) core = t.replace(/^(the|a|an)\s+/i, '');
  const words = core.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  while (words.length > 1 && STOPWORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** Best-practice brand suffix for a meta title tag. */
function brandSuffix(brand?: Brand | null, siteUrl?: string): string {
  if (brand?.name && brand.name.length <= 30) return brand.name;
  const url = normalizeUrl(siteUrl);
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    } catch {
      /* fall through */
    }
  }
  return '';
}

/** Keyword-first meta title, 50–60 chars, brand suffix only if it fits. */
export function buildMetaTitle(title: string, keyword: string, brand?: Brand | null, siteUrl?: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  const suffix = brandSuffix(brand, siteUrl);
  const compose = (base: string) =>
    suffix && !base.toLowerCase().includes(suffix.toLowerCase()) ? `${base} | ${suffix}` : base;

  if (!keyword) {
    // No keyphrase: base the tag on the article title itself and extend it
    // until it reaches 50+ chars where possible.
    let base = capitalize(words.slice(0, 6).join(' '));
    let n = 6;
    let full = compose(base);
    while (full.length < 50 && n < words.length) {
      n++;
      base = capitalize(words.slice(0, n).join(' '));
      full = compose(base);
    }
    return full.length > 60 ? `${full.slice(0, 57).replace(/\s+\S*$/, '')}…` : full.slice(0, 60);
  }

  let base = capitalize(keyword);
  let full = compose(base);
  if (full.length > 60) {
    const budget = Math.max(20, 60 - (suffix ? suffix.length + 3 : 0));
    base = base.slice(0, budget - 1).replace(/\s+\S*$/, '');
    full = compose(base);
  }
  return full.length > 60 ? `${full.slice(0, 57).replace(/\s+\S*$/, '')}…` : full.slice(0, 60);
}

/** Keyword-inclusive meta description, 120–160 chars, from the opening copy. */
export function buildMetaDescription(keyword: string, bodyText: string): string {
  const sentences = bodyText
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  let base = '';
  if (keyword) {
    base = sentences.find((s) => s.toLowerCase().includes(keyword.toLowerCase())) || '';
  }
  base = base || sentences[0] || '';
  base = base.replace(/\s+/g, ' ').trim();
  if (!base && keyword) {
    base = `Everything you need to know about ${keyword} — practical, expert-backed guidance from ${capitalize(keyword.split(' ')[0])} specialists.`;
  }
  if (base.length > 160) {
    base = `${base.slice(0, 157).replace(/\s+\S*$/, '')}…`;
  } else if (base.length < 120 && keyword && !base.toLowerCase().startsWith(keyword.toLowerCase())) {
    base = `${capitalize(keyword)}: ${base}`;
    if (base.length > 160) base = `${base.slice(0, 157).replace(/\s+\S*$/, '')}…`;
  }
  return base;
}

/** Normalise server-derived blocks into editor-ready VisualBlocks (ids + defaults). */
export function normalizeBlocks(raw: any[]): VisualBlock[] {
  return (raw || []).map((b, idx) => ({
    id: `block-seo-${idx}-${Date.now()}`,
    type: (b.type as VisualBlock['type']) || 'paragraph',
    title: b.title || '',
    content: b.content || '',
    subtitle: b.subtitle || '',
    buttonText: b.buttonText || '',
    buttonUrl: b.buttonUrl || '#',
    badge: b.badge || '',
    keywords: b.keywords || '',
    imageUrl: b.imageUrl || '',
    imageAlt: b.imageAlt || '',
    imageCaption: b.imageCaption || '',
    imageLayout: (['full', 'left', 'right', 'center'] as const).includes(b.imageLayout as any)
      ? (b.imageLayout as VisualBlock['imageLayout'])
      : 'full',
  }));
}

async function analyze(
  payload: Record<string, unknown>,
): Promise<{ pct: number | null; poor: number; ok: number; results: any[] }> {
  const res = await fetch('/api/seo/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.success) throw new Error(typeof json.error === 'string' ? json.error : 'Analysis failed');
  const d = json.data;
  return {
    pct: typeof d.pct === 'number' ? d.pct : null,
    poor: d.summary?.poor || 0,
    ok: d.summary?.ok || 0,
    results: Array.isArray(d.results) ? d.results : [],
  };
}

export async function runSeoFix(input: SeoFixInput): Promise<SeoFixResult> {
  const byokKeys = await fetchGlobalKeys();
  const modelPref = input.modelPref || fetchAiPref();
  const humanize = input.humanize !== false;
  const fixed: string[] = [];
  const patch: Partial<ContentItem> = {};
  const siteUrl = normalizeUrl(input.siteUrl);
  const brand = input.brand || null;

  const bodyHtml = input.bodyHtml || '';
  const bodyText = stripHtml(bodyHtml);
  const wordCount = countWords(bodyHtml);

  // ---- 1. Focus keyphrase (deterministic, best practice) ----
  const kw = (input.primaryKeyword || '').trim() || deriveKeyphrase(input.title);
  if (!(input.primaryKeyword || '').trim() && kw) {
    patch.primaryKeyword = kw;
    fixed.push(`focus keyphrase “${kw}”`);
  }

  // ---- 2. Meta title (keyword first, 50–60 chars) ----
  const curMt = (input.metaTitle || '').trim();
  if (!curMt || curMt.length < 50 || curMt.length > 60) {
    const mt = buildMetaTitle(input.title, patch.primaryKeyword || kw, brand, input.siteUrl);
    if (mt && mt !== curMt) {
      patch.metaTitle = mt;
      fixed.push(`meta title (${mt.length} chars, 50–60 target)`);
    }
  }

  // ---- 3. Meta description (120–160 chars) ----
  const curMd = (input.metaDescription || '').trim();
  if (!curMd || curMd.length < 120 || curMd.length > 160) {
    const md = buildMetaDescription(patch.primaryKeyword || kw, bodyText);
    if (md && md !== curMd) {
      patch.metaDescription = md;
      fixed.push(`meta description (${md.length} chars, 120–160 target)`);
    }
  }

  // ---- 4. Slug ----
  if (!(input.slug || '').trim()) {
    const s = slugify(input.title);
    if (s) {
      patch.slug = s;
      fixed.push(`slug /${s}`);
    }
  }

  // ---- 5. Audit the current state (before) ----
  const basePayload = {
    title: input.title,
    metaDescription: patch.metaDescription || input.metaDescription || '',
    focusKeyphrase: patch.primaryKeyword || kw || '',
    secondaryKeyphrases: input.secondaryKeywords || [],
    bodyHtml,
    slug: patch.slug || input.slug || '',
    expectedIntent: INTENT_BY_CONTENT_TYPE[input.contentType || ''] || 'informational',
    siteUrl,
    canonicalUrl: siteUrl ? `${siteUrl.replace(/\/+$/, '')}/${patch.slug || input.slug || slugify(input.title)}` : undefined,
    images: input.featuredImageUrl
      ? [{ src: input.featuredImageUrl, alt: `${patch.primaryKeyword || kw || 'featured'} image` }]
      : [],
  };

  let before: SeoFixResult['before'] = { pct: null, poor: 0, ok: 0 };
  let issues: any[] = [];
  if (bodyText) {
    try {
      const a = await analyze(basePayload);
      before = { pct: a.pct, poor: a.poor, ok: a.ok };
      issues = a.results.filter((r) => r.status === 'poor' || r.status === 'ok');
    } catch (err: any) {
      console.warn('Pre-fix SEO analysis failed (continuing with metadata fixes):', err?.message);
    }
  }

  // ---- 6. AI body rewrite + humanisation ----
  let humanized = false;
  let provider: string | undefined;
  let model: string | undefined;
  let fallback: boolean | undefined;
  if (wordCount >= 50 && issues.length > 0) {
    try {
      const res = await fetch('/api/seo/improve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: input.title,
          bodyHtml,
          metaTitle: patch.metaTitle || input.metaTitle || '',
          metaDescription: patch.metaDescription || input.metaDescription || '',
          primaryKeyword: patch.primaryKeyword || kw || '',
          secondaryKeywords: input.secondaryKeywords || [],
          brand,
          applyHumanization: humanize,
          targetWordCount: input.targetWordCount || 900,
          mode: 'fix-failures',
          recommendations: issues.map((r) => ({ id: r.id, title: r.title, description: r.description })),
          options: { tone: 'warm, expert and approachable', readability: '6', densityTarget: '0.5-2.5%' },
          modelPref,
          byokKeys,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(typeof json.error === 'string' ? json.error : 'AI rewrite failed');
      if (json.data?.bodyHtml) {
        patch.bodyHtml = json.data.bodyHtml;
        const blocks = normalizeBlocks(json.data.blocks || []);
        if (blocks.length > 0) patch.blocks = blocks;
        const n = issues.length;
        fixed.push(
          humanize
            ? `body rewritten to fix ${n} check${n === 1 ? '' : 's'} and humanised`
            : `body rewritten to fix ${n} check${n === 1 ? '' : 's'}`,
        );
        humanized = !!humanize;
        provider = json.data.provider;
        model = json.data.model;
        fallback = !!json.data.fallback;
      } else {
        throw new Error('AI returned no content.');
      }
    } catch (err: any) {
      return {
        ok: false,
        message: `${err?.message || 'SEO fix failed'}${
          Object.keys(patch).length ? ' — metadata fixes applied anyway.' : ''
        }`,
        patch,
        before,
        after: before,
        fixed,
        humanized,
        provider,
        model,
        fallback,
      };
    }
  }

  // ---- 7. Re-audit (after) ----
  let after = before;
  if (bodyText || patch.bodyHtml) {
    try {
      const a = await analyze({
        ...basePayload,
        title: input.title,
        metaDescription: patch.metaDescription || input.metaDescription || '',
        focusKeyphrase: patch.primaryKeyword || kw || '',
        bodyHtml: patch.bodyHtml || bodyHtml,
        slug: patch.slug || input.slug || '',
      });
      after = { pct: a.pct, poor: a.poor, ok: a.ok };
    } catch (err: any) {
      console.warn('Post-fix SEO analysis failed:', err?.message);
    }
  }

  if (fixed.length === 0) {
    return {
      ok: true,
      message: 'Nothing to fix — title, keyphrase, meta and content already meet best-practice targets.',
      patch,
      before,
      after,
      fixed,
      humanized,
      provider,
      model,
      fallback,
    };
  }

  const delta =
    before.pct !== null && after.pct !== null
      ? `SEO score ${before.pct} → ${after.pct}`
      : after.pct !== null
        ? `SEO score ${after.pct}`
        : 'SEO score not available yet — write content first, then re-run.';
  const still =
    after.pct !== null && after.pct < 60
      ? ` · ${after.poor} check${after.poor === 1 ? '' : 's'} still need${after.poor === 1 ? 's' : ''} attention — review in the SEO tab`
      : '';
  return {
    ok: true,
    message: `${delta} · fixed: ${fixed.join(', ')}${humanized ? ' · humanised ✓' : ''}${still}`,
    patch,
    before,
    after,
    fixed,
    humanized,
    provider,
    model,
    fallback,
  };
}
