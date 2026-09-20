/**
 * Shared WordPress sync logic — single source of truth for the ZenEditor and
 * the Content Hub. Everything here mirrors what the editor's Publish tab does
 * so the hub never forks the sync/publish behaviour.
 */
import { Brand, ContentItem, PipelineStatus } from '../types';
import { ArticleFrameMeta, blocksToHtml, rebuildArticleHtml, syncImageMarkers } from './blogHtml';
import { fetchGlobalKeys } from './keys';

export type WpState = 'live' | 'draft' | 'none';

/** Rough word count for HTML text (client-side counter, same as the editor). */
export const countWords = (text: string = '') =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;

/**
 * What the post currently is ON WORDPRESS, derived from the last sync:
 *  - 'live':  synced and published — visitors can see it
 *  - 'draft': synced as a draft — hidden on the site
 *  - 'none':  never synced to WordPress yet
 */
export const deriveWpState = (item?: ContentItem | null): WpState => {
  if (!item || !item.wpPostId) return 'none';
  return item.status === 'Published' ? 'live' : 'draft';
};

/**
 * Re-serialise the article body right before a sync so WordPress always
 * receives the current blocks, brand-styled and intact — regardless of what
 * the HTML-tab Quill sanitizer did to the working copy:
 *  - items with any structured component (hero/faq/cards/quote/CTA/
 *    carousel/image) or an fg-art region are REGENERATED from blocks;
 *  - plain-paragraph or free-form HTML items keep their HTML untouched
 *    (marker region re-rendered only when present).
 * Image markers are stripped from the payload: WordPress wpautop wraps bare
 * HTML comments in <p> tags, which renders as vertical gaps around images.
 * Optional `meta` adds the article frame (byline/date, share buttons, author
 * box, footer CTA, related strip) to the regenerated body.
 */
export function prepareWpBody(item: ContentItem, brand?: Brand | null, meta?: ArticleFrameMeta): string {
  const blocks = item.blocks || [];
  const hasStyledRegion = /<!--fg-art:start-->[\s\S]*<!--fg-art:end-->/.test(item.bodyHtml || '');
  // Precedence:
  //  1. blocks render something   -> regenerate the full branded article
  //     (never fall back to pushing raw unstyled AI HTML);
  //  2. no renderable blocks but a styled region exists -> keep the stored
  //     styled HTML untouched (items like #4475 are block-free yet already
  //     fully branded — regenerating would wipe them);
  //  3. otherwise -> non-destructive pass-through of the stored HTML.
  const styled = blocksToHtml(blocks, brand, meta);
  const rebuilt = styled
    ? styled
    : hasStyledRegion
      ? (item.bodyHtml || '')
      : rebuildArticleHtml(item.bodyHtml || '', blocks, brand);
  return syncImageMarkers(blocks, rebuilt).replace(/<!--\/?image:[^>]*-->/g, '');
}

export interface WpSyncResult {
  ok: boolean;
  message: string;
  updated?: ContentItem;
}

/**
 * Build the article-frame meta for a push: share URL parts, byline/date and
 * the "related posts" strip (fetched live from WordPress, newest first,
 * excluding the current post). Any hiccup degrades gracefully — the article
 * still pushes, just without that piece of the frame.
 */
async function buildFrameMeta(
  brand: Brand | undefined | null,
  item: ContentItem,
): Promise<ArticleFrameMeta | undefined> {
  if (!brand) return undefined;
  const meta: ArticleFrameMeta = {
    title: item.title,
    siteUrl: brand.wpUrl,
    slug: item.slug,
    brandName: brand.name,
    date: item.createdAt,
  };
  if (brand.name) meta.author = `The ${brand.name} Team`;
  try {
    const res = await fetch('/api/wp/list-posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, excludeSlug: item.slug }),
    });
    const data = await res.json();
    const related = (data?.posts || []).filter((p: any) => p && p.url && p.title).slice(0, 3);
    if (related.length) meta.related = related;
  } catch (relErr: any) {
    console.warn('[wpSync] related-posts fetch skipped:', String(relErr?.message || relErr).slice(0, 160));
  }
  return meta;
}

