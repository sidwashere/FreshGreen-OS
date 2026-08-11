import { BlogStyleKit, Brand, VisualBlock } from '../types';

// ---------------------------------------------------------------------------
// Brand "blog style kit" → rich, responsive article HTML.
//
// Every block renders as self-contained HTML with INLINE styles (so layouts
// survive any theme/CSS purging), plus one scoped <style> block that adds the
// things inline styles cannot: :hover states, <details> markers, carousel
// scrollbars and the 640px mobile media query. Everything is fluid-first:
// clamp() typography, auto-fit grids, flex-wrap bands — the article looks
// professional on a 320px phone and a 27" screen with zero extra effort.
// ---------------------------------------------------------------------------

export const FONT_STACKS: Record<string, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  garamond: "'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif",
  helvetica: "'Helvetica Neue', Arial, sans-serif",
  verdana: 'Verdana, Geneva, Tahoma, sans-serif',
  mono: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
};

export const FONT_STACK_LABELS: Record<string, string> = {
  system: 'Modern System (clean sans)',
  georgia: 'Georgia (classic serif)',
  garamond: 'Garamond (elegant serif)',
  helvetica: 'Helvetica (editorial sans)',
  verdana: 'Verdana (wide, readable)',
  mono: 'Monospace (technical)',
};

export const ART_REGION_START = '<!--fg-art:start-->';
export const ART_REGION_END = '<!--fg-art:end-->';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------
const clamp255 = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

