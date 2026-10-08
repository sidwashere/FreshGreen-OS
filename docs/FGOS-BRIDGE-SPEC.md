# FGOS Bridge — Specification

**Status:** draft for review
**Owner:** FGOS
**Replaces:** FGOS's current "push fully-inlined HTML into `post_content`" approach

---

## 1. The problem

FGOS currently emits the entire article as **inlined HTML** — a `style="…"` attribute on
almost every element plus a scoped `<style>` block (`.fg-art-<scope>`) containing the
article frame (byline, share bar, author box, related posts, newsletter CTA).

Verified consequences on a live Elementor site:

| Problem | Cause |
|---|---|
| Post is not editable in Elementor | No `_elementor_data` — Elementor sees raw HTML |
| Theme chrome fights the article | Inline styles compete with theme/Elementor CSS; the theme's `.page-header` / `.page-content` column constrains the article |
| Styles vanish silently for lower roles | `wp_kses()` strips `<style>` for any role without `unfiltered_html` |
| Brand restyle means re-pushing everything | Styling is per-post, not site-wide |
| Images/fonts can overflow | No shared responsive rule set; each post's inline styles are ad hoc |

The SEOWriting WordPress plugin solves this with a different division of responsibility:
**semantic classes in the content, one swappable stylesheet for the design system, and
native Elementor containers for structure.**

FGOS Bridge adopts that model — with two hard requirements SEOWriting does not have:
it must work on **non-Elementor** sites, and it must **inherit the theme** rather than
override it.

---

## 2. Goals

1. Published FGOS articles **inherit** the site's existing theme layout, typography and
   colours rather than fighting them.
2. Articles are **natively editable in Elementor** when Elementor is available.
3. **Works unchanged** on non-Elementor sites and themes (classic, block, page builders).
4. **Per-site switchable implementation** — the owner can flip modes in the plugin UI.
5. Articles can be made to **match an existing page layout** (e.g. the "Our Blog" page)
   by probing that page for design tokens.
6. FGOS remains the single source of truth for content; WordPress holds nothing FGOS
   can't reproduce.

## 3. Non-goals

- Not a theme or a page builder.
- Not a replacement for Elementor Global Styles — it defers to them.
- No SaaS dependency. FGOS pushes directly to the site's own endpoint.

---

## 4. Modes (per-site switch)

The plugin stores one setting, `fgos_mode`, with three values. This is the
"switchable feature to change the implementation".

| Mode | Behaviour | Requires Elementor |
|---|---|---|
| `elementor` | Convert article HTML into native Elementor containers/widgets and write `_elementor_data`. The article becomes fully editable and responsive via Elementor. | Yes |
| `html` | Write clean semantic HTML to `post_content` and enqueue the scoped design-system stylesheet on that post only. | No |
| `auto` *(default)* | If Elementor is active → `elementor`. Otherwise → `html`. | — |

Resolution order at publish time:

```
configured = get_option('fgos_mode', 'auto')
effective  = (configured === 'auto')
              ? (elementor_is_active() ? 'elementor' : 'html')
              : configured
```

If `elementor` is configured but Elementor is inactive, the publish **falls back to
`html`** and logs a warning. It never silently produces a broken post.

`elementor` mode also has a sub-switch, `fgos_split_blocks` (on/off), matching the
reference plugin's block-splitting behaviour. When off, the whole article lands in a
single `text-editor` widget — useful for very long articles where deep nesting hurts
Elementor's performance.

---

## 5. The theme-inheritance contract

This is the part that most directly addresses *"retaining the existing theme layouts,
styles and colours and fonts."*

### 5.1 Everything is scoped

All plugin CSS is emitted under a per-post root class:

```html
<div class="fgos-article fgos-article--<postId>">
   …article…
</div>
```

The stylesheet never contains an unscoped element selector that could reach theme
chrome. Header, footer, nav, sidebar, buttons in the theme — all untouched.

The class is also added to the `<body>` as `fgos-post-<postId>` so themes can hook it,
and to the wrapper only for FGOS-authored posts.

