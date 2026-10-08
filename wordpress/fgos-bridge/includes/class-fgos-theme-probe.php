<?php
/**
 * Theme probe — read design tokens from the site itself.
 *
 * Goal: make an FGOS article look like a page the owner already likes (e.g.
 * "Our Blog"), not like FGOS's opinion. Two sources, in order:
 *
 *  1. Elementor Global Settings / Global Colors (Elementor sites).
 *  2. Core block-theme presets `--wp--preset--*` from the theme stylesheet
 *     (non-Elementor block themes).
 *  3. Nothing found → tokens stay absent and the CSS `inherit` defaults win.
 *
 * It is a convenience, never a dependency. If it fails, the article still renders
 * on the theme's own styles.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Theme probe.
 */
class FGOS_ThemeProbe {

	/**
	 * Probe and return tokens.
	 *
	 * @param int $reference_post_id Reference post/page ID (0 = none).
	 * @return array<string,string>
	 */
	public static function probe( $reference_post_id = 0 ) {
		$tokens = array();

		$tokens = array_merge( $tokens, self::elementor_tokens( $reference_post_id ) );
		if ( empty( $tokens ) ) {
			$tokens = array_merge( $tokens, self::preset_tokens() );
		}

		return apply_filters( 'fgos_theme_tokens', $tokens, $reference_post_id );
	}

	/**
	 * Read Elementor global typography/colours, optionally scoped to a template.
	 *
	 * @param int $reference_post_id Reference ID.
	 * @return array<string,string>
	 */
	private static function elementor_tokens( $reference_post_id ) {
		if ( ! class_exists( '\Elementor\Plugin' ) ) {
			return array();
		}

		$tokens = array();

		// Global colours — the most reliable brand signal.
		try {
			$colors = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend()->get_settings( 'system_colors' );
			if ( is_array( $colors ) ) {
				$map = array(
					'primary'   => '--fgos-color-primary',
					'secondary' => '--fgos-color-secondary',
					'text'      => '--fgos-color-body',
					'accent'    => '--fgos-color-accent',
				);
				foreach ( $map as $key => $var ) {
					if ( ! empty( $colors[ $key ] ) ) {
						$tokens[ $var ] = $colors[ $key ];
					}
				}
			}
		} catch ( \Throwable $e ) {
			// Older/newer Elementor internals — fall through to typography.
		}

		// Global typography.
		try {
			$typo = \Elementor\Plugin::$instance->kits_manager->get_active_kit_for_frontend()->get_settings( 'system_typography' );
			if ( is_array( $typo ) && ! empty( $typo['primary'] ) ) {
				$family = $typo['primary']['typography_font_family'];
				$size   = isset( $typo['primary']['typography_font_size']['size'] ) ? $typo['primary']['typography_font_size']['size'] : '';
				$unit   = isset( $typo['primary']['typography_font_size']['unit'] ) ? $typo['primary']['typography_font_size']['unit'] : 'px';
				if ( $family ) {
					$tokens['--fgos-font-body'] = $family;
				}
				if ( $size ) {
					$tokens['--fgos-size-body'] = $size . $unit;
				}
			}
		} catch ( \Throwable $e ) {
			// Non-fatal.
		}

		// Content width from the reference page's Elementor settings, if any.
		if ( $reference_post_id ) {
			$measure = self::reference_content_width( $reference_post_id );
			if ( $measure ) {
				$tokens['--fgos-measure'] = $measure;
			}
		}

		return array_filter( $tokens );
	}

	/**
	 * Content width from an Elementor-built reference post.
	 *
	 * @param int $post_id Reference post.
	 * @return string Empty when unknown.
	 */
	private static function reference_content_width( $post_id ) {
		if ( ! class_exists( '\Elementor\Plugin' ) ) {
			return '';
		}
		try {
			$doc = \Elementor\Plugin::$instance->documents->get( $post_id, false );
			if ( ! $doc ) {
				return '';
			}
			$data = $doc->get_elements_data();
			if ( empty( $data ) ) {
				return '';
			}
			foreach ( $data as $element ) {
				$width = isset( $element['settings']['content_width'] ) ? $element['settings']['content_width'] : '';
				if ( 'full' !== $width ) {
					continue;
				}
				$boxed = isset( $element['settings']['boxed_width']['size'] ) ? $element['settings']['boxed_width']['size'] : '';
				if ( $boxed ) {
					$unit = isset( $element['settings']['boxed_width']['unit'] ) ? $element['settings']['boxed_width']['unit'] : 'px';
					return $boxed . $unit;
				}
			}
		} catch ( \Throwable $e ) {
			// Non-fatal.
		}
		return '';
	}

	/**
	 * Core block-theme preset custom properties (non-Elementor).
	 *
	 * @return array<string,string>
	 */
	private static function preset_tokens() {
		$tokens = array();
		$css    = wp_get_global_stylesheet();

		$grab = static function ( $preset ) use ( &$tokens ) {
			if ( preg_match( '/--wp--preset--' . preg_quote( $preset, '/' ) . '--[a-z-]+:\s*([^;]+);/i', $css, $m ) ) {
				return trim( $m[1] );
			}
			return '';
		};

		$family = $grab( 'font-family' );
		if ( $family ) {
			$tokens['--fgos-font-body'] = $family;
		}
		$primary = $grab( 'color' );
		if ( $primary ) {
			$tokens['--fgos-color-primary'] = $primary;
		}
		$content = $grab( 'spacing' );
		if ( $content ) {
			$tokens['--fgos-gap'] = $content;
		}

		return array_filter( $tokens );
	}
}