export function hexToRgb(hex: string): [number, number, number] {
  const h = (hex || '').replace('#', '').trim();
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (isNaN(num) || full.length !== 6) return [16, 185, 129]; // safe fallback green
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Darken (f < 1) or lighten (f > 1) a hex colour. */
export function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${[r, g, b].map((c) => clamp255(c * f).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix a hex colour toward white. p=0 keeps the colour, p=1 is white. */
export function tint(hex: string, p: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = Math.min(1, Math.max(0, p));
  return `#${[r, g, b].map((c) => clamp255(c + (255 - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

/** With-whiteness helper for soft tinted surfaces (light pastel of brand colour). */
export const softTint = (hex: string) => tint(hex, 0.92);

// ---------------------------------------------------------------------------
// Style kit resolution — a brand can NEVER render unstyled.
// ---------------------------------------------------------------------------
export function resolveBlogStyle(brand?: Pick<Brand, 'primaryColor' | 'blogStyle'> | null): BlogStyleKit {
  const raw = brand?.primaryColor || '';
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : '#10b981';
  const s = brand?.blogStyle || {};
  const headingKey = s.headingFont && FONT_STACKS[s.headingFont] ? s.headingFont : 'georgia';
  const bodyKey = s.bodyFont && FONT_STACKS[s.bodyFont] ? s.bodyFont : 'system';
  return {
    primary,
    secondary: s.secondary || tint(primary, 0.88),
    accent: s.accent || '#f59e0b',
    surface: s.surface || '#ffffff',
    band: s.band || shade(primary, 0.32),
    text: s.text || '#1f2937',
    muted: s.muted || '#64748b',
    headingFont: FONT_STACKS[headingKey],
    bodyFont: FONT_STACKS[bodyKey],
    radius: typeof s.radius === 'number' ? Math.min(32, Math.max(0, Math.round(s.radius))) : 14,
    buttonStyle: s.buttonStyle || 'solid',
  };
}

export const DEFAULT_BUTTON_STYLES: BlogStyleKit['buttonStyle'][] = ['solid', 'outline', 'soft'];

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------
export const esc = (v?: string | null) =>
  (v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const txt = (v?: string | null) => esc(v).replace(/\n/g, '<br />');

// ---------------------------------------------------------------------------
// Buttons (light background and dark-band variants)
// ---------------------------------------------------------------------------
function btn(kit: BlogStyleKit, label?: string, url?: string): string {
  const text = txt(label);
  if (!text) return '';
  const base = 'display:inline-block;padding:12px 24px;border-radius:' + kit.radius + 'px;font-weight:700;font-size:15px;line-height:1.4;text-decoration:none;';
  if (kit.buttonStyle === 'outline') {
    return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:transparent;color:${kit.primary};border:2px solid ${kit.primary};">${text}</a>`;
  }
  if (kit.buttonStyle === 'soft') {
    return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:${softTint(kit.primary)};color:${kit.primary};">${text}</a>`;
  }
  return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:${kit.primary};color:#fff;box-shadow:0 4px 14px ${shade(kit.primary, 0.5)}44;">${text}</a>`;
}

/** Button on a dark brand band (hero / CTA) — white solid reads best there. */
function bandBtn(kit: BlogStyleKit, label?: string, url?: string): string {
  const text = txt(label);
  if (!text) return '';
  const base = 'display:inline-block;padding:12px 26px;border-radius:' + kit.radius + 'px;font-weight:700;font-size:15px;line-height:1.4;text-decoration:none;';
  if (kit.buttonStyle === 'outline') {
    return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:transparent;color:#fff;border:2px solid rgba(255,255,255,.85);">${text}</a>`;
  }
  if (kit.buttonStyle === 'soft') {
    return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:rgba(255,255,255,.16);color:#fff;">${text}</a>`;
  }
  return `<a href="${esc(url) || '#'}" class="fg-btn" style="${base}background:#fff;color:${kit.band};box-shadow:0 6px 18px rgba(0,0,0,.18);">${text}</a>`;
}

function chip(kit: BlogStyleKit, label?: string): string {
  const text = txt(label);
  if (!text) return '';
  return `<span style="display:inline-block;background:${kit.accent};color:${shade(kit.accent, 0.3)};font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;border-radius:999px;margin-bottom:14px;">${text}</span>`;
}

function h2(kit: BlogStyleKit, title?: string, extraStyle = ''): string {
  return `<h2 style="margin:0 0 14px;font-family:${kit.headingFont};font-size:clamp(22px,3.2vw,30px);line-height:1.25;color:${kit.text};${extraStyle}">${txt(title)}</h2>`;
}

// ---------------------------------------------------------------------------
// Image figure (shared with the HTML editor insert + sync marker logic)
// ---------------------------------------------------------------------------
export function figureHtmlFor(block: Pick<VisualBlock, 'id' | 'imageUrl' | 'imageAlt' | 'imageCaption' | 'imageLayout'>, radius = 12): string {
  const src = (block.imageUrl || '').trim();
  if (!src) return '';
  const layout = block.imageLayout || 'full';
  const alt = (block.imageAlt || '').trim() || 'Article image';
  const caption = (block.imageCaption || '').trim();

  const imgStyle: Record<string, string> = { display: 'block', 'max-width': '100%', height: 'auto', 'border-radius': `${radius}px` };
  const figStyle: Record<string, string> = { margin: '1.5em 0', 'text-align': 'center' };

  if (layout === 'left') {
    imgStyle.float = 'left';
    imgStyle.margin = '0 1.5em 0.75em 0';
    imgStyle.width = '45%';
    figStyle['text-align'] = 'left';
    figStyle.display = 'block';
  } else if (layout === 'right') {
    imgStyle.float = 'right';
    imgStyle.margin = '0 0 0.75em 1.5em';
    imgStyle.width = '45%';
    figStyle['text-align'] = 'right';
    figStyle.display = 'block';
  } else if (layout === 'center') {
    imgStyle.margin = '0 auto';
    imgStyle.width = '70%';
  }

  const styleAttr = (s: Record<string, string>) => Object.entries(s).map(([k, v]) => `${k}:${v}`).join(';');
  const figcaption = caption ? `<figcaption style="font-size:0.85em;color:#64748b;margin-top:0.5em">${txt(caption)}</figcaption>` : '';
  return `<!--image:${block.id}--><figure class="fg-img" style="${styleAttr(figStyle)}"><img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" style="${styleAttr(imgStyle)}" loading="lazy" />${figcaption}</figure><!--/image:${block.id}-->`;
}

// ---------------------------------------------------------------------------
// Scoped <style> — hover states, details markers, carousel scrollbars,
// and the mobile media query. If a security plugin strips <style>, every
// visual still works because all core styling is inline — only these
// enhancements are lost.
// ---------------------------------------------------------------------------
function scopedStyles(scope: string, kit: BlogStyleKit): string {
  return `<style>
.fg-art-${scope} { box-sizing: border-box; }
.fg-art-${scope} *, .fg-art-${scope} *::before, .fg-art-${scope} *::after { box-sizing: border-box; }
.fg-art-${scope} a.fg-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,.16); }
.fg-art-${scope} details > summary { list-style: none; }
.fg-art-${scope} details > summary::-webkit-details-marker { display: none; }
.fg-art-${scope} details[open] .fg-chev { transform: rotate(180deg); }
.fg-art-${scope} .fg-car-track { scrollbar-width: thin; scrollbar-color: ${kit.primary}66 transparent; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar { height: 8px; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar-track { background: transparent; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar-thumb { background: ${kit.primary}55; border-radius: 999px; }
@media (max-width: 640px) {
  .fg-art-${scope} .fg-hero, .fg-art-${scope} .fg-pc-row { flex-direction: column; }
  .fg-art-${scope} .fg-hero .fg-hero-media, .fg-art-${scope} .fg-pc-media { width: 100% !important; }
  .fg-art-${scope} .fg-img img { float: none !important; width: 100% !important; margin: 0 0 12px !important; }
  .fg-art-${scope} .fg-car-slide { flex-basis: 86%; }
  .fg-art-${scope} .fg-btn { width: 100%; box-sizing: border-box; text-align: center; }
}
</style>`;
}

// ---------------------------------------------------------------------------
// Per-block renderers
// ---------------------------------------------------------------------------
function renderHero(block: VisualBlock, kit: BlogStyleKit): string {
  const hasMedia = !!(block.imageUrl || '').trim();
  return `<section class="fg-hero" style="background:linear-gradient(135deg, ${kit.band}, ${shade(kit.band, 0.82)});color:#fff;border-radius:${kit.radius}px;padding:clamp(24px,5vw,56px);display:flex;flex-wrap:wrap;align-items:center;gap:clamp(16px,4vw,32px);margin:0 0 24px;">
  <div style="flex:1 1 320px;min-width:0;">
    ${chip(kit, block.badge)}
    <h2 style="margin:0 0 12px;font-family:${kit.headingFont};font-size:clamp(26px,4.5vw,40px);line-height:1.15;color:#fff;">${txt(block.title)}</h2>
    ${block.subtitle ? `<p style="margin:0 0 8px;font-size:clamp(15px,1.8vw,17px);line-height:1.7;color:rgba(255,255,255,.94);max-width:62ch;">${txt(block.subtitle)}</p>` : ''}
    ${block.content ? `<p style="margin:0 0 20px;font-size:15.5px;line-height:1.7;color:rgba(255,255,255,.85);max-width:62ch;">${txt(block.content)}</p>` : ''}
    ${bandBtn(kit, block.buttonText, block.buttonUrl)}
  </div>
  ${hasMedia ? `<div class="fg-hero-media" style="flex:1 1 260px;min-width:0;max-width:460px;"><img src="${esc(block.imageUrl)}" alt="${esc(block.imageAlt) || 'Hero image'}" style="display:block;width:100%;height:auto;border-radius:${kit.radius}px;box-shadow:0 18px 40px rgba(0,0,0,.3);object-fit:cover;" loading="lazy" /></div>` : ''}
</section>`;
}

function renderParagraph(block: VisualBlock, kit: BlogStyleKit): string {
  // Generated articles arrive as section blocks: the heading text lives in
  // `title` and the section body in `content`. Render the heading (styled) so
  // articles never degrade into heading-less walls of text.
  const head = (block.title || '').trim() ? h2(kit, block.title, `padding-top:6px;`) : '';
  const body = (block.content || '').trim()
    ? `<p style="margin:0 0 20px;font-size:17px;line-height:1.75;color:${kit.text};">${txt(block.content)}</p>`
    : '';
  return head + body;
}

function renderHeading(block: VisualBlock, kit: BlogStyleKit): string {
  return h2(kit, block.title || block.content, `padding-top:6px;`);
}

function renderCallout(block: VisualBlock, kit: BlogStyleKit): string {
  return `<aside style="background:${softTint(kit.primary)};border-left:4px solid ${kit.primary};border-radius:${kit.radius}px;padding:18px 20px;margin:0 0 22px;display:flex;gap:14px;align-items:flex-start;">
  <span style="flex:0 0 10px;width:10px;height:10px;border-radius:999px;background:${kit.accent};margin-top:8px;"></span>
  <div>
    ${block.title ? `<p style="margin:0 0 4px;font-weight:800;font-family:${kit.headingFont};font-size:16px;color:${kit.text};">${txt(block.title)}</p>` : ''}
    <p style="margin:0;font-size:15.5px;line-height:1.7;color:${kit.text};">${txt(block.content)}</p>
  </div>
</aside>`;
}

function renderFaq(block: VisualBlock, kit: BlogStyleKit): string {
  const items = block.faqItems || [];
  if (!items.length) return '';
  return `<section style="margin:0 0 24px;">
  ${block.title ? h2(kit, block.title) : ''}
  ${items.map((it, i) => `<details style="border:1px solid ${tint(kit.primary, 0.8)};border-radius:${kit.radius}px;background:${kit.surface};margin:0 0 10px;overflow:hidden;" ${i === 0 ? 'open' : ''}>
  <summary style="cursor:pointer;list-style:none;padding:15px 18px;font-weight:700;font-family:${kit.headingFont};font-size:16px;color:${kit.text};display:flex;justify-content:space-between;align-items:center;gap:12px;">${txt(it.question)}<span class="fg-chev" style="flex:0 0 auto;color:${kit.primary};transition:transform .2s ease;font-size:13px;">&#9660;</span></summary>
  <div style="padding:2px 18px 18px;color:${kit.text};font-size:15.5px;line-height:1.75;border-top:1px solid ${tint(kit.primary, 0.9)};">${txt(it.answer)}</div>
</details>`).join('\n')}
</section>`;
}

function renderCards(block: VisualBlock, kit: BlogStyleKit): string {
  const cards = block.cards || [];
  if (!cards.length) return '';
  return `<section style="margin:0 0 24px;">
  ${block.title ? h2(kit, block.title) : ''}
  ${block.content ? `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:${kit.muted};">${txt(block.content)}</p>` : ''}
  <div class="fg-cardgrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:16px;">
  ${cards.map((c) => `<div style="background:${kit.surface};border:1px solid ${tint(kit.primary, 0.78)};border-radius:${kit.radius}px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 2px 12px rgba(15,23,42,.06);">
    ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.title)}" loading="lazy" style="display:block;width:100%;height:170px;object-fit:cover;" />` : `<div style="height:8px;background:${kit.primary};"></div>`}
    <div style="padding:16px 18px 18px;display:flex;flex-direction:column;gap:8px;flex:1;">
      <h3 style="margin:0;font-family:${kit.headingFont};font-size:17px;line-height:1.3;color:${kit.text};">${txt(c.title)}</h3>
      <p style="margin:0;color:${kit.muted};font-size:14.5px;line-height:1.65;flex:1;">${txt(c.content)}</p>
      ${btn(kit, c.buttonText, c.buttonUrl).replace('padding:12px 24px', 'padding:9px 18px;font-size:13.5px')}
    </div>
  </div>`).join('\n')}
  </div>
</section>`;
}

function renderQuote(block: VisualBlock, kit: BlogStyleKit): string {
  if (!(block.content || '').trim()) return '';
  return `<figure style="margin:0 0 24px;background:${tint(kit.accent, 0.93)};border-radius:${kit.radius}px;padding:clamp(20px,4vw,36px);position:relative;border:1px solid ${tint(kit.accent, 0.8)};">
  <span style="position:absolute;top:14px;left:20px;font-family:${kit.headingFont};font-size:54px;line-height:1;color:${kit.accent};opacity:.35;">&#8220;</span>
  <blockquote style="margin:0;font-family:${kit.headingFont};font-size:clamp(18px,2.6vw,24px);font-style:italic;line-height:1.5;color:${kit.text};">${txt(block.content)}</blockquote>
  ${block.author ? `<figcaption style="margin-top:14px;font-weight:800;font-size:14px;color:${shade(kit.accent, 0.55)};">— ${txt(block.author)}</figcaption>` : ''}
</figure>`;
}

function renderCtaBand(block: VisualBlock, kit: BlogStyleKit): string {
  return `<section class="fg-cta" style="background:linear-gradient(120deg, ${kit.band}, ${shade(kit.band, 0.78)});border-radius:${kit.radius}px;padding:clamp(24px,5vw,48px);text-align:center;color:#fff;margin:0 0 24px;">
  ${chip(kit, block.badge)}
  <h2 style="margin:0 auto 10px;font-family:${kit.headingFont};font-size:clamp(22px,3.4vw,32px);line-height:1.2;color:#fff;max-width:24ch;">${txt(block.title)}</h2>
  <p style="margin:0 auto 22px;max-width:56ch;color:rgba(255,255,255,.92);font-size:16px;line-height:1.7;">${txt(block.content)}</p>
  <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">${bandBtn(kit, block.buttonText, block.buttonUrl)}${block.subtitle ? `<span style="align-self:center;color:rgba(255,255,255,.8);font-size:14px;">${txt(block.subtitle)}</span>` : ''}</div>
</section>`;
}

function renderCarousel(block: VisualBlock, kit: BlogStyleKit): string {
  const slides = block.slides || [];
  if (!slides.length) return '';
  return `<section style="margin:0 0 24px;">
  ${block.title ? h2(kit, block.title) : ''}
  ${block.content ? `<p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:${kit.muted};">${txt(block.content)}</p>` : ''}
  <div class="fg-car-track" style="display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 2px 12px;">
  ${slides.map((s) => `<figure style="flex:0 0 min(78%,320px);scroll-snap-align:start;background:${kit.surface};border:1px solid ${tint(kit.primary, 0.78)};border-radius:${kit.radius}px;overflow:hidden;margin:0;display:flex;flex-direction:column;">
    ${s.imageUrl ? `<img src="${esc(s.imageUrl)}" alt="${esc(s.title)}" loading="lazy" style="display:block;width:100%;height:180px;object-fit:cover;" />` : `<div style="height:180px;background:linear-gradient(135deg, ${kit.primary}, ${kit.band});display:flex;align-items:center;justify-content:center;"><span style="color:#fff;font-weight:800;font-family:${kit.headingFont};font-size:20px;text-align:center;padding:12px;">${txt(s.title)}</span></div>`}
    <figcaption style="padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;flex:1;">
      ${s.title ? `<span style="font-weight:800;font-family:${kit.headingFont};font-size:16px;color:${kit.text};">${txt(s.title)}</span>` : ''}
      ${s.content ? `<span style="color:${kit.muted};font-size:14px;line-height:1.6;">${txt(s.content)}</span>` : ''}
      ${btn(kit, s.buttonText, s.buttonUrl).replace('padding:12px 24px', 'padding:9px 18px;font-size:13.5px')}
    </figcaption>
  </figure>`).join('\n')}
  </div>
  <p style="font-size:12px;color:${kit.muted};margin:0;">Swipe or scroll sideways for more &#8594;</p>
</section>`;
}

function renderProductCta(block: VisualBlock, kit: BlogStyleKit): string {
  const hasMedia = !!(block.imageUrl || '').trim();
  return `<section class="fg-pc-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:clamp(16px,4vw,32px);background:${kit.surface};border:1px solid ${tint(kit.primary, 0.78)};border-radius:${kit.radius}px;padding:clamp(20px,4vw,36px);margin:0 0 24px;box-shadow:0 4px 18px rgba(15,23,42,.06);">
  ${hasMedia ? `<div class="fg-pc-media" style="flex:1 1 240px;min-width:0;max-width:400px;"><img src="${esc(block.imageUrl)}" alt="${esc(block.imageAlt) || 'Product image'}" loading="lazy" style="display:block;width:100%;height:auto;border-radius:${kit.radius}px;object-fit:cover;" /></div>` : ''}
  <div style="flex:1 1 300px;min-width:0;">
    ${chip(kit, block.badge)}
    <h2 style="margin:0 0 10px;font-family:${kit.headingFont};font-size:clamp(20px,3vw,28px);line-height:1.2;color:${kit.text};">${txt(block.title)}</h2>
    <p style="margin:0 0 18px;font-size:16px;line-height:1.7;color:${kit.text};">${txt(block.content)}</p>
    ${btn(kit, block.buttonText, block.buttonUrl)}
  </div>
</section>`;
}

// ---------------------------------------------------------------------------
// Block → HTML (the full branded article body)
// ---------------------------------------------------------------------------
function renderBlock(block: VisualBlock, kit: BlogStyleKit): string {
  switch (block.type) {
    case 'hero': return renderHero(block, kit);
    case 'heading': return renderHeading(block, kit);
    case 'callout': return renderCallout(block, kit);
    case 'faq': return renderFaq(block, kit);
    case 'cards': return renderCards(block, kit);
    case 'quote': return renderQuote(block, kit);
    case 'cta_band': return renderCtaBand(block, kit);
    case 'carousel': return renderCarousel(block, kit);
    case 'product_cta': return renderProductCta(block, kit);
    case 'image_banner': return figureHtmlFor(block, kit.radius);
    case 'paragraph':
    default: return renderParagraph(block, kit);
  }
}

/** Serialise the full block list into the branded, responsive article body. */
export function blocksToHtml(blocks: VisualBlock[] | undefined, brand?: Pick<Brand, 'primaryColor' | 'blogStyle'> | null): string {
  const kit = resolveBlogStyle(brand);
  const list = (blocks || []).filter((b) => {
    if (b.type === 'image_banner') return !!(b.imageUrl || '').trim();
    if (b.type === 'faq') return !!(b.faqItems || []).length || !!(b.title || '').trim();
    if (b.type === 'quote') return !!(b.content || '').trim();
    if (b.type === 'cards') return !!(b.cards || []).length;
    if (b.type === 'carousel') return !!(b.slides || []).length;
    return !!(b.content || '').trim() || !!(b.title || '').trim();
  });
  if (!list.length) return '';
  const scope = Math.random().toString(36).slice(2, 8);
  return `<div class="fg-art fg-art-${scope}" style="font-family:${kit.bodyFont};color:${kit.text};line-height:1.7;max-width:860px;margin:0 auto;">
${scopedStyles(scope, kit)}
${list.map((b) => renderBlock(b, kit)).join('\n')}
</div>`;
}

/**
 * Re-render the styled article region inside bodyHtml.
 * - The region is delimited by ART_REGION_START/END markers.
 * - force=false (sync path): leaves hand-written HTML untouched when no region
 *   exists — non-destructive.
 * - force=true ("Rebuild styled article"): regenerates the ENTIRE body from
 *   blocks, wrapping it in the region markers.
 */
export function rebuildArticleHtml(
  bodyHtml: string | undefined,
  blocks: VisualBlock[] | undefined,
  brand?: Pick<Brand, 'primaryColor' | 'blogStyle'> | null,
  force = false,
): string {
  const regionRe = new RegExp(`${ART_REGION_START}[\\s\\S]*?${ART_REGION_END}`);
  const styled = blocksToHtml(blocks, brand);
  const html = bodyHtml || '';
  if (regionRe.test(html)) {
    return styled
      ? html.replace(regionRe, `${ART_REGION_START}\n${styled}\n${ART_REGION_END}`)
      : html.replace(regionRe, '');
  }
  if (force) {
    return styled ? `${html.replace(/\s*$/, '')}\n${ART_REGION_START}\n${styled}\n${ART_REGION_END}` : html;
  }
  return html;
}
