/**
 * Dynamic template field population — shared, testable core.
 *
 * This is the single source of truth for how FGOS fills the dynamic sections
 * of a blog template (Related Articles, Related Products/Services/Books, and
 * the final CTA). It is deliberately theme-agnostic: the emitted markup uses
 * generic `fg-` prefixed classes with no hard-coded brand fonts or colours, so
 * the same output renders correctly under any WordPress theme (Kadence, Hello
 * Elementor, etc.).
 *
 * Extracted from server.ts so the end-to-end test can exercise it directly
 * without a live AI call or a live WordPress site.
 */

export const stripHtml = (html: string = '') =>
  String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

export const escapeHtmlAttr = (s: any) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface DynamicFieldsOpts {
  products?: any[];
  relatedArticles?: any[];
  cta?: string;
  recommendationType?: 'products' | 'services' | 'books' | 'none';
  brandName?: string;
}

export interface DynamicFieldsResult {
  html: string;
  fixes: string[];
}

export function populateDynamicFields(
  html: string,
  opts: DynamicFieldsOpts,
): DynamicFieldsResult {
  const fixes: string[] = [];
  let out = html;
  const products = opts.products || [];
  const related = opts.relatedArticles || [];
  const recType = opts.recommendationType || (products.length ? 'products' : 'none');
  const brandName = opts.brandName || 'our';

  // 1) Replace product-recommendation placeholders with a real product card.
  const prodRe = /<div[^>]*class="[^"]*product-recommendation[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let prodCount = 0;
  out = out.replace(prodRe, (full: string, inner: string) => {
    // Pick the most relevant real product: prefer one whose name/category matches
    // the placeholder text; otherwise fall back to the first product.
    const hint = stripHtml(inner).toLowerCase();
    let product = products.find((p: any) =>
      hint && (p.name.toLowerCase().includes(hint) || hint.includes(p.name.toLowerCase()) ||
        (p.categories || []).some((c: string) => hint.includes(c.toLowerCase())))
    );
    if (!product) product = products[0];
    if (!product) return full; // no real product available — leave placeholder
    prodCount++;
    const price = product.price ? ` · ${product.currency || '£'}${product.price}` : '';
    const img = product.image
      ? `<img src="${escapeHtmlAttr(product.image)}" alt="${escapeHtmlAttr(product.name)}" loading="lazy" />`
      : '';
    const link = product.permalink || '#';
    return `<div class="product-recommendation">
  <div class="product-card">
    ${img}
    <div class="product-card-body">
      <h4>${escapeHtmlAttr(product.name)}</h4>
      <p>${escapeHtmlAttr(product.shortDescription || product.name)}</p>
      <a class="product-card-link" href="${escapeHtmlAttr(link)}" target="_blank" rel="noopener">View product${price}</a>
    </div>
  </div>
</div>`;
  });
  if (prodCount) fixes.push(`populated ${prodCount} product recommendation(s) with real store products`);

  // 2) Rewrite related-article links to point at real content-register articles.
  //    Only rewrite links whose href is a generic /blog/ path (not an external
  //    URL and not already a real article slug).
  if (related.length) {
    const knownSlugs = new Set(related.map((r: any) => (r.slug || '').toLowerCase().replace(/^\/+|\/+$/g, '').replace(/^blog\//i, '')));
    const aRe = /<a\b([^>]*)href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/gi;
    let linkCount = 0;
    out = out.replace(aRe, (full: string, pre: string, href: string, post: string, anchor: string) => {
      const clean = href.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
      // Only touch internal /blog/ paths that don't already match a real article.
      if (!/^blog\//.test(clean)) return full;
      const slugPart = clean.replace(/^blog\//, '');
      if (knownSlugs.has(slugPart)) return full;
      // Find a real related article whose slug/title overlaps the anchor text.
      const anchorLower = stripHtml(anchor).toLowerCase();
      const match = related.find((r: any) =>
        (r.slug && anchorLower.includes(r.slug.toLowerCase().replace(/-/g, ' '))) ||
        (r.title && anchorLower.includes(r.title.toLowerCase()))
      ) || related[0];
      if (!match) return full;
      const slug = (match.slug || '').replace(/^\/+|\/+$/g, '').replace(/^blog\//i, '');
      if (!slug) return full;
      linkCount++;
      return `<a${pre}href="/blog/${escapeHtmlAttr(slug)}"${post}>${anchor}</a>`;
    });
    if (linkCount) fixes.push(`rewired ${linkCount} internal link(s) to real content-register articles`);
  }

  // 3) Ensure the CTA section carries the agreed CTA text.
  if (opts.cta && opts.cta.trim()) {
    const ctaText = opts.cta.trim();
    // If a CTA band exists but is empty/placeholder, fill it.
    const ctaRe = /(<div[^>]*class="[^"]*cta[^"]*"[^>]*>)([\s\S]*?)(<\/div>)/gi;
    let ctaCount = 0;
    out = out.replace(ctaRe, (full: string, open: string, inner: string, close: string) => {
      const stripped = stripHtml(inner).trim();
      if (stripped.length > 0 && !/\[.*\]/.test(stripped)) return full; // already has real content
      ctaCount++;
      return `${open}<p>${escapeHtmlAttr(ctaText)}</p>${close}`;
    });
    if (ctaCount) fixes.push(`filled ${ctaCount} empty CTA section(s) with the agreed call-to-action`);
  }

  // 4) Ensure the article always carries the three dynamic sections — Related
  //    Articles, Related Products/Services, and a final CTA — using semantic,
  //    theme-agnostic markup. If the AI already produced a section we leave it;
  //    otherwise we append one built from real data. The `fg-` classes are
  //    generic and render cleanly under any theme (Kadence, Hello Elementor,
  //    etc.) because they carry no hard-coded brand fonts or colours.
  const hasRelatedSection = /class="[^"]*fg-related-articles[^"]*"/i.test(out) ||
    /<section[^>]*class="[^"]*related[^"]*"[^>]*>/i.test(out) ||
    /<h2[^>]*>[^<]*(keep reading|related (posts|articles|reading))[^<]*<\/h2>/i.test(out);
  const hasProductSection = /class="[^"]*fg-related-products[^"]*"/i.test(out) ||
    /<section[^>]*class="[^"]*product[^"]*"[^>]*>/i.test(out) ||
    /<h2[^>]*>[^<]*(our (products|services|books)|explore (our )?(products|services|books)|related (products|services))[^<]*<\/h2>/i.test(out);
  const hasCtaSection = /class="[^"]*fg-cta[^"]*"/i.test(out) ||
    /<section[^>]*class="[^"]*cta[^"]*"[^>]*>/i.test(out) ||
    /<h2[^>]*>[^<]*(get started|call to action|visit our shop|book now|contact us)[^<]*<\/h2>/i.test(out);

  const appended: string[] = [];

  // 4a) Related Articles section (only when we have real published articles).
  if (!hasRelatedSection && related.length) {
    const cards = related.slice(0, 3).map((r: any) => {
      const slug = (r.slug || '').replace(/^\/+|\/+$/g, '').replace(/^blog\//i, '');
      const title = r.title || 'Related article';
      const excerpt = r.excerpt || r.topic || r.keywords || '';
      return `<a class="fg-related-card" href="/blog/${escapeHtmlAttr(slug)}">
  <h3>${escapeHtmlAttr(title)}</h3>
  ${excerpt ? `<p>${escapeHtmlAttr(excerpt)}</p>` : ''}
</a>`;
    }).join('\n');
    out += `\n\n<section class="fg-related-articles" aria-label="Related articles">
  <h2>Keep Reading</h2>
  <div class="fg-related-grid">
${cards}
  </div>
</section>`;
    appended.push('Related Articles');
  }

  // 4b) Related Products / Services / Books section (per-brand recommendation type).
  if (!hasProductSection && recType !== 'none' && products.length) {
    const heading = recType === 'books' ? 'Explore Our Books'
      : recType === 'services' ? 'Explore Our Services'
      : 'Explore Our Products';
    const cards = products.slice(0, 3).map((p: any) => {
      const price = p.price ? ` · ${p.currency || '£'}${p.price}` : '';
      const img = p.image
        ? `<img src="${escapeHtmlAttr(p.image)}" alt="${escapeHtmlAttr(p.name)}" loading="lazy" />`
        : '';
      const link = p.permalink || '#';
      return `<div class="fg-product-card">
  ${img}
  <div class="fg-product-card-body">
    <h3>${escapeHtmlAttr(p.name)}</h3>
    <p>${escapeHtmlAttr(p.shortDescription || p.name)}</p>
    <a class="fg-product-card-link" href="${escapeHtmlAttr(link)}" target="_blank" rel="noopener">View ${recType === 'books' ? 'book' : recType === 'services' ? 'service' : 'product'}${price}</a>
  </div>
</div>`;
    }).join('\n');
    out += `\n\n<section class="fg-related-products" aria-label="${escapeHtmlAttr(heading)}">
  <h2>${escapeHtmlAttr(heading)}</h2>
  <div class="fg-product-grid">
${cards}
  </div>
</section>`;
    appended.push(recType === 'books' ? 'Related Books' : recType === 'services' ? 'Related Services' : 'Related Products');
  }

  // 4c) Final CTA section (only when we have agreed CTA text).
  if (!hasCtaSection && opts.cta && opts.cta.trim()) {
    out += `\n\n<section class="fg-cta" aria-label="Call to action">
  <p>${escapeHtmlAttr(opts.cta.trim())}</p>
</section>`;
    appended.push('CTA');
  }

  if (appended.length) {
    fixes.push(`appended missing dynamic section(s): ${appended.join(', ')} (theme-agnostic markup)`);
  }

  return { html: out, fixes };
}
