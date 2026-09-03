import { BlogStyleKit, Brand, VisualBlock } from '../types';
import { tipLabel, isDanielsBrand } from './tipLabel';

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
  jost: "'Jost', 'Helvetica Neue', Arial, sans-serif",
  cormorant: "'Cormorant Garamond', 'Palatino Linotype', Palatino, Georgia, serif",
  roboto: "'Roboto', 'Helvetica Neue', Arial, sans-serif",
  mono: "'SF Mono', Menlo, Consolas, 'Courier New', monospace",
};

export const FONT_STACK_LABELS: Record<string, string> = {
  system: 'Modern System (clean sans)',
  georgia: 'Georgia (classic serif)',
  garamond: 'Garamond (elegant serif)',
  helvetica: 'Helvetica (editorial sans)',
  verdana: 'Verdana (wide, readable)',
  jost: 'Jost (brand signature sans)',
  cormorant: 'Cormorant Garamond (editorial display)',
  roboto: 'Roboto (clean body sans)',
  mono: 'Monospace (technical)',
};

/**
 * Google Fonts required by the article renderer. Each entry is a
 * `family=<Name>:wght@...` query fragment for the Fonts API. The scoped
 * `<style>` block injects an `@import` so fonts load once per article,
 * matching the site's own Google Fonts (Jost, Cormorant Garamond, Roboto).
 */