### 5.2 Inherit by default, override explicitly

The design system does **not** hard-code fonts or colours. It declares custom
properties whose defaults are `inherit`, so an article with no brand configuration
renders using whatever the theme already does:

```css
.fgos-article {
  font-family: inherit;          /* theme wins */
  font-size:   inherit;
  line-height: var(--fgos-line-height, inherit);
  color:       inherit;          /* theme wins */

  --fgos-font-heading:   inherit;
  --fgos-color-heading:  inherit;
  --fgos-color-body:     inherit;
  --fgos-color-primary:  inherit;
  --fgos-color-muted:    inherit;
  --fgos-radius:         8px;
  --fgos-gap:            24px;
  --fgos-measure:        68ch;   /* readable measure, theme may override */
}
```

Any of those can be set per site in the plugin UI, or per post via Elementor
Global Styles when in `elementor` mode.

### 5.3 Cascade order

Later wins. The bridge never uses `!important` on typography or colour.

```
theme CSS  →  Elementor Global Styles  →  plugin token defaults (inherit)  →  per-site brand tokens  →  per-post overrides
```

In `elementor` mode the article is built from containers, so Elementor's own responsive
rules apply — which is the main reason the layout stops breaking.

### 5.4 Responsive rules that protect layout

Always present, brand-independent, and deliberately conservative:

```css
.fgos-article img,
.fgos-article video,
.fgos-article iframe,
.fgos-article table { max-width: 100%; }

.fgos-article img,
.fgos-article video { height: auto; }

.fgos-article table { display: block; overflow-x: auto; }  /* never overflows the column */
```

Tables scroll rather than break the page — this is the single most common layout
failure in blog content.

---

## 6. Matching an existing page layout (theme probe)

To make FGOS articles match a page the owner already likes (e.g. "Our Blog"), the
plugin can **probe a reference page** and read its computed design, then use those
values as the article's token defaults.

Settings: `fgos_reference_post_id` (any post or page ID).

The probe reads, via `get_post_meta` + `wp_get_global_settings` where available:

| Token | Source | Fallback |
|---|---|---|
| `--fgos-font-heading` | Elementor Global Settings `system_typography` / `global_typography`, else the page's first heading font-family | `inherit` |
| `--fgos-color-heading` | Elementor Global Colors `primary`/`secondary`/`text`, else computed heading colour | `inherit` |
| `--fgos-color-body` | Global Colors `text` | `inherit` |
| `--fgos-color-primary` | Global Colors `primary` | `inherit` |
| `--fgos-measure` | template `content_width` in px (Elementor) → `ch` | `68ch` |
| `--fgos-gap` | Global Spacing `section_gap` | `24px` |
| `--fgos-radius` | Global Colors / template corner radius | `8px` |

**On a non-Elementor site the probe degrades gracefully:** it reads the theme's own
`get_stylesheet()` for declared `--wp--preset--*` custom properties (core block themes
expose these) and falls back to `inherit` otherwise.

The probe result is cached per-site in `fgos_tokens` and refreshable from the settings
screen with a button. It is a **convenience**, not a dependency — if the probe fails the
article still renders on theme defaults.

---

## 7. The component vocabulary

FGOS's block types map to stable classes, so the design system owns the look and the
content stays semantic. This is the same idea as the reference plugin's
`styled-container` vocabulary, adapted to FGOS's own block set.

