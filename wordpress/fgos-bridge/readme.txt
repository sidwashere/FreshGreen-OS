=== FGOS Bridge ===
Contributors: fgos
Tags: fgos, elementor, content, seo, blog
Requires at least: 5.9
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPL-2.0-or-later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Receives FGOS articles so they inherit your theme — layout, fonts and colours — instead of pasting inline-styled HTML into a default template.

== Description ==

FGOS Bridge is the WordPress-side connector for FGOS (FreshGreen Operating System). FGOS generates
articles; this plugin decides **how they land on your site** so they look like they belong to your
theme.

**Works on Elementor sites and on non-Elementor sites.** Nothing here requires Elementor. When
Elementor is present the plugin can build a native Elementor document so the article becomes fully
editable with Elementor's own responsive containers. When it isn't, the same article publishes as
clean semantic HTML with a scoped stylesheet.

= Three render modes (switch any time, no code deploy) =

* **Auto** — Elementor if available, otherwise HTML. Default.
* **Elementor** — always native containers and widgets.
* **HTML** — always semantic HTML plus a scoped stylesheet.

If you select Elementor mode on a site where Elementor is inactive, the plugin falls back to HTML
and tells you in the admin, rather than publishing something broken.

= It inherits your theme =

The stylesheet never overrides the site. Every design token (font family, sizes, colours, measure,
radius, spacing) defaults to `inherit`, so an article with no brand configuration renders using your
theme's own typography and colour. All selectors are scoped to `.fgos-article`, so your header,
footer, navigation, sidebar and buttons are never touched.

Cascade order: theme CSS → Elementor Global Styles → token defaults → per-site overrides → per-post
overrides. The plugin never uses `!important` on typography or colour.

= Match an existing page =

Point "Match layout of" at any page or post (for example your blog index) and the plugin reads that
page's design — Elementor Global Colours and typography where available, core `--wp--preset--*` values
on block themes — then applies them to FGOS articles as scoped CSS custom properties. On non-Elementor
sites it reads the theme stylesheet instead. If nothing is found, articles simply inherit the theme.

= Layout protection =

Images, video and embeds are constrained to the column; wide tables scroll instead of breaking the
page; long words wrap inside grid cells; grids collapse on small screens; carousels snap.

= SEO meta =

Writes title, meta description and focus keyphrase to whichever SEO plugin is active: Yoast, Rank
Math, All in One SEO, SEOPress and Squirrly. Also supports featured images, categories, tags, slugs,
scheduling and post types.

== Installation ==

1. Upload the `fgos-bridge` folder to `/wp-content/plugins/`.
2. Activate the plugin.
3. Go to **Settings → FGOS Bridge**.
4. Choose a render mode (Auto is fine to start).
5. Optionally set "Match layout of" to your blog page and press **Re-probe theme tokens**.
6. Copy the webhook URL and shared secret into FGOS.

== Frequently Asked Questions ==

= Do I need Elementor? =

No. The plugin is fully functional on non-Elementor sites, including classic and block themes.

= Will this change how my theme displays? =

No. The stylesheet is scoped to FGOS articles only and every token defaults to `inherit`. Existing
pages, posts and templates are untouched.

= Can I switch modes after publishing? =

Yes, at any time. The change applies to newly published or re-published articles. Existing posts keep
what they were rendered with.

= What happens to my content if I uninstall? =

Nothing is deleted except the bridge's own settings. FGOS-authored posts stay exactly as they are.

== Changelog ==

= 0.1.0 =
* Initial release: signed webhook, three render modes, HTML→Elementor converter, theme-token probe,
  scoped inherit-by-default design system, per-site settings.