/**
 * DTP Blog Post Template — Self-Contained Code Snippet
 *
 * Registers "DTP Blog Post" template with the full DTP design system
 * (Jost/Cormorant Garamond/Roboto, DTP colours, hero, byline, share
 * buttons, related posts, CTA band). No file upload needed — just paste
 * into WP Admin → Snippets → Add New → activate.
 *
 * After activating:
 *   Posts → Edit post → Post Attributes → Template → "DTP Blog Post"
 *   OR set it as default for all new posts in the app's sync settings.
 */

// ── 1. Register the template name in WordPress ─────────────────────────
add_filter('theme_page_templates', function ($templates) {
    $templates['dtp-blog'] = 'DTP Blog Post';
    return $templates;
});

// ── 2. When that template is selected, render our full template inline ──
add_filter('template_include', function ($template) {
    if (!is_singular() || !is_page_template('dtp-blog')) {
        return $template;
    }

    global $post;

    // Helper: estimated read time
    $word_count = str_word_count(strip_tags(get_the_content()));
    $read_time  = max(1, round($word_count / 238));

    // Author fallback
    $author = 'The Daniel\'s Tasty Petfoods Team';
    $post_author = get_the_author();
    if ($post_author && $post_author !== 'admin_dtp') {
        $author = $post_author;
    }
    $date      = get_the_date('F j, Y');
    $hero_src  = get_the_post_thumbnail_url($post->ID, 'full');
    $share_url = urlencode(get_permalink());
    $share_title = urlencode(get_the_title());

    // Category badge
    $cats = get_the_category();
    $category = !empty($cats) ? $cats[0]->name : '';

    // Related posts (exclude current)
    $related_query = new WP_Query(array(
        'posts_per_page' => 3,
        'post__not_in'   => array($post->ID),
        'post_status'    => 'publish',
        'orderby'        => 'date',
        'order'          => 'DESC',
    ));

    // Start output buffering — we'll inject a full page
    ob_start();
    ?>
    <!DOCTYPE html>
    <html <?php language_attributes(); ?>>
    <head>
        <meta charset="<?php bloginfo('charset'); ?>">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <?php wp_head(); ?>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Jost:wght@400;500;600;700;800&family=Roboto:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
        /* ═══════════════════════════════════════════════════════════════════
           DTP Blog Post Template — Complete Design System
           ═══════════════════════════════════════════════════════════════════ */
        *, *::before, *::after { box-sizing: border-box; }
        body {
            margin: 0; padding: 0;
            font-family: 'Roboto', 'Helvetica Neue', Arial, sans-serif;
            color: #2D3748; line-height: 1.7;
        }

        /* --- Header (DTP nav) --- */
        .dtp-nav {
            background: #203B32; padding: 0 30px; display: flex;
            align-items: center; justify-content: space-between;
            height: 72px; position: sticky; top: 0; z-index: 100;
        }
        .dtp-nav img { height: 40px; width: auto; }
        .dtp-nav-links { display: flex; gap: 28px; list-style: none; margin: 0; padding: 0; }
        .dtp-nav-links a {
            color: #fff; font-family: 'Jost', sans-serif; font-size: 15px;
            font-weight: 500; text-transform: uppercase; text-decoration: none;
            transition: color .2s;
        }
        .dtp-nav-links a:hover { color: #C9A24A; }

        /* --- Article Container --- */
        .dtp-article {
            max-width: 800px; margin: 0 auto; padding: 0 20px;
            font-family: 'Roboto', sans-serif; color: #2D3748;
        }

        /* --- Hero Image --- */
        .dtp-hero {
            position: relative; width: 100%; min-height: clamp(280px,40vw,480px);
            display: flex; align-items: flex-end; border-radius: 12px;
            overflow: hidden; margin: 0 0 32px;
        }
        .dtp-hero img {
            position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
        }
        .dtp-hero-overlay {
            position: absolute; inset: 0;
            background: linear-gradient(to top, rgba(0,0,0,.72) 0%, rgba(0,0,0,.35) 50%, rgba(0,0,0,.12) 100%);
        }
        .dtp-hero-text {
            position: relative; z-index: 1; padding: clamp(24px,5vw,48px);
            color: #fff; width: 100%;
        }
        .dtp-badge {
            display: inline-block; background: #C9A24A; color: #3c3116;
            font-size: 12px; font-weight: 800; letter-spacing: .08em;
            text-transform: uppercase; padding: 5px 12px; border-radius: 999px;
        }

        /* --- Title --- */
        .dtp-title {
            font-family: 'Jost', sans-serif; font-size: clamp(1.8rem,4vw,2.6rem);
            font-weight: 800; line-height: 1.15; color: #111; margin: 0 0 0.6em;
        }

        /* --- Byline + Share --- */
        .dtp-byline {
            display: flex; align-items: center; justify-content: space-between;
            flex-wrap: wrap; gap: 8px; margin: 0 0 28px;
            padding-bottom: 18px; border-bottom: 1px solid #e2ead9;
        }
        .dtp-byline-text {
            margin: 0; font-size: 13.5px; font-weight: 600;
            letter-spacing: .02em; color: #718096;
        }
        .dtp-share { display: inline-flex; align-items: center; gap: 6px; }
        .dtp-share-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 28px; height: 28px; border-radius: 999px;
            font-size: 11px; font-weight: 800; text-decoration: none;
            background: #f8faf6; color: #C9A24A; border: 1px solid #e2ead9;
            transition: all .2s;
        }
        .dtp-share-btn:hover {
            background: #C9A24A !important; color: #fff !important;
            border-color: #C9A24A !important;
        }

        /* --- Content Typography --- */
        .dtp-content h2 {
            font-family: 'Jost', sans-serif; font-weight: 700; color: #2D3748;
            font-size: clamp(22px,3.2vw,30px); line-height: 1.25;
            margin: 36px 0 16px;
        }
        .dtp-content h3 {
            font-family: 'Jost', sans-serif; font-weight: 700; color: #2D3748;
            font-size: clamp(18px,2.6vw,24px); line-height: 1.3;
            margin: 28px 0 12px;
        }
        .dtp-content p {
            margin: 0 0 20px; font-size: 17px; line-height: 1.75; color: #2D3748;
        }
        .dtp-content a { color: #C9A24A; text-decoration: underline; text-underline-offset: 2px; }
        .dtp-content a:hover { color: #203B32; }
        .dtp-content img { max-width: 100%; height: auto; border-radius: 12px; }
        .dtp-content figure { margin: 1.5em 0; text-align: center; }
        .dtp-content figcaption { font-size: 0.85em; color: #718096; margin-top: 0.5em; }
        .dtp-content ul, .dtp-content ol { margin: 0 0 22px; padding-left: 1.4em; }
        .dtp-content li { margin-bottom: 8px; line-height: 1.7; }
        .dtp-content blockquote {
            border-left: 4px solid #C9A24A; margin: 1.5em 0; padding: 16px 24px;
            background: #f8faf6; border-radius: 0 8px 8px 0;
            font-style: italic; color: #718096;
        }
        .dtp-content strong { font-weight: 700; }
        .dtp-content hr { border: none; border-top: 2px solid #e2ead9; margin: 2em 0; }
        .dtp-content table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 15px; }
        .dtp-content th {
            background: #203B32; color: #fff; font-family: 'Jost', sans-serif;
            font-weight: 600; text-align: left; padding: 12px 16px;
        }
        .dtp-content td { padding: 10px 16px; border-bottom: 1px solid #e2ead9; }
        .dtp-content tr:nth-child(even) td { background: #f8faf6; }
        .dtp-content details {
            border: 1px solid #e2ead9; border-radius: 8px; margin-bottom: 12px; overflow: hidden;
        }
        .dtp-content details > summary {
            display: flex; align-items: center; justify-content: space-between;
            padding: 15px 18px; font-family: 'Jost', sans-serif; font-weight: 700;
            font-size: 16px; color: #2D3748; cursor: pointer; list-style: none;
            background: #f8faf6;
        }
        .dtp-content details > summary::-webkit-details-marker { display: none; }
        .dtp-content details > summary::after { content: '\25BE'; font-size: 14px; color: #718096; }
        .dtp-content details[open] > summary::after { transform: rotate(180deg); }

        /* --- CTA Band --- */
        .dtp-cta {
            margin: 36px 0 0; padding: clamp(20px,4vw,32px);
            background: linear-gradient(135deg, #203B32, #1a3029);
            border-radius: 8px; text-align: center;
        }
        .dtp-cta p {
            margin: 0 0 14px; font-family: 'Jost', sans-serif;
            font-size: clamp(17px,2.4vw,22px); font-weight: 700; color: #fff;
        }
        .dtp-cta a {
            display: inline-block; padding: 12px 28px; border-radius: 8px;
            font-family: 'Jost', sans-serif; font-weight: 700; font-size: 15px;
            text-decoration: none; background: #fff; color: #203B32;
            box-shadow: 0 4px 14px rgba(0,0,0,.15); transition: transform .2s, box-shadow .2s;
        }
        .dtp-cta a:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,.16); }

        /* --- Related Posts --- */
        .dtp-related { margin: 48px 0 0; padding-top: 32px; border-top: 1px solid #e2ead9; }
        .dtp-related h2 {
            font-family: 'Jost', sans-serif; font-size: clamp(20px,2.8vw,26px);
            font-weight: 700; color: #2D3748; margin: 0 0 20px;
        }
        .dtp-related-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px;
        }
        .dtp-related-card {
            display: block; text-decoration: none; background: #f8faf6;
            border: 1px solid #e2ead9; border-radius: 10px; overflow: hidden;
            transition: box-shadow .2s;
        }
        .dtp-related-card:hover { box-shadow: 0 4px 14px rgba(15,23,42,.08); }
        .dtp-related-card img { display: block; width: 100%; height: 160px; object-fit: cover; }
        .dtp-related-card-body { padding: 14px; }
        .dtp-related-card-body h3 {
            margin: 0 0 6px; font-family: 'Jost', sans-serif; font-weight: 600;
            font-size: 15px; line-height: 1.35; color: #2D3748;
        }
        .dtp-related-card-body p { margin: 0; font-size: 13px; line-height: 1.5; color: #718096; }

        /* --- Newsletter --- */
        .dtp-newsletter {
            margin: 48px 0 0; padding: 40px; background: #203B32;
            border-radius: 12px; text-align: center;
        }
        .dtp-newsletter h2 {
            font-family: 'Jost', sans-serif; font-size: clamp(20px,2.8vw,26px);
            font-weight: 700; color: #fff; margin: 0 0 10px;
        }
        .dtp-newsletter p { color: #c8dac8; font-size: 16px; margin: 0 0 20px; }

        /* --- Footer --- */
        .dtp-footer {
            background: #203B32; color: rgba(255,255,255,.7);
            padding: 40px 20px; text-align: center; margin-top: 48px;
            font-size: 14px; line-height: 1.6;
        }
        .dtp-footer a { color: #C9A24A; text-decoration: none; }

        /* --- Mobile --- */
        @media (max-width: 768px) {
            .dtp-nav-links { display: none; }
            .dtp-hero { min-height: 260px; border-radius: 0; }
            .dtp-hero-text { padding: 18px; }
            .dtp-content img { float: none !important; width: 100% !important; }
            .dtp-related-grid { grid-template-columns: 1fr; }
            .dtp-share { gap: 4px; }
        }
        </style>
    </head>
    <body <?php body_class('dtp-blog-body'); ?>>

    <!-- ═══ HEADER ═══ -->
    <header class="dtp-nav">
        <a href="<?php echo home_url('/'); ?>">
            <?php
            $logo = get_theme_mod('custom_logo');
            if ($logo) {
                $logo_id = get_theme_mod('custom_logo');
                $logo_url = wp_get_attachment_image_url($logo_id, 'full');
                echo '<img src="' . esc_url($logo_url) . '" alt="' . esc_attr(get_bloginfo('name')) . '">';
            } else {
                echo '<img src="https://danielstastypetfoods.co.uk/wp-content/uploads/2026/03/cropped-4d9b79a1-cd7c-48a3-8831-1bf36aaf2a72-e1774461103449.png" alt="Daniel\'s Tasty Petfoods">';
            }
            ?>
        </a>
        <ul class="dtp-nav-links">
            <li><a href="<?php echo home_url('/'); ?>">Home</a></li>
            <li><a href="<?php echo home_url('/about-us/'); ?>">About Us</a></li>
            <li><a href="<?php echo home_url('/ingredients/'); ?>">Ingredients</a></li>
            <li><a href="<?php echo home_url('/our-blog/'); ?>" style="color:#C9A24A;">Our Blog</a></li>
            <li><a href="<?php echo home_url('/contact/'); ?>">Contact</a></li>
            <li><a href="<?php echo home_url('/dog-walking/'); ?>">Dog Walking</a></li>
        </ul>
    </header>

    <!-- ═══ ARTICLE ═══ -->
    <article class="dtp-article">

        <?php if ($hero_src) : ?>
        <div class="dtp-hero">
            <img src="<?php echo esc_url($hero_src); ?>" alt="<?php the_title_attribute(); ?>" loading="eager" />
            <div class="dtp-hero-overlay"></div>
            <div class="dtp-hero-text">
                <?php if ($category) : ?>
                    <span class="dtp-badge"><?php echo esc_html($category); ?></span>
                <?php endif; ?>
            </div>
        </div>
        <?php endif; ?>

        <h1 class="dtp-title"><?php the_title(); ?></h1>

        <div class="dtp-byline">
            <p class="dtp-byline-text">
                <?php echo esc_html($author); ?> · <?php echo esc_html($date); ?> · <?php echo esc_html($read_time); ?> min read
            </p>
            <div class="dtp-share">
                <a class="dtp-share-btn" href="https://www.facebook.com/sharer/sharer.php?u=<?php echo $share_url; ?>" target="_blank" rel="noopener" title="Share on Facebook">f</a>
                <a class="dtp-share-btn" href="https://twitter.com/intent/tweet?url=<?php echo $share_url; ?>&text=<?php echo $share_title; ?>" target="_blank" rel="noopener" title="Share on X">X</a>
                <a class="dtp-share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=<?php echo $share_url; ?>" target="_blank" rel="noopener" title="Share on LinkedIn">in</a>
                <a class="dtp-share-btn" href="https://wa.me/?text=<?php echo $share_title . '%20' . $share_url; ?>" target="_blank" rel="noopener" title="Share on WhatsApp">W</a>
                <a class="dtp-share-btn" href="mailto:?subject=<?php echo $share_title; ?>&body=<?php echo $share_url; ?>" title="Share via Email">@</a>
            </div>
        </div>

        <div class="dtp-content">
            <?php the_content(); ?>
        </div>

        <!-- CTA Band -->
        <div class="dtp-cta">
            <p>Explore more from Daniel's Tasty Petfoods</p>
            <a href="<?php echo home_url('/shop/'); ?>" target="_blank" rel="noopener">Visit Our Shop</a>
        </div>

        <!-- Related Posts -->
        <?php if ($related_query->have_posts()) : ?>
        <div class="dtp-related">
            <h2>Keep Reading</h2>
            <div class="dtp-related-grid">
                <?php while ($related_query->have_posts()) : $related_query->the_post(); ?>
                <a class="dtp-related-card" href="<?php the_permalink(); ?>">
                    <?php if (has_post_thumbnail()) : ?>
                        <?php the_post_thumbnail('medium', array('loading' => 'lazy')); ?>
                    <?php else : ?>
                        <div style="height:160px;background:linear-gradient(135deg,#f8faf6,#e2ead9);display:flex;align-items:center;justify-content:center;padding:12px;">
                            <span style="font-family:'Jost',sans-serif;font-weight:700;font-size:14px;color:#203B32;text-align:center;"><?php the_title(); ?></span>
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

    <!-- ═══ FOOTER ═══ -->
    <footer class="dtp-footer">
        <p>&copy; <?php echo date('Y'); ?> <?php bloginfo('name'); ?>. All rights reserved.</p>
        <p><a href="<?php echo home_url('/privacy-policy/'); ?>">Privacy Policy</a> · <a href="<?php echo home_url('/terms/'); ?>">Terms</a></p>
    </footer>

    <?php wp_footer(); ?>
    </body>
    </html>
    <?php

    // Return the buffered output as the template
    $html = ob_get_clean();
    echo $html;
    exit; // Stop WordPress from loading any other template
}, 99);