| FGOS block | Emitted markup | Design-system class |
|---|---|---|
| `hero` | `<div><img><figcaption>` | `.fgos-hero`, `.fgos-hero__img` |
| `paragraph` | `<p>` | — |
| `heading` | `<h2>`/`<h3>` | `.fgos-h2`, `.fgos-h3` |
| `cards` | `<div><article><img><h3><p><a>` | `.fgos-cards`, `.fgos-card` |
| `carousel` | `<div><figure>…` | `.fgos-carousel`, `.fgos-carousel__track` |
| `quote` | `<blockquote><cite>` | `.fgos-quote`, `.fgos-quote__cite` |
| `cta_band` | `<div><p><a>` | `.fgos-cta`, `.fgos-cta__btn` |
| `product_cta` | `<div><img><h3><p><a>` | `.fgos-products`, `.fgos-product` |
| `faq` | `<section><h2><details>` | `.fgos-faq`, `.fgos-faq__item` |
| `image_banner` | `<figure><img><figcaption>` | `.fgos-figure`, `.fgos-figure__caption` |
| `table` | `<div><table>` | `.fgos-table-wrap` |
| `callout` | `<aside>` | `.fgos-callout` (+ `--info/--warn/--key`) |
| `toc` | `<nav><ol>` | `.fgos-toc` |
| `key_takeaways` | `<div><ul>` | `.fgos-takeaways` |
| grid layout | wrapper | `.fgos-cols-2`, `.fgos-cols-3`, `.fgos-auto-cols` |

Unknown/legacy blocks fall through to a `text-editor` widget with their HTML intact, so
nothing is ever lost.

---

## 8. HTML → Elementor conversion

Used **only** in `elementor` mode.

The converter walks the DOM and builds Elementor's `_elementor_data` JSON array.

| Source | Result |
|---|---|
| `<img>` | `image` widget — `image.url`, `image.alt` |
| `<h1>`–`<h6>` | `heading` widget — `title`, `header_size` = tag |
| `<a>` (no element children) | `button` widget — `text`, `link.url`, `link.nofollow`, `link.is_external` |
| `<p> <ul> <ol> <table> <blockquote> <iframe> <details> <aside>` | `text-editor` widget with inner HTML preserved verbatim |
| `<div> <section> <article> <figure>` | `container` |
| `class` attribute | `settings.css_classes` — **so FGOS classes reach Elementor and the stylesheet applies inside Elementor too** |
| `.fgos-cols-2 / .fgos-cols-3 / .fgos-auto-cols` | `container_type: grid` + grid columns |
| `<style>` | **dropped** |
| root container | `content_width: full` |

Also written:

```
_elementor_edit_mode     = builder
_elementor_template_type = wp-post
_elementor_version       = <active Elementor version>
_elementor_data          = <JSON>
```

Post-processing: empty containers are pruned so Elementor's navigator stays usable, and
nesting is depth-capped (default 12) to avoid pathological trees.

### 9.1 Why a plugin is required

`_elementor_data` is **protected post meta** (leading `_`). WordPress REST does not
allow a client to write it. There is no REST-only route to a natively-editable Elementor
post. A plugin or mu-plugin is therefore not optional — it is the only path.

FGOS Bridge is a normal plugin (not mu-plugin) so it is versioned, upgradable and
visible in the admin.

---

## 10. Security

- Webhook requires a shared secret and an HMAC signature over the canonicalised payload
  (`ksort`, arrays reduced to a constant, then `hash_hmac('sha256', implode('|', …))`).
- Signature compared with `hash_equals`.
- `Content-Type: application/json` enforced.
- All content passes `wp_kses( …, wp_kses_allowed_html('post') )` before storage —
  this is deliberate and is why the design system lives in a stylesheet rather than a
  per-post `<style>` tag.
- The REST route is `permission_callback => '__return_true'` because auth is the HMAC,
  matching the reference implementation's pattern.

---

## 11. Settings (per site)

| Key | Default | Purpose |
|---|---|---|
| `fgos_mode` | `auto` | `elementor` \| `html` \| `auto` |
| `fgos_split_blocks` | `1` | Deep block splitting in elementor mode |
| `fgos_reference_post_id` | `0` | Page whose layout is matched |
| `fgos_tokens` | `[]` | Cached probe result |
| `fgos_css` | built-in | Optional site-wide CSS override/addition |
| `fgos_secret` | generated | HMAC secret |
| `fgos_enabled` | `1` | Master switch |

Admin screen (`Settings → FGOS Bridge`):
- Mode selector with a live explanation of what each mode will do
- Elementor availability indicator (so `elementor` mode can be chosen deliberately)
- Reference page picker (searchable)
- "Re-probe theme tokens" button
- Token override fields (prefilled from the probe)
- Brand CSS textarea
- Copy-paste FGOS webhook URL + secret, and a **test connection** button