/** A product CTA URL that still points at a placeholder (no real product). */
const isPlaceholderUrl = (u?: string) =>
  !u || /^(#|#\w*|\/shop\/?|\/products?\/?)$/i.test(String(u).trim());

/** Decode WooCommerce HTML entities (e.g. "Daniel&#8217;s" -> "Daniel's"). */
const decodeEntities = (s: string) => {
  if (typeof document !== 'undefined') {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
};

/**
 * Auto-fill product CTA links at publish time: any product_cta block still
 * pointing at a placeholder URL gets a real WooCommerce product link (matched
 * by name when possible, else the first product), plus the product image when
 * the block has none. Runs right before the body is serialised, so every
 * pushed article ships with working product suggestions instead of "#".
 */
async function autofillProductLinks(
  brand: Brand | undefined | null,
  item: ContentItem,
): Promise<ContentItem> {
  const blocks = item.blocks || [];
  const needsFill = blocks.some((b) => b.type === 'product_cta' && isPlaceholderUrl(b.buttonUrl));
  if (!needsFill || !brand?.wpUrl) return item;
  try {
    const res = await fetch(`/api/wp/products?wpUrl=${encodeURIComponent(brand.wpUrl)}`);
    const data = await res.json();
    const products: Array<{ name: string; permalink: string; image?: string }> = data?.products || [];
    if (!products.length) return item;
    const patched = blocks.map((b) => {
      if (b.type !== 'product_cta' || !isPlaceholderUrl(b.buttonUrl)) return b;
      const title = String(b.title || '').toLowerCase().trim();
      const match = title
        ? products.find((p) => {
            const pn = decodeEntities(String(p.name || '')).toLowerCase();
            return pn.includes(title) || title.includes(pn);
          })
        : undefined;
      const pick = match || products[0];
      return {
        ...b,
        title: b.title || decodeEntities(pick.name),
        imageUrl: b.imageUrl || pick.image || '',
        buttonText: b.buttonText || 'View Product',
        buttonUrl: pick.permalink || b.buttonUrl,
      };
    });
    return { ...item, blocks: patched };
  } catch (err: any) {
    console.warn('[wpSync] product autofill skipped:', String(err?.message || err).slice(0, 140));
    return item;
  }
}

/** Push an item to WordPress as LIVE ('publish') or a hidden draft ('draft'). */
export async function syncItemToWp(
  brand: Brand | undefined | null,
  item: ContentItem,
  statusTarget: 'publish' | 'draft',
): Promise<WpSyncResult> {
  try {
    // Fill placeholder product links with real shop products BEFORE the body
    // is serialised, so the pushed HTML carries working product suggestions.
    const itemWithProducts = await autofillProductLinks(brand, item);
    const frameMeta = await buildFrameMeta(brand, itemWithProducts);
    // Send the user's BYOK keys so sync-time image generation (the 2-image
    // guarantee) uses their PAID Nano Banana / OpenRouter keys, not the
    // server env key alone.
    const byokKeys = await fetchGlobalKeys().catch(() => null);
    const res = await fetch('/api/wp/sync-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand,
        contentItem: { ...itemWithProducts, bodyHtml: prepareWpBody(itemWithProducts, brand, frameMeta) },
        byokKeys,
        ...(statusTarget === 'draft' ? { status: 'draft' } : {}),
      }),
    });
    const data = await res.json();
    if (!data || !data.success) {
      return { ok: false, message: data?.message || 'WordPress sync failed.' };
    }
    const updated: ContentItem = {
      ...item,
      wpPostId: data.wpPostId,
      wpMediaId: typeof data.wpMediaId === 'number' ? data.wpMediaId : item.wpMediaId,
      featuredMediaId: typeof data.featuredMediaId === 'number' ? data.featuredMediaId : item.featuredMediaId,
      // Persist images the sync generated/hosted so the next push is
      // deterministic (no regeneration, no duplicate media uploads).
      featuredImageUrl: data.images?.heroUrl || item.featuredImageUrl,
      wpPreviewUrl: data.previewUrl,
      wpLiveUrl: data.link,
      status: (data.status === 'Draft_Ready' ? 'Draft_Ready' : 'Published') as PipelineStatus,
      lastSyncedAt: new Date().toISOString(),
    };
    return { ok: true, message: data.message || 'Synced to WordPress.', updated };
  } catch (err: any) {
    return { ok: false, message: `Network error: ${err?.message || 'WordPress sync failed.'}` };
  }
}

/**
 * Re-check the ACTUAL post state on WordPress. The stored item status can go
 * stale (post trashed/re-published from wp-admin, or the item's wpPostId was
 * never persisted) — this corrects the item so the UI tells the truth.
 */
export async function refreshWpState(
  brand: Brand | undefined | null,
  item: ContentItem,
): Promise<WpSyncResult> {
  const id = item.wpPostId;
  if (!id || !brand) return { ok: false, message: 'No linked WordPress post to refresh.' };
  try {
    const res = await fetch('/api/wp/get-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, wpPostId: id, contentType: item.contentType }),
    });
    const data = await res.json();
    if (!data || !data.success || !data.post) {
      return { ok: false, message: data?.message || 'Post not found on WordPress.' };
    }
    const p = data.post;
    const updated: ContentItem = {
      ...item,
      wpLiveUrl: p.link || item.wpLiveUrl,
      lastSyncedAt: new Date().toISOString(),
    };
    let message: string;
    if (p.status === 'publish') {
      updated.status = 'Published';
      message = `Post #${id} is LIVE on WordPress — ${p.link}`;
    } else if (p.status === 'trash') {
      updated.status = 'Draft_Ready';
      message = `Post #${id} is in the WordPress TRASH — publish from here to restore it and bring it live.`;
    } else {
      updated.status = 'Draft_Ready';
      message = `Post #${id} is a hidden DRAFT on WordPress (status: ${p.status}).`;
    }
    return { ok: true, message, updated };
  } catch (err: any) {
    return { ok: false, message: `Refresh error: ${err?.message || 'Could not reach WordPress.'}` };
  }
}

export interface PublishGate {
  ok: boolean;
  reason?: string;
}

/**
 * First-publish gate shared by the editor and the hub. The SEO audit itself is
 * computed live inside the editor (single source of truth), so the hub shows
 * that check as "run the audit in the editor" instead of bypassing it.
 */
export function publishGate(
  item: ContentItem | undefined | null,
  brand: Brand | undefined | null,
  isLive: boolean,
): PublishGate {
  if (!item) return { ok: false, reason: 'No item to publish.' };
  // Live posts can always be updated — they already cleared the gate.
  if (isLive) return { ok: true };
  if (!brand?.wpUrl || !brand?.wpUsername || !brand?.wpAppPassword) {
    return { ok: false, reason: 'Add WordPress connection details in Brands & Settings first.' };
  }
  if (!(item.title || '').trim()) return { ok: false, reason: 'Give the post a title first.' };
  if (countWords(item.bodyHtml || '') < 50) {
    return { ok: false, reason: 'Write at least 50 words before publishing.' };
  }
  if (!(item.primaryKeyword || '').trim()) {
    return { ok: false, reason: 'Set a focus keyphrase in the editor (SEO tab) first.' };
  }
  return { ok: true };
}