export const GOOGLE_FONT_IMPORTS = [
  'Jost:wght@400;500;600;700;800',
  'Cormorant+Garamond:wght@400;500;600;700',
  'Roboto:wght@400;500;700',
];

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
  // Default to DTP's dark forest green when no brand colour is set.
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : '#203B32';
  const s = brand?.blogStyle || {};
  // Match the DTP site: Jost for headings, Roboto for body.
  const headingKey = s.headingFont && FONT_STACKS[s.headingFont] ? s.headingFont : 'jost';
  const bodyKey = s.bodyFont && FONT_STACKS[s.bodyFont] ? s.bodyFont : 'roboto';
  return {
    primary,
    secondary: s.secondary || tint(primary, 0.88),
    // DTP gold accent — matches the site's C9A24A.
    accent: s.accent || '#C9A24A',
    surface: s.surface || '#ffffff',
    band: s.band || '#203B32',
    text: s.text || '#2D3748',
    muted: s.muted || '#718096',
    headingFont: FONT_STACKS[headingKey],
    bodyFont: FONT_STACKS[bodyKey],
    radius: typeof s.radius === 'number' ? Math.min(32, Math.max(0, Math.round(s.radius))) : 8,
    buttonStyle: s.buttonStyle || 'outline',
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
  return `<h2 style="margin:32px 0 16px;font-family:${kit.headingFont};font-size:clamp(22px,3.2vw,30px);line-height:1.25;color:${kit.text};${extraStyle}">${txt(title)}</h2>`;
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
  const fontImport = GOOGLE_FONT_IMPORTS.map((f) => `family=${f}`).join('&');
  return `<style>
/* === Google Fonts (matches the site's Jost + Cormorant Garamond + Roboto) === */
@import url('https://fonts.googleapis.com/css2?${fontImport}&display=swap');

/* === Box-sizing reset === */
.fg-art-${scope} { box-sizing: border-box; }
.fg-art-${scope} *, .fg-art-${scope} *::before, .fg-art-${scope} *::after { box-sizing: border-box; }

/* === Theme CSS override — nuclear specificity: :is() boosts specificity,
     all:unset !important wipes any elementor/theme rule, then we re-set
     every property we care about with !important. Works regardless of whether
     the content sits inside .entry-content, .post-content, article, or is
     rendered directly by Elementor's elementor_header_footer template. ========== */
:is(.fg-art-${scope}) h2,
:is(.entry-content, .post-content, article) .fg-art-${scope} h2 {
  all: unset !important; display: block !important; box-sizing: border-box !important;
  margin: 32px 0 16px !important;
  font-family: ${kit.headingFont} !important;
  font-size: clamp(22px,3.2vw,30px) !important;
  line-height: 1.25 !important;
  color: ${kit.text} !important;
  font-weight: 700 !important;
}
:is(.fg-art-${scope}) h3,
:is(.entry-content, .post-content, article) .fg-art-${scope} h3 {
  all: unset !important; display: block !important; box-sizing: border-box !important;
  margin: 24px 0 12px !important;
  font-family: ${kit.headingFont} !important;
  font-size: clamp(18px,2.6vw,24px) !important;
  line-height: 1.3 !important;
  color: ${kit.text} !important;
  font-weight: 700 !important;
}
:is(.fg-art-${scope}) p,
:is(.entry-content, .post-content, article) .fg-art-${scope} p {
  all: unset !important; display: block !important; box-sizing: border-box !important;
  margin: 0 0 20px !important;
  font-size: 17px !important;
  line-height: 1.75 !important;
  color: ${kit.text} !important;
}
:is(.fg-art-${scope}) a,
:is(.entry-content, .post-content, article) .fg-art-${scope} a {
  color: ${kit.primary} !important;
  text-decoration: underline !important;
}
:is(.fg-art-${scope}) img,
:is(.entry-content, .post-content, article) .fg-art-${scope} img {
  max-width: 100% !important;
  height: auto !important;
}
:is(.fg-art-${scope}) ul,
:is(.fg-art-${scope}) ol,
:is(.entry-content, .post-content, article) .fg-art-${scope} ul,
:is(.entry-content, .post-content, article) .fg-art-${scope} ol {
  margin: 0 0 22px !important;
  padding-left: 1.4em !important;
}
:is(.fg-art-${scope}) figure,
:is(.entry-content, .post-content, article) .fg-art-${scope} figure {
  all: unset !important; display: block !important; box-sizing: border-box !important;
  margin: 1.5em 0 !important;
  text-align: center !important;
}
:is(.fg-art-${scope}) blockquote,
:is(.entry-content, .post-content, article) .fg-art-${scope} blockquote {
  all: unset !important; display: block !important; box-sizing: border-box !important;
  margin: 0 !important;
  font-family: ${kit.headingFont} !important;
  font-style: italic !important;
}
:is(.fg-art-${scope}) section,
:is(.fg-art-${scope}) aside,
:is(.entry-content, .post-content, article) .fg-art-${scope} section,
:is(.entry-content, .post-content, article) .fg-art-${scope} aside {
  all: unset !important; display: block !important; box-sizing: border-box !important;
}
:is(.fg-art-${scope}) details > summary,
:is(.entry-content, .post-content, article) .fg-art-${scope} details > summary {
  all: unset !important; display: flex !important; box-sizing: border-box !important;
  cursor: pointer !important; list-style: none !important;
  padding: 15px 18px !important; font-weight: 700 !important;
  font-family: ${kit.headingFont} !important; font-size: 16px !important;
  color: ${kit.text} !important;
  justify-content: space-between !important; align-items: center !important;
}
/* Kill any theme margin/padding/width on our wrapper */
:is(.fg-art-${scope}) {
  margin: 0 !important; padding: 0 !important; max-width: none !important;
  width: auto !important; float: none !important; clear: none !important;
}

/* === Interactive enhancements === */
.fg-art-${scope} a.fg-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,.16); }
.fg-art-${scope} .fg-share-btn:hover { background: ${kit.primary} !important; color: #fff !important; border-color: ${kit.primary} !important; }
.fg-art-${scope} .fg-related-link:hover { border-color: ${kit.primary} !important; box-shadow: 0 4px 14px rgba(15,23,42,.08); }
.fg-art-${scope} details > summary { list-style: none; }
.fg-art-${scope} details > summary::-webkit-details-marker { display: none; }
.fg-art-${scope} details[open] .fg-chev { transform: rotate(180deg); }
.fg-art-${scope} .fg-car-track { scrollbar-width: thin; scrollbar-color: ${kit.primary}66 transparent; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar { height: 8px; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar-track { background: transparent; }
.fg-art-${scope} .fg-car-track::-webkit-scrollbar-thumb { background: ${kit.primary}55; border-radius: 999px; }

/* === Mobile responsive === */
@media (max-width: 768px) {
  .fg-art-${scope} .fg-hero { min-height: 260px !important; }
  .fg-art-${scope} .fg-pc-row { flex-direction: column !important; }
  .fg-art-${scope} .fg-pc-media { width: 100% !important; max-width: 100% !important; }
  .fg-art-${scope} .fg-cardgrid { grid-template-columns: 1fr !important; }
  .fg-art-${scope} .fg-share { gap: 4px !important; }
}
@media (max-width: 480px) {
  .fg-art-${scope} .fg-hero { min-height: 220px !important; border-radius: 0 !important; }
  .fg-art-${scope} .fg-hero > div:last-child { padding: 18px !important; }
  .fg-art-${scope} .fg-img img { float: none !important; width: 100% !important; margin: 0 0 12px !important; }
  .fg-art-${scope} .fg-car-slide { flex-basis: 86%; }
  .fg-art-${scope} .fg-btn { width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
  .fg-art-${scope} .fg-frame-head > div { flex-direction: column !important; align-items: flex-start !important; }
  .fg-art-${scope} .fg-related { grid-template-columns: 1fr !important; }
}
</style>`;
}

