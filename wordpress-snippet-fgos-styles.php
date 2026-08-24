/**
 * FGOS — WordPress Styling Preserver
 *
 * Allows <style> tags and HTML5 elements in post content,
 * disables wpautop so structured HTML is preserved exactly.
 */

// Allow <style> + HTML5 tags in KSES filter
add_filter( 'wp_kses_allowed_html', function ( $allowed, $context ) {
    if ( $context === 'post' || $context === 'data' ) {
        $allowed['style'] = array();
        foreach ( array( 'section', 'header', 'footer', 'aside', 'figure' ) as $tag ) {
            $allowed[ $tag ] = array( 'class' => true, 'style' => true, 'id' => true );
        }
        $allowed['figcaption'] = array( 'class' => true, 'style' => true );
        $allowed['details'] = array( 'class' => true, 'style' => true, 'open' => true );
        $allowed['summary'] = array( 'class' => true, 'style' => true );
        foreach ( array( 'div', 'span', 'p', 'a', 'img', 'ul', 'ol', 'li',
                         'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                         'blockquote', 'strong', 'em', 'br', 'hr',
                         'input', 'button', 'form', 'label' ) as $tag ) {
            if ( ! isset( $allowed[ $tag ] ) ) {
                $allowed[ $tag ] = array();
            }
            foreach ( array( 'style', 'class', 'id', 'href', 'src', 'alt',
                             'title', 'loading', 'target', 'rel', 'placeholder',
                             'required', 'type', 'name', 'value', 'method',
                             'action', 'width', 'height' ) as $attr ) {
                $allowed[ $tag ][ $attr ] = true;
            }
        }
    }
    return $allowed;
}, 10, 2 );

// Disable wpautop for post content
remove_filter( 'the_content', 'wpautop', 10 );
remove_filter( 'the_excerpt', 'wpautop', 10 );
