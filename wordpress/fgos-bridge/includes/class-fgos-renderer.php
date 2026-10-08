<?php
/**
 * Rendering: mode resolution, the theme-inheritance contract, and scoped assets.
 *
 * This class is the heart of "do not fight the theme". Two ideas:
 *
 *  1. Everything the bridge styles lives under `.fgos-article`, so theme header,
 *     footer, nav, sidebar and buttons are never touched.
 *  2. Every design token defaults to `inherit`, so an unconfigured article renders
 *     with the theme's own font-family, size and colour. Brand tokens are opt-in.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Renderer.
 */
class FGOS_Renderer {

	/** Scoped stylesheet handle. */
	const HANDLE = 'fgos-article';

	/**
	 * Is Elementor usable on this site?
	 *
	 * Checks the class (Elementor free + pro both define it once loaded) and that
	 * the plugin file is present. Used to gate elementor mode only.
	 *
	 * @return bool
	 */
	public static function elementor_active() {
		return class_exists( '\Elementor\Plugin' )
			&& defined( 'ELEMENTOR_VERSION' );
	}

	/**
	 * Resolve the effective render mode.
	 *
	 * elementor : force Elementor conversion (falls back to html if unavailable)
	 * html      : semantic HTML + scoped stylesheet
	 * auto      : elementor when available, else html
	 *
	 * @return string One of 'elementor'|'html'.
	 */
	public static function effective_mode() {
		$configured = (string) get_option( FGOS_OPT_MODE, 'auto' );

		if ( 'elementor' === $configured ) {
			return self::elementor_active() ? 'elementor' : 'html';
		}
		if ( 'html' === $configured ) {
			return 'html';
		}
		// auto
		return self::elementor_active() ? 'elementor' : 'html';
	}

	/**
	 * Whether deep block splitting is enabled.
	 *
	 * @return bool
	 */
	public static function split_blocks() {
		return '1' === (string) get_option( FGOS_OPT_SPLIT, '1' );
	}

	/**
	 * Design tokens: site overrides merged over probe results, all defaults inherit.
	 *
	 * @return array<string,string>
	 */
	public static function tokens() {
		$probe = get_option( FGOS_OPT_TOKENS, array() );
		if ( ! is_array( $probe ) ) {
			$probe = array();
		}
		$override = get_option( 'fgos_tokens_override', array() );
		if ( ! is_array( $override ) ) {
			$override = array();
		}

		$tokens = array_merge( $probe, array_filter( $override, 'strlen' ) );

		// Normalise: strip empty so inherit defaults remain in CSS.
		return array_filter(
			$tokens,
			static function ( $v ) {
				return is_string( $v ) && '' !== trim( $v );
			}
		);
	}

	/**
	 * Build the scoped root class list for a post.
	 *
	 * @param int $post_id Post ID.
	 * @return string
	 */
	public static function wrapper_class( $post_id ) {
		$extra = apply_filters( 'fgos_article_classes', '', $post_id );
		return trim( 'fgos-article fgos-article--' . (int) $post_id . ' ' . $extra );
	}

	/**
	 * Wrap article HTML in the scoped root div (idempotent).
	 *
	 * @param string $html    Article body.
	 * @param int    $post_id Post ID.
	 * @return string
	 */
	public static function wrap( $html, $post_id ) {
		$html = (string) $html;
		if ( false !== stripos( $html, 'fgos-article' ) ) {
			return $html;
		}
		return '<div class="' . esc_attr( self::wrapper_class( $post_id ) ) . '">' . $html . '</div>';
	}

	/**
	 * Enqueue the scoped stylesheet for FGOS single posts, and only for those.
	 *
	 * @return void
	 */
	public static function enqueue() {
		if ( ! is_singular() ) {
			return;
		}
		$post_id = get_queried_object_id();
		if ( ! $post_id || 'fgos' !== get_post_meta( $post_id, FGOS_META_GENERATOR, true ) ) {
			return;
		}

		// Elementor mode renders structure via Elementor containers; the bridge
		// CSS still loads for component classes, but never as a layout override.
		$base = FGOS_BRIDGE_DIR . 'assets/fgos-article.css';
		$ver  = FGOS_BRIDGE_VERSION . '.' . md5( (string) filemtime( $base ) );
		wp_enqueue_style( self::HANDLE, FGOS_BRIDGE_URL . 'assets/fgos-article.css', array(), $ver );

		// Per-site token overrides as an inline style block, still fully scoped.
		$tokens = self::tokens();
		if ( $tokens ) {
			wp_add_inline_style(
				self::HANDLE,
				self::tokens_css( $tokens, $post_id )
			);
		}

		// Optional site-wide CSS addition from settings.
		$extra = trim( (string) get_option( FGOS_OPT_CSS, '' ) );
		if ( '' !== $extra ) {
			wp_add_inline_style( self::HANDLE, $extra );
		}
	}

	/**
	 * Turn a token map into a scoped CSS custom-property block.
	 *
	 * @param array $tokens   Token map.
	 * @param int   $post_id  Post ID for scoping.
	 * @return string
	 */
	public static function tokens_css( array $tokens, $post_id ) {
		$sel  = '.fgos-article--' . (int) $post_id;
		$vars = array();
		foreach ( $tokens as $key => $value ) {
			$prop = 0 === strpos( (string) $key, '--' ) ? (string) $key : '--fgos-' . ltrim( (string) $key, '-' );
			$vars[] = $prop . ':' . $value;
		}
		return $sel . '{' . implode( ';', $vars ) . '}';
	}

	/**
	 * Add a body class for FGOS posts so themes can style them.
	 *
	 * @param array $classes Body classes.
	 * @return array
	 */
	public static function body_class( $classes ) {
		if ( is_singular() ) {
			$post_id = get_queried_object_id();
			if ( $post_id && 'fgos' === get_post_meta( $post_id, FGOS_META_GENERATOR, true ) ) {
				$classes[] = 'fgos-post';
				$classes[] = 'fgos-post-' . (int) $post_id;
			}
		}
		return $classes;
	}
}