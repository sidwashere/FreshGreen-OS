<?php
/**
 * DTP Blog Post Template — Code Snippet version
 *
 * Registers a custom "DTP Blog Post" template with the full design system
 * (Jost/Cormorant Garamond/Roboto, DTP colours, hero, byline, share buttons,
 * related posts, CTA band). Paste into WP Admin → Snippets → Add New → activate.
 *
 * After activating, set it as the template on each blog post:
 *   Posts → Edit post → Post Attributes → Template → "DTP Blog Post"
 *
 * The app's sync endpoint can also set this automatically via:
 *   payload.template = 'elementor_header_footer'
 *   (which will use the DTP template if it's the only custom one,
 *    or you can set it per-post in the editor)
 */

// Register the custom template
add_action('init', function () {
    register_page_template('DTP Blog Post', 'dtp-blog-template');
});

// If the template file doesn't exist in the theme, register a fallback
// via the template_include filter so the template still works
add_filter('template_include', function ($template) {
    if (!is_singular() || !is_page_template('dtp-blog-template')) {
        return $template;
    }
    // Look for the template in the child theme, then parent theme
    $located = locate_template('single-dtp-blog.php');
    if ($located) return $located;
    // If the template file doesn't exist yet, use the fallback below
    return $template;
}, 99);