// ---------------------------------------------------------------------------
// Per-block renderers
// ---------------------------------------------------------------------------
function renderHero(block: VisualBlock, kit: BlogStyleKit): string {
  const hasMedia = !!(block.imageUrl || '').trim();
  // Full-width hero image with dark gradient overlay and title text on top.
  // The image stretches across the full article width; a gradient ensures
  // text remains readable regardless of image brightness.
  const badgeHtml = chip(kit, block.badge);
  const subtitleHtml = block.subtitle
    ? `<p style="margin:0 0 8px;font-size:clamp(15px,1.8vw,17px);line-height:1.7;color:rgba(255,255,255,.94);max-width:62ch;">${txt(block.subtitle)}</p>`
    : '';
  const contentHtml = block.content
    ? `<p style="margin:0 0 20px;font-size:15.5px;line-height:1.7;color:rgba(255,255,255,.85);max-width:62ch;">${txt(block.content)}</p>`
    : '';
  const ctaHtml = bandBtn(kit, block.buttonText, block.buttonUrl);

  if (hasMedia) {
    // Image hero: full-bleed image with gradient overlay + text
    return `<section class="fg-hero" style="position:relative;width:100%;min-height:clamp(280px,40vw,480px);display:flex;align-items:flex-end;border-radius:${kit.radius}px;overflow:hidden;margin:0 0 32px;">
  <img src="${esc(block.imageUrl)}" alt="${esc(block.imageAlt) || 'Hero image'}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" loading="eager" />
  <div style="position:absolute;inset:0;background:linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 50%, rgba(0,0,0,.12) 100%);"></div>
  <div style="position:relative;z-index:1;padding:clamp(24px,5vw,48px);color:#fff;width:100%;">
    ${badgeHtml}
    ${subtitleHtml}
    ${contentHtml}
    ${ctaHtml}
  </div>
</section>`;
  }
  // No-image hero: gradient band (fallback)
  return `<section class="fg-hero" style="background:linear-gradient(135deg, ${kit.band}, ${shade(kit.band, 0.82)});color:#fff;border-radius:${kit.radius}px;padding:clamp(24px,5vw,56px);margin:0 0 32px;">
  ${badgeHtml}
  ${subtitleHtml}
  ${contentHtml}
  ${ctaHtml}
</section>`;
}

