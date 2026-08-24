<?php
/**
 * Template Name: DTP Blog Post
 * Description: Single blog post template for Daniel's Tasty Petfoods.
 *              Provides full DTP design system (fonts, colours, layout)
 *              so post content only needs h2/h3/p/img — no fg-art wrapper.
 *
 * INSTALLATION:
 *   1. Copy this file into: wp-content/themes/hello-elementor/
 *      (or into your child theme directory)
 *   2. In WP Admin → Posts → edit any post → in the right sidebar
 *      under "Post Attributes" → set Template → "DTP Blog Post"
 *   3. The app can then push clean article HTML without the fg-art wrapper
 */

get_header('elementor');
global $post;
?>

<style>
/* ═══════════════════════════════════════════════════════════════════════════
   DTP Blog Post Template — Design System
   Jost (headings) | Cormorant Garamond (display) | Roboto (body)
   Dark Green #203B32 | Gold #C9A24A | Text #2D3748 | Muted #718096
   ═══════════════════════════════════════════════════════════════════════════ */

/* --- Reset elementor interference for our article wrapper --- */
.dtp-blog-template .elementor-widget-container,
.dtp-blog-template .elementor-widget-wrap,
.dtp-blog-template .elementor-column-gap-default,
.dtp-blog-template .e-con {
  all: unset;
}

.dtp-blog-template {
  --dtp-dark: #203B32;
  --dtp-gold: #C9A24A;
  --dtp-text: #2D3748;
  --dtp-muted: #718096;
  --dtp-surface: #f8faf6;
  --dtp-border: #e2ead9;
  font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif;
  color: var(--dtp-text);
  line-height: 1.7;
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px;
  box-sizing: border-box;
}

.dtp-blog-template *,
.dtp-blog-template *::before,
.dtp-blog-template *::after {
  box-sizing: border-box;
}

/* --- Post Title --- */
.dtp-blog-title {
  font-family: 'Jost', 'Helvetica Neue', Arial, sans-serif;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 800;
  line-height: 1.15;
  color: #111;
  margin: 0 0 0.6em;
  padding: 0;
}

/* --- Hero Image --- */
.dtp-blog-hero {
  position: relative;
  width: 100%;
  min-height: clamp(280px, 40vw, 480px);
  display: flex;
  align-items: flex-end;
  border-radius: 12px;
  overflow: hidden;
  margin: 0 0 32px;
}
.dtp-blog-hero img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.dtp-blog-hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 50%, rgba(0,0,0,.12) 100%);
}
.dtp-blog-hero-text {
  position: relative;
  z-index: 1;
  padding: clamp(24px, 5vw, 48px);
  color: #fff;
  width: 100%;
}
.dtp-blog-badge {
  display: inline-block;
  background: var(--dtp-gold);
  color: #3c3116;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  padding: 5px 12px;
  border-radius: 999px;
  margin-bottom: 14px;
}

/* --- Byline --- */
.dtp-blog-byline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 0 28px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--dtp-border);
}
.dtp-blog-byline-text {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: .02em;
  color: var(--dtp-muted);
}

/* --- Share Buttons --- */
.dtp-blog-share {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 0;
}
.dtp-share-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  text-decoration: none;
  background: var(--dtp-surface);
  color: var(--dtp-gold);
  border: 1px solid var(--dtp-border);
  transition: all .2s;
}
.dtp-share-btn:hover {
  background: var(--dtp-gold) !important;
  color: #fff !important;
  border-color: var(--dtp-gold) !important;
}