---

## 12. FGOS → bridge contract

FGOS calls the bridge instead of `POST /wp/v2/posts` when the bridge is enabled.

```
POST {wpUrl}/wp-json/fgos/v1/publish
Content-Type: application/json

{
  "secret":  "<shared secret>",
  "sign":    "<hmac>",
  "action":  "publish" | "update" | "delete",
  "post_id": 1234,                  // present for update/delete
  "post_type": "post",
  "theme":  "Article title",
  "html":   "<div class=\"fgos-article\">…</div>",
  "description": "meta description",
  "main_keyword": "focus keyphrase",
  "keywords": ["…"],
  "category": "12,18",
  "tags": ["…"],
  "post_slug": "article-slug",
  "post_time": 1767225600,
  "publish": 1,
  "excerpt": 1,
  "author_id": 2,
  "featured_image": "https://…/hero.webp",
  "fgos_meta": { "blogNumber": "DTP021", "brandId": "…" }
}
```

Response: `{ "result": 1, "post_id": 1234, "url": "https://…", "mode": "elementor" }`.

FGOS keeps using the existing REST path as a fallback when the bridge is not installed
or not connected, so existing sites keep working untouched.

---

## 13. Migration plan

Each stage is independently shippable and testable on the `staging` branch first.

| Stage | Change | Reversible |
|---|---|---|
| **1** | Ship the plugin in `html` mode with the scoped stylesheet. No FGOS changes. Re-publish one article and compare against the current live output. | Yes — mode toggle |
| **2** | FGOS emitter (`blogHtml.ts`) switches from inline styles to semantic classes. Article body carries `.fgos-article` + component classes. | Yes — FGOS emits legacy inlined HTML when the flag is off |
| **3** | Enable `elementor` mode on Elementor sites. Posts become natively editable. | Yes — mode toggle |
| **4** | Theme probe on. Articles match the reference page's tokens. | Yes — clear cached tokens |
| **5** | Retire the per-post `<style>` block entirely. | No — but nothing depends on it |

`fgos_mode` is the single switch that makes every stage reversible at runtime, without a
deploy.

---

## 14. Acceptance criteria

1. Plugin activates on a site with **no Elementor** and no fatal errors; `auto` resolves
   to `html`.
2. An FGOS-published post in `html` mode shows the design-system components and
   **leaves the theme header, footer, nav and sidebar visually unchanged**.
3. An FGOS-published post in `elementor` mode opens in Elementor and every component is
   a native widget that can be dragged and re-styled.
4. Turning Elementor off on an `elementor`-mode site does not break publishing; it falls
   back to `html` and logs a warning.
5. No article-level `<style>` block is present in any mode.
6. A 1200px-wide image inside a narrow column does not overflow; a wide table scrolls.
7. With all brand tokens left blank, the article's font-family and body colour match the
   surrounding theme's computed values.
8. With the reference page set to "Our Blog", the article's heading colour, body measure
   and spacing match that page within a 2px / 1 colour-unit tolerance.
9. Re-publishing the same item updates the existing post — it does not create a duplicate.
10. Switching `fgos_mode` changes the rendering of a **newly published** post with no
    code deploy and no change to previously published posts.

---

## 15. Open questions

1. Should the design system ship as a stylesheet in the plugin, or be pushed from FGOS
   per brand so each brand's components live in FGOS? (Recommend: ship in plugin, allow
   per-brand override via `fgos_css`.)
2. Should FGOS keep its existing article **frame** (byline, share, author box, related
   posts, newsletter) inside `.fgos-article`, or move it to Elementor theme-builder
   locations so the theme owns it? (Recommend: frame stays in the article for portability,
   but becomes optional per brand.)
3. For `elementor` mode, should the theme's single-post template be overridden to a
   full-width canvas, or left alone with the article self-centring? (Recommend: leave the
   template alone — FGOS articles should not change how the site is configured.)