function renderParagraph(block: VisualBlock, kit: BlogStyleKit): string {
  // Generated articles arrive as section blocks: the heading text lives in
  // `title` and the section body in `content`. Render the heading (styled) so
  // articles never degrade into heading-less walls of text.
  const head = (block.title || '').trim() ? h2(kit, block.title, `padding-top:6px;`) : '';
  const raw = (block.content || '').trim();
  if (!raw) return head;

  // Section text can carry bullet markers ("• " from <li> parsing) — render
  // those as a real <ul> instead of flattening the whole section into one
  // paragraph, so list content survives the round-trip to WordPress.
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullet = (l: string) => /^[•\-*]\s*/.test(l);
  if (lines.some(bullet)) {
    const lead = lines.filter((l) => !bullet(l)).join(' ');
    const items = lines.filter(bullet).map((l) => l.replace(/^[•\-*]\s*/, ''));
    const leadHtml = lead ? `<p style="margin:0 0 20px;font-size:17px;line-height:1.75;color:${kit.text};">${txt(lead)}</p>` : '';
    const listHtml = `<ul style="margin:0 0 22px;padding-left:1.4em;list-style:disc;color:${kit.text};font-size:16.5px;line-height:1.7;">
${items.map((i) => `  <li style="margin:0 0 8px;">${txt(i)}</li>`).join('\n')}
</ul>`;
    return head + leadHtml + listHtml;
  }

  const body = raw
    ? `<p style="margin:0 0 20px;font-size:17px;line-height:1.75;color:${kit.text};">${txt(raw)}</p>`
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
  return `<section class="fg-pc-row" style="display:flex;flex-wrap:wrap;align-items:center;gap:clamp(16px,4vw,32px);background:${kit.surface};border:1px solid ${tint(kit.primary, 0.78)};border-radius:${kit.radius}px;padding:clamp(20px,4vw,36px);margin:0 0 28px;box-shadow:0 4px 18px rgba(15,23,42,.06);">
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
// Tip callout — branded callout box with accent border + subtle background.
// The label is brand-aware: "Daniel's Tip" for the Daniel's brand, otherwise
// "Tip of the Day". The badge letter follows the same rule.
// ---------------------------------------------------------------------------
function renderDanielsTip(block: VisualBlock, kit: BlogStyleKit, brand?: Pick<Brand, 'primaryColor' | 'blogStyle' | 'name' | 'slug'> | null): string {
  const content = (block.content || '').trim();
  if (!content) return '';
  const label = tipLabel(brand);
  const badge = isDanielsBrand(brand) ? 'D' : 'T';
  return `<aside style="background:${softTint(kit.primary)};border-left:5px solid ${kit.primary};border-radius:${kit.radius}px;padding:clamp(18px,3vw,28px);margin:0 0 28px;position:relative;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
    <span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:${kit.primary};color:#fff;font-size:14px;font-weight:800;">${badge}</span>
    <span style="font-family:${kit.headingFont};font-weight:800;font-size:17px;color:${kit.primary};letter-spacing:.01em;">${label}</span>
  </div>
  <p style="margin:0;font-size:16px;line-height:1.75;color:${kit.text};">${txt(content)}</p>
</aside>`;
}

// ---------------------------------------------------------------------------
// Newsletter / email capture section. Styled section with MailerLite form
// placeholder. The form action URL will be wired up once provided by the team.
// ---------------------------------------------------------------------------
function renderNewsletter(block: VisualBlock, kit: BlogStyleKit): string {
  return `<section style="background:${softTint(kit.accent)};border:1px solid ${tint(kit.accent, 0.78)};border-radius:${kit.radius}px;padding:clamp(24px,5vw,40px);margin:0 0 28px;text-align:center;">
  <h3 style="margin:0 0 6px;font-family:${kit.headingFont};font-size:clamp(19px,2.8vw,26px);line-height:1.25;color:${kit.text};">Stay in the Loop</h3>
  <p style="margin:0 auto 20px;max-width:48ch;font-size:16px;line-height:1.7;color:${kit.muted};">Get the latest tips, guides and product news delivered to your inbox. No spam — just useful content for pet lovers.</p>
  <form action="#" method="post" style="display:flex;gap:10px;max-width:420px;margin:0 auto;flex-wrap:wrap;justify-content:center;">
    <input type="email" name="email" placeholder="Your email address" required style="flex:1 1 220px;padding:12px 16px;border:1px solid ${tint(kit.accent, 0.6)};border-radius:${kit.radius}px;font-size:15px;font-family:${kit.bodyFont};background:#fff;color:${kit.text};outline:none;" />
    <button type="submit" style="display:inline-block;padding:12px 24px;border-radius:${kit.radius}px;font-weight:700;font-size:15px;line-height:1.4;text-decoration:none;background:${kit.accent};color:#fff;border:none;cursor:pointer;font-family:${kit.bodyFont};box-shadow:0 4px 14px ${shade(kit.accent, 0.5)}44;">Subscribe</button>
  </form>
  <p style="margin:12px auto 0;max-width:48ch;font-size:12.5px;color:${kit.muted};">By subscribing you agree to our privacy policy. Unsubscribe at any time.</p>
</section>`;
}

// ---------------------------------------------------------------------------
// Article frame (byline, share, author, CTA, related) — wraps every pushed
// article so posts carry the brand's editorial furniture, not just body copy.
// Deterministic: the same meta always renders byte-identical HTML, so re-syncs
// stay diff-friendly. Everything is inline-styled + scoped classes, consistent
// with the rest of the generator. The theme's own entry-title stays the page's
// single h1 — the frame never renders the title as a heading.
// ---------------------------------------------------------------------------

export interface ArticleFrameMeta {
  /** Article title — used in share intent text. */
  title?: string;
  /** Base site URL (brand.wpUrl) — share URL base + footer CTA target. */
  siteUrl?: string;
  /** Article slug — builds the share URL `${siteUrl}/${slug}/`. */
  slug?: string;
  /** Brand display name — byline fallback, author box, footer CTA. */
  brandName?: string;
  /** Author line, e.g. "The Daniel's Tasty Petfoods Team". */
  author?: string;
  /** ISO date — formatted "August 15, 2026". */
  date?: string;
  /** Related posts strip. */
  related?: Array<{ title: string; url: string; imageUrl?: string }>;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-08-15T…" → "August 15, 2026"; '' when absent/invalid. */
export function formatArticleDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Rough read-time from block text (~5 chars/word, ~200 wpm). */
export function estimateReadMins(blocks: VisualBlock[] | undefined): number {
  const chars = (blocks || []).reduce(
    (n, b) => n + (b.title || '').length + (b.content || '').length + (b.subtitle || '').length,
    0,
  );
  return Math.max(1, Math.round(chars / 5 / 200));
}

/** Share URL for the article — `${siteUrl}/${slug}/`; '' when not derivable. */
export function frameShareUrl(meta: ArticleFrameMeta | undefined): string {
  if (!meta?.slug || !meta?.siteUrl) return '';
  return `${String(meta.siteUrl).replace(/\/+$/, '')}/${encodeURIComponent(meta.slug)}/`;
}

function frameShareRow(kit: BlogStyleKit, meta: ArticleFrameMeta | undefined, compact = false): string {
  const url = frameShareUrl(meta);
  if (!url) return '';
  const enc = encodeURIComponent(url);
  const title = encodeURIComponent((meta?.title || '').slice(0, 120));
  // Discreet icon-style share links — small, muted, never compete with content.
  const iconStyle = `display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;font-size:11px;font-weight:800;text-decoration:none;background:${softTint(kit.primary)};color:${kit.primary};border:1px solid ${tint(kit.primary, 0.78)};`;
  const items: Array<[string, string, string]> = [
    ['f', `https://www.facebook.com/sharer/sharer.php?u=${enc}`, 'Facebook'],
    ['X', `https://twitter.com/intent/tweet?url=${enc}${title ? `&text=${title}` : ''}`, 'X'],
    ['in', `https://www.linkedin.com/sharing/share-offsite/?url=${enc}`, 'LinkedIn'],
    ['&#8205;', `https://wa.me/?text=${title ? `${title}%20${enc}` : enc}`, 'WhatsApp'],
    ['&#9993;', `mailto:?subject=${title}&body=${enc}`, 'Email'],
  ];
  const icons = items
    .map(([icon, href, label]) => `<a class="fg-share-btn" href="${esc(href)}" target="_blank" rel="noopener" title="Share on ${label}" style="${iconStyle}">${icon}</a>`)
    .join('');
  return `<div class="fg-share" style="display:inline-flex;align-items:center;gap:6px;${compact ? 'margin-top:0' : 'margin-top:8px'};">
  ${icons}
</div>`;
}