/* --- Content Typography --- */
.dtp-blog-content h2,
.dtp-blog-content h3,
.dtp-blog-content h4,
.dtp-blog-content h5 {
  font-family: 'Jost', 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  color: var(--dtp-text);
}
.dtp-blog-content h2 {
  font-size: clamp(22px, 3.2vw, 30px);
  line-height: 1.25;
  margin: 36px 0 16px;
}
.dtp-blog-content h3 {
  font-size: clamp(18px, 2.6vw, 24px);
  line-height: 1.3;
  margin: 28px 0 12px;
}
.dtp-blog-content h4 {
  font-size: clamp(16px, 2vw, 20px);
  line-height: 1.35;
  margin: 24px 0 10px;
}
.dtp-blog-content p {
  margin: 0 0 20px;
  font-size: 17px;
  line-height: 1.75;
  color: var(--dtp-text);
}
.dtp-blog-content a {
  color: var(--dtp-gold);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.dtp-blog-content a:hover {
  color: var(--dtp-dark);
}
.dtp-blog-content img {
  max-width: 100%;
  height: auto;
  border-radius: 12px;
}
.dtp-blog-content figure {
  margin: 1.5em 0;
  text-align: center;
}
.dtp-blog-content figcaption {
  font-size: 0.85em;
  color: var(--dtp-muted);
  margin-top: 0.5em;
}
.dtp-blog-content ul,
.dtp-blog-content ol {
  margin: 0 0 22px;
  padding-left: 1.4em;
}
.dtp-blog-content li {
  margin-bottom: 8px;
  line-height: 1.7;
}
.dtp-blog-content blockquote {
  border-left: 4px solid var(--dtp-gold);
  margin: 1.5em 0;
  padding: 16px 24px;
  background: var(--dtp-surface);
  border-radius: 0 8px 8px 0;
  font-style: italic;
  color: var(--dtp-muted);
}
.dtp-blog-content blockquote p:last-child {
  margin-bottom: 0;
}
.dtp-blog-content strong {
  font-weight: 700;
}
.dtp-blog-content hr {
  border: none;
  border-top: 2px solid var(--dtp-border);
  margin: 2em 0;
}
.dtp-blog-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5em 0;
  font-size: 15px;
}
.dtp-blog-content th {
  background: var(--dtp-dark);
  color: #fff;
  font-family: 'Jost', sans-serif;
  font-weight: 600;
  text-align: left;
  padding: 12px 16px;
}
.dtp-blog-content td {
  padding: 10px 16px;
  border-bottom: 1px solid var(--dtp-border);
}
.dtp-blog-content tr:nth-child(even) td {
  background: var(--dtp-surface);
}

/* --- Buttons inside content --- */
.dtp-blog-content .wp-block-button__link,
.dtp-blog-content a.dtp-btn {
  display: inline-block;
  padding: 12px 28px;
  border-radius: 8px;
  font-family: 'Jost', sans-serif;
  font-weight: 700;
  font-size: 15px;
  text-decoration: none;
  background: var(--dtp-dark);
  color: #fff;
  box-shadow: 0 4px 14px rgba(0,0,0,.15);
  transition: transform .2s, box-shadow .2s;
}
.dtp-blog-content .wp-block-button__link:hover,
.dtp-blog-content a.dtp-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0,0,0,.16);
}

/* --- FAQ accordion (details/summary) --- */
.dtp-blog-content details {
  border: 1px solid var(--dtp-border);
  border-radius: 8px;
  margin-bottom: 12px;
  overflow: hidden;
}
.dtp-blog-content details > summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px;
  font-family: 'Jost', sans-serif;
  font-weight: 700;
  font-size: 16px;
  color: var(--dtp-text);
  cursor: pointer;
  list-style: none;
  background: var(--dtp-surface);
}
.dtp-blog-content details > summary::-webkit-details-marker {
  display: none;
}
.dtp-blog-content details > summary::after {
  content: '▾';
  font-size: 14px;
  color: var(--dtp-muted);
  transition: transform .2s;
}
.dtp-blog-content details[open] > summary::after {
  transform: rotate(180deg);
}
.dtp-blog-content details > div,
.dtp-blog-content details > p {
  padding: 0 18px 16px;
}