function frameHead(kit: BlogStyleKit, meta: ArticleFrameMeta | undefined, readMins: number): string {
  if (!meta) return '';
  const parts: string[] = [];
  const byline = (meta.author || '').trim() || (meta.brandName ? `The ${meta.brandName} Team` : '');
  if (byline) parts.push(byline);
  const date = formatArticleDate(meta.date);
  if (date) parts.push(date);
  parts.push(`${readMins} min read`);
  const share = frameShareRow(kit, meta);
  return `<header class="fg-frame-head" style="margin:0 0 28px;padding-bottom:18px;border-bottom:1px solid ${tint(kit.primary, 0.85)};">
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
    <p style="margin:0;font-size:13.5px;font-weight:600;letter-spacing:.02em;color:${kit.muted};">${esc(parts.join(' · '))}</p>
    ${share}
  </div>
</header>`;
}

function frameFoot(kit: BlogStyleKit, meta: ArticleFrameMeta | undefined): string {
  if (!meta) return '';
  const parts: string[] = [];

  // --- "Keep Reading" related posts strip --------------------------------
  const related = meta.related || [];
  if (related.length) {
    const cards = related.map((r) => {
      const img = r.imageUrl
        ? `<img src="${esc(r.imageUrl)}" alt="${esc(r.title)}" loading="lazy" style="display:block;width:100%;height:160px;object-fit:cover;border-radius:${Math.max(6, kit.radius - 4)}px;" />`
        : `<div style="height:160px;background:linear-gradient(135deg, ${softTint(kit.primary)}, ${tint(kit.primary, 0.82)});border-radius:${Math.max(6, kit.radius - 4)}px;display:flex;align-items:center;justify-content:center;"><span style="font-family:${kit.headingFont};font-weight:700;font-size:14px;color:${kit.primary};text-align:center;padding:12px;">${txt(r.title)}</span></div>`;
      return `<a class="fg-related-link" href="${esc(r.url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;background:${kit.surface};border:1px solid ${tint(kit.primary, 0.82)};border-radius:${kit.radius}px;overflow:hidden;transition:box-shadow .2s;">
  ${img}
  <div style="padding:14px 16px;">
    <span style="font-family:${kit.headingFont};font-weight:700;font-size:15px;line-height:1.35;color:${kit.text};display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${txt(r.title)}</span>
  </div>
</a>`;
    });

    parts.push(`<section class="fg-related" style="margin:40px 0 0;padding-top:28px;border-top:2px solid ${tint(kit.primary, 0.82)};">
  <h3 style="margin:0 0 18px;font-family:${kit.headingFont};font-size:clamp(18px,2.6vw,22px);font-weight:700;color:${kit.text};">Keep Reading</h3>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px;">
  ${cards.join('\n')}
  </div>
</section>`);
  }

  // --- Brand CTA bar ----------------------------------------------------
  const siteUrl = meta.siteUrl ? String(meta.siteUrl).replace(/\/+$/, '') : '';
  if (siteUrl) {
    parts.push(`<section style="margin:36px 0 0;padding:clamp(20px,4vw,32px);background:linear-gradient(135deg, ${kit.band}, ${shade(kit.band, 0.82)});border-radius:${kit.radius}px;text-align:center;">
  <p style="margin:0 0 14px;font-family:${kit.headingFont};font-size:clamp(17px,2.4vw,22px);font-weight:700;color:#fff;">Explore more from ${esc(meta.brandName || '')}</p>
  <a href="${esc(siteUrl)}" target="_blank" rel="noopener" class="fg-btn" style="display:inline-block;padding:12px 28px;border-radius:${kit.radius}px;font-family:${kit.headingFont};font-weight:700;font-size:15px;text-decoration:none;background:#fff;color:${kit.band};box-shadow:0 4px 14px rgba(0,0,0,.15);">Visit Our Shop</a>
</section>`);
  }

  return parts.length ? `\n${parts.join('\n')}\n` : '';
}