/* --- CTA Band (Explore more / Visit Our Shop) --- */
.dtp-blog-cta {
  margin: 36px 0 0;
  padding: clamp(20px, 4vw, 32px);
  background: linear-gradient(135deg, #203B32, #1a3029);
  border-radius: 8px;
  text-align: center;
}
.dtp-blog-cta p {
  margin: 0 0 14px;
  font-family: 'Jost', sans-serif;
  font-size: clamp(17px, 2.4vw, 22px);
  font-weight: 700;
  color: #fff;
}
.dtp-blog-cta a {
  display: inline-block;
  padding: 12px 28px;
  border-radius: 8px;
  font-family: 'Jost', sans-serif;
  font-weight: 700;
  font-size: 15px;
  text-decoration: none;
  background: #fff;
  color: #203B32;
  box-shadow: 0 4px 14px rgba(0,0,0,.15);
  transition: transform .2s, box-shadow .2s;
}
.dtp-blog-cta a:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 20px rgba(0,0,0,.16);
}

/* --- Related Posts --- */
.dtp-blog-related {
  margin: 48px 0 0;
  padding-top: 32px;
  border-top: 1px solid var(--dtp-border);
}
.dtp-blog-related h2 {
  font-family: 'Jost', sans-serif;
  font-size: clamp(20px, 2.8vw, 26px);
  font-weight: 700;
  color: var(--dtp-text);
  margin: 0 0 20px;
}
.dtp-blog-related-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 20px;
}
.dtp-related-card {
  display: block;
  text-decoration: none;
  background: var(--dtp-surface);
  border: 1px solid var(--dtp-border);
  border-radius: 10px;
  overflow: hidden;
  transition: box-shadow .2s;
}
.dtp-related-card:hover {
  box-shadow: 0 4px 14px rgba(15,23,42,.08);
}
.dtp-related-card img {
  display: block;
  width: 100%;
  height: 160px;
  object-fit: cover;
}
.dtp-related-card-placeholder {
  height: 160px;
  background: linear-gradient(135deg, var(--dtp-surface), var(--dtp-border));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.dtp-related-card-placeholder span {
  font-family: 'Jost', sans-serif;
  font-weight: 700;
  font-size: 14px;
  color: var(--dtp-dark);
  text-align: center;
}
.dtp-related-card-body {
  padding: 14px;
}
.dtp-related-card-body h3 {
  margin: 0 0 6px;
  font-family: 'Jost', sans-serif;
  font-weight: 600;
  font-size: 15px;
  line-height: 1.35;
  color: var(--dtp-text);
}
.dtp-related-card-body p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dtp-muted);
}

/* --- Newsletter Section --- */
.dtp-blog-newsletter {
  margin: 48px 0 0;
  padding: 40px;
  background: var(--dtp-dark);
  border-radius: 12px;
  text-align: center;
}
.dtp-blog-newsletter h2 {
  font-family: 'Jost', sans-serif;
  font-size: clamp(20px, 2.8vw, 26px);
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}
.dtp-blog-newsletter p {
  color: #c8dac8;
  font-size: 16px;
  margin: 0 0 20px;
}

/* --- Mobile Responsive --- */
@media (max-width: 768px) {
  .dtp-blog-template {
    padding: 0 16px;
  }
  .dtp-blog-hero {
    min-height: 260px;
    border-radius: 0;
  }
  .dtp-blog-hero-text {
    padding: 18px;
  }
  .dtp-blog-content img {
    float: none !important;
    width: 100% !important;
    margin: 0 0 12px !important;
  }
  .dtp-blog-related-grid {
    grid-template-columns: 1fr;
  }
  .dtp-blog-share {
    gap: 4px;
  }
  .dtp-blog-content .wp-block-button__link,
  .dtp-blog-content a.dtp-btn {
    width: 100%;
    text-align: center;
  }
}
</style>