// ---------------------------------------------------------------------------
// Block → HTML (the full branded article body)
// ---------------------------------------------------------------------------
function renderBlock(block: VisualBlock, kit: BlogStyleKit, brand?: Pick<Brand, 'primaryColor' | 'blogStyle' | 'name' | 'slug'> | null): string {
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
    case 'daniels_tip': return renderDanielsTip(block, kit, brand);
    case 'newsletter': return ''; // Newsletter block removed — no longer rendered
    case 'paragraph':
    default: return renderParagraph(block, kit);
  }
}

/**
 * Deterministic scoped-class hash (FNV-1a) derived from the style kit + the
 * rendered block list. The SAME article + brand ALWAYS renders the same
 * `fg-art-{scope}` class across preview, save, re-sync and WordPress push, so:
 *  - the scoped <style> block never gets orphaned by a re-push;
 *  - editor preview and the live page stay byte-stable (diff-friendly);
 *  - different articles still get their own scope (no cross-article CSS bleed).
 */
function stableScope(blocks: VisualBlock[] | undefined, kit: BlogStyleKit): string {
  const seed = [
    kit.primary, kit.accent, kit.band, kit.headingFont, kit.bodyFont, kit.text,
    (blocks || []).map((b) => `${b.type}:${b.title || ''}:${(b.imageUrl || '').slice(0, 120)}`).join('|'),
  ].join('§');
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Serialise the full block list into the branded, responsive article body.
 *  Optional `meta` renders the article frame (byline/date, share buttons,
 *  author box, footer CTA and related strip) around the blocks — used on the
 *  WordPress push path; the editor preview passes no meta and stays frameless. */
export function blocksToHtml(
  blocks: VisualBlock[] | undefined,
  brand?: Pick<Brand, 'primaryColor' | 'blogStyle' | 'name' | 'slug'> | null,
  meta?: ArticleFrameMeta,
): string {
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
  const scope = stableScope(list, kit);
  const head = frameHead(kit, meta, estimateReadMins(list));
  const foot = frameFoot(kit, meta);
  return `<div class="fg-art fg-art-${scope}" style="font-family:${kit.bodyFont} !important;color:${kit.text} !important;line-height:1.7 !important;max-width:800px !important;margin:0 auto !important;padding:0 !important;box-sizing:border-box !important;background:transparent !important;">
${scopedStyles(scope, kit)}
${head}
${list.map((b) => renderBlock(b, kit, brand)).join('\n\n')}
${foot}
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
  brand?: Pick<Brand, 'primaryColor' | 'blogStyle' | 'name' | 'slug'> | null,
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

/**
 * Rebuild the image markers inside bodyHtml for the given block list.
 * Existing markers are replaced/removed in place; new ones are appended
 * at the end of the article so nothing else in the HTML is touched.
 * Shared by the editor and the Content Hub so the WordPress payload
 * serialisation stays identical everywhere.
 */
export function syncImageMarkers(blocks: VisualBlock[] | undefined, html: string | undefined): string {
  const imageBlocks = (blocks || []).filter((b) => b.type === 'image_banner' && (b.imageUrl || '').trim());
  let out = html || '';

  imageBlocks.forEach((b) => {
    const src = (b.imageUrl || '').trim();
    const markerRe = new RegExp(`<!--image:${b.id}-->[\\s\\S]*?<!--\\/image:${b.id}-->`);
    if (markerRe.test(out)) {
      out = out.replace(markerRe, figureHtmlFor(b));
    } else {
      // Strip any bare <img> paragraph the HTML editor's Quill sanitizer left
      // behind for this image (it drops <figure>/markers), then append fresh.
      const escaped = src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`<p[^>]*>\\s*<img[^>]*src\\s*=\\s*["']${escaped}["'][^>]*>\\s*<\\/p>`, 'g'), '');
      out = `${out.replace(/\s*$/, '')}\n${figureHtmlFor(b)}`;
    }
  });

  // Drop markers whose image blocks no longer exist (or lost their image).
  const keepIds = new Set(imageBlocks.map((b) => b.id));
  const orphanRe = /<!--image:[\s\S]*?-->\s*<figure[\s\S]*?<\/figure>\s*<!--\/image:[\s\S]*?-->/g;
  out = out.replace(orphanRe, (match) => {
    const idMatch = match.match(/<!--image:([\s\S]*?)-->/);
    return idMatch && !keepIds.has(idMatch[1]) ? '' : match;
  });

  return out;
}