<article id="post-<?php the_ID(); ?>" <?php post_class('dtp-blog-template'); ?>>

  <?php
  // --- Hero Image (from featured image) ---
  $hero_src = get_the_post_thumbnail_url($post->ID, 'full');
  if ($hero_src) :
    $category = '';
    $cats = get_the_category();
    if (!empty($cats)) $category = $cats[0]->name;
  ?>
  <div class="dtp-blog-hero">
    <img src="<?php echo esc_url($hero_src); ?>" alt="<?php the_title_attribute(); ?>" loading="eager" />
    <div class="dtp-blog-hero-overlay"></div>
    <div class="dtp-blog-hero-text">
      <?php if ($category) : ?>
        <span class="dtp-blog-badge"><?php echo esc_html($category); ?></span>
      <?php endif; ?>
    </div>
  </div>
  <?php endif; ?>

  <h1 class="dtp-blog-title"><?php the_title(); ?></h1>

  <?php
  // --- Byline + Share ---
  $author = 'The Daniel\'s Tasty Petfoods Team';
  $post_author = get_the_author();
  if ($post_author && $post_author !== 'admin_dtp') {
    $author = $post_author;
  }
  $date = get_the_date('F j, Y');
  $read_time = max(1, round(str_word_count(strip_tags(get_the_content())) / 238));
  ?>
  <div class="dtp-blog-byline">
    <p class="dtp-blog-byline-text">
      <?php echo esc_html($author); ?> · <?php echo esc_html($date); ?> · <?php echo esc_html($read_time); ?> min read
    </p>
    <?php
    $share_url = urlencode(get_permalink());
    $share_title = urlencode(get_the_title());
    ?>
    <div class="dtp-blog-share">
      <a class="dtp-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=<?php echo $share_url; ?>" target="_blank" rel="noopener" title="Share on Facebook">f</a>
      <a class="dtp-share-btn" href="https://twitter.com/intent/tweet?url=<?php echo $share_url; ?>&text=<?php echo $share_title; ?>" target="_blank" rel="noopener" title="Share on X">X</a>
      <a class="dtp-share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=<?php echo $share_url; ?>" target="_blank" rel="noopener" title="Share on LinkedIn">in</a>
      <a class="dtp-share-btn" href="https://wa.me/?text=<?php echo $share_title . '%20' . $share_url; ?>" target="_blank" rel="noopener" title="Share on WhatsApp">💬</a>
      <a class="dtp-share-btn" href="mailto:?subject=<?php echo $share_title; ?>&body=<?php echo $share_url; ?>" title="Share via Email">✉</a>
    </div>
  </div>

  <?php
  // --- Post Content ---
  // WordPress renders the content via the_content() with wpautop etc.
  // The Code Snippets plugin has already disabled wpautop, so raw HTML
  // passes through intact.
  ?>
  <div class="dtp-blog-content">
    <?php the_content(); ?>
  </div>

  <?php
  // --- CTA Band ---
  $brand_url = home_url('/');
  ?>
  <div class="dtp-blog-cta">
    <p>Explore more from Daniel's Tasty Petfoods</p>
    <a href="<?php echo esc_url($brand_url); ?>" target="_blank" rel="noopener">Visit Our Shop</a>
  </div>

  <?php
  // --- Related Posts ---
  $related_query = new WP_Query(array(
    'posts_per_page' => 3,
    'post__not_in' => array($post->ID),
    'post_status' => 'publish',
    'orderby' => 'date',
    'order' => 'DESC',
  ));
  if ($related_query->have_posts()) :
  ?>
  <div class="dtp-blog-related">
    <h2>Keep Reading</h2>
    <div class="dtp-blog-related-grid">
      <?php while ($related_query->have_posts()) : $related_query->the_post(); ?>
      <a class="dtp-related-card" href="<?php the_permalink(); ?>">
        <?php if (has_post_thumbnail()) : ?>
          <?php the_post_thumbnail('medium', array('loading' => 'lazy')); ?>
        <?php else : ?>
          <div class="dtp-related-card-placeholder">
            <span><?php the_title(); ?></span>
          </div>
        <?php endif; ?>
        <div class="dtp-related-card-body">
          <h3><?php the_title(); ?></h3>
          <p><?php echo wp_trim_words(get_the_excerpt(), 12); ?></p>
        </div>
      </a>
      <?php endwhile; wp_reset_postdata(); ?>
    </div>
  </div>
  <?php endif; ?>

</article>

<?php get_footer('elementor'); ?>
