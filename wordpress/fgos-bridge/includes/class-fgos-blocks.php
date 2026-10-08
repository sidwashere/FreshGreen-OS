<?php
/**
 * FGOS block → semantic HTML with design-system classes.
 *
 * Why this exists
 *   FGOS keeps a structured `blocks[]` array (hero, cards, daniels_tip, faq,
 *   product_cta…) but its `bodyHtml` is a FLATTENED string of bare <p>/<h2>/<img>
 *   tags with almost no classes. Publishing that gives an unstyled wall of text
 *   that no design system can style.
 *
 *   This converts the structured blocks back into real markup, tagging each one
 *   with the `.fgos-*` class the stylesheet owns. The result is then handed to
 *   HTML2Elementor, so the same converter produces the Elementor document and
 *   the CSS applies inside Elementor too.
 *
 * When no blocks are supplied, the caller falls back to the raw HTML, so
 * nothing is ever lost.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Blocks renderer.
 */
class FGOS_Blocks {

	/**
	 * Render an array of FGOS blocks to HTML.
	 *
	 * @param array $blocks Normalised blocks.
	 * @return string
	 */
	public static function render( $blocks ) {
		if ( ! is_array( $blocks ) || ! $blocks ) {
			return '';
		}

		$out = '';
		foreach ( $blocks as $block ) {
			if ( ! is_array( $block ) ) {
				continue;
			}
			$out .= self::render_block( $block );
		}
		return $out;
	}

	/**
	 * Render one block.
	 *
	 * @param array $b Block.
	 * @return string
	 */
	private static function render_block( $b ) {
		$type   = isset( $b['type'] ) ? (string) $b['type'] : 'paragraph';
		$title  = self::text( isset( $b['title'] ) ? $b['title'] : '' );
		$sub    = self::text( isset( $b['subtitle'] ) ? $b['subtitle'] : '' );
		$body   = self::html( isset( $b['content'] ) ? $b['content'] : '' );
		$badge  = self::text( isset( $b['badge'] ) ? $b['badge'] : '' );
		$img    = self::url( isset( $b['imageUrl'] ) ? $b['imageUrl'] : '' );
		$alt    = self::text( isset( $b['imageAlt'] ) ? $b['imageAlt'] : '' );
		$btn    = self::text( isset( $b['buttonText'] ) ? $b['buttonText'] : '' );
		$href   = self::url( isset( $b['buttonUrl'] ) ? $b['buttonUrl'] : '' );

		switch ( $type ) {

			case 'hero':
				$html  = '<div class="fgos-hero">';
				if ( $img ) {
					$html .= self::figure( $img, $alt, 'fgos-hero__img' );
				}
				if ( $badge ) {
					$html .= '<span class="fgos-badge">' . $badge . '</span>';
				}
				if ( $title ) {
					$html .= '<h1 class="fgos-hero__title">' . $title . '</h1>';
				}
				if ( $sub ) {
					$html .= '<p class="fgos-hero__sub">' . self::inline( $sub ) . '</p>';
				}
				if ( $body ) {
					$html .= '<div class="fgos-hero__body">' . $body . '</div>';
				}
				$html .= self::button( $btn, $href );
				$html .= '</div>';
				return $html;

			case 'image_banner':
				if ( ! $img ) {
					return $body ? '<div class="fgos-paragraph">' . $body . '</div>' : '';
				}
				$caption = self::text( isset( $b['imageCaption'] ) ? $b['imageCaption'] : '' );
				$html    = '<figure class="fgos-figure">' . self::img_tag( $img, $alt, 'fgos-figure__img' );
				if ( $caption ) {
					$html .= '<figcaption class="fgos-figure__caption">' . $caption . '</figcaption>';
				}
				$html .= self::button( $btn, $href );
				$html .= '</figure>';
				return $html;

			case 'cards':
				return self::cards( $b, $title, $body );

			case 'carousel':
				return self::carousel( $b, $title );

			case 'product_cta':
				return self::product_cta( $b, $title, $sub, $body, $img, $alt, $btn, $href );

			case 'cta_band':
				$html = '<div class="fgos-cta">';
				if ( $badge ) {
					$html .= '<span class="fgos-badge">' . $badge . '</span>';
				}
				if ( $title ) {
					$html .= '<h2 class="fgos-cta__title">' . $title . '</h2>';
				}
				if ( $body ) {
					$html .= '<div class="fgos-cta__body">' . $body . '</div>';
				}
				$html .= self::button( $btn, $href );
				$html .= '</div>';
				return $html;

			case 'quote':
				$cite = self::text( isset( $b['author'] ) ? $b['author'] : '' );
				return '<blockquote class="fgos-quote">' . $body
					. ( $cite ? '<cite class="fgos-quote__cite">' . $cite . '</cite>' : '' )
					. '</blockquote>';

			case 'faq':
				return self::faq( $b, $title );

			case 'daniels_tip':
			case 'tip':
			case 'callout':
				$kind = ( 'daniels_tip' === $type ) ? 'key' : 'info';
				$html = '<aside class="fgos-callout fgos-callout--' . $kind . '">';
				if ( $title ) {
					$html .= '<p class="fgos-callout__title">' . $title . '</p>';
				}
				$html .= $body;
				$html .= '</aside>';
				return $html;

			case 'toc':
				return '<nav class="fgos-toc" aria-label="Table of contents">' . $body . '</nav>';

			case 'key_takeaways':
				return '<div class="fgos-takeaways">'
					. ( $title ? '<h2 class="fgos-takeaways__title">' . $title . '</h2>' : '' )
					. $body . '</div>';

			case 'heading':
				return $title ? '<h2 class="fgos-section-title">' . $title . '</h2>' : '';

			default:
				// paragraph / anything else
				$html = '<div class="fgos-paragraph">';
				if ( $title ) {
					$html .= '<h2 class="fgos-section-title">' . $title . '</h2>';
				}
				if ( $sub ) {
					$html .= '<p class="fgos-lede">' . self::inline( $sub ) . '</p>';
				}
				$html .= $body;
				$html .= self::button( $btn, $href );
				$html .= '</div>';
				return $html;
		}
	}

	/**
	 * Cards grid. Reads either `cards` or `fallback` (FGOS stores card arrays
	 * under `fallback` in some generations).
	 *
	 * @param array  $b     Block.
	 * @param string $title Heading.
	 * @param string $body  Intro copy.
	 * @return string
	 */
	private static function cards( $b, $title, $body ) {
		$items = array();
		foreach ( array( 'cards', 'fallback', 'items' ) as $key ) {
			if ( ! empty( $b[ $key ] ) && is_array( $b[ $key ] ) ) {
				$items = $b[ $key ];
				break;
			}
		}

		$html = '<div class="fgos-cards">';
		if ( $title ) {
			$html .= '<h2 class="fgos-cards__title">' . $title . '</h2>';
		}
		if ( $body ) {
			$html .= '<div class="fgos-cards__intro">' . $body . '</div>';
		}
		if ( $items ) {
			$cols = ( count( $items ) >= 3 ) ? ' fgos-cols-3' : ( 2 === count( $items ) ? ' fgos-cols-2' : ' fgos-auto-cols' );
			$html .= '<div class="fgos-cards__grid' . $cols . '">';
			foreach ( $items as $c ) {
				if ( ! is_array( $c ) ) {
					continue;
				}
				$ct  = self::text( isset( $c['title'] ) ? $c['title'] : '' );
				$cc  = self::html( isset( $c['content'] ) ? $c['content'] : '' );
				$ci  = self::url( isset( $c['imageUrl'] ) ? $c['imageUrl'] : '' );
				$ca  = self::text( isset( $c['imageAlt'] ) ? $c['imageAlt'] : ( $ct ? $ct : '' ) );
				$cb  = self::text( isset( $c['buttonText'] ) ? $c['buttonText'] : '' );
				$chu = self::url( isset( $c['buttonUrl'] ) ? $c['buttonUrl'] : '' );

				$html .= '<article class="fgos-card">';
				if ( $ci ) {
					$html .= self::img_tag( $ci, $ca, 'fgos-card__img' );
				}
				if ( $ct ) {
					$html .= '<h3 class="fgos-card__title">' . $ct . '</h3>';
				}
				if ( $cc ) {
					$html .= '<div class="fgos-card__body">' . $cc . '</div>';
				}
				$html .= self::button( $cb, $chu, 'fgos-card__btn' );
				$html .= '</article>';
			}
			$html .= '</div>';
		}
		$html .= '</div>';
		return $html;
	}

	/**
	 * Carousel.
	 *
	 * @param array  $b     Block.
	 * @param string $title Heading.
	 * @return string
	 */
	private static function carousel( $b, $title ) {
		$slides = array();
		foreach ( array( 'slides', 'fallback', 'items' ) as $key ) {
			if ( ! empty( $b[ $key ] ) && is_array( $b[ $key ] ) ) {
				$slides = $b[ $key ];
				break;
			}
		}
		if ( ! $slides ) {
			return '';
		}

		$html = '<div class="fgos-carousel">';
		if ( $title ) {
			$html .= '<h2 class="fgos-carousel__title">' . $title . '</h2>';
		}
		$html .= '<div class="fgos-carousel__track">';
		foreach ( $slides as $s ) {
			if ( ! is_array( $s ) ) {
				continue;
			}
			$st = self::text( isset( $s['title'] ) ? $s['title'] : '' );
			$sc = self::html( isset( $s['content'] ) ? $s['content'] : '' );
			$si = self::url( isset( $s['imageUrl'] ) ? $s['imageUrl'] : '' );
			$sa = self::text( isset( $s['imageAlt'] ) ? $s['imageAlt'] : ( $st ? $st : '' ) );

			$html .= '<figure class="fgos-carousel__item">';
			if ( $si ) {
				$html .= self::img_tag( $si, $sa, 'fgos-carousel__img' );
			}
			if ( $st ) {
				$html .= '<figcaption class="fgos-carousel__caption"><strong>' . $st . '</strong></figcaption>';
			}
			if ( $sc ) {
				$html .= '<div class="fgos-carousel__body">' . $sc . '</div>';
			}
			$html .= '</figure>';
		}
		$html .= '</div></div>';
		return $html;
	}

	/**
	 * Product card.
	 *
	 * @param array  $b   Block.
	 * @param string $ti  Title.
	 * @param string $sub Subtitle.
	 * @param string $bd  Body.
	 * @param string $img Image URL.
	 * @param string $alt Alt text.
	 * @param string $btn Button text.
	 * @param string $href Button URL.
	 * @return string
	 */
	private static function product_cta( $b, $ti, $sub, $bd, $img, $alt, $btn, $href ) {
		$html = '<div class="fgos-products">';
		$html .= '<article class="fgos-product">';
		if ( $img ) {
			$html .= self::img_tag( $img, $alt ? $alt : $ti, 'fgos-product__img' );
		}
		$inner = '';
		if ( $ti ) {
			$inner .= '<h3 class="fgos-product__title">' . $ti . '</h3>';
		}
		if ( $sub ) {
			$inner .= '<p class="fgos-product__sub">' . self::inline( $sub ) . '</p>';
		}
		if ( $bd ) {
			$inner .= '<div class="fgos-product__body">' . $bd . '</div>';
		}
		$inner .= self::button( $btn, $href, 'fgos-product__btn' );
		$html .= '<div class="fgos-product__inner">' . $inner . '</div>';
		$html .= '</article></div>';
		return $html;
	}

	/**
	 * FAQ — rendered as <details> so it works without JS.
	 *
	 * @param array  $b     Block.
	 * @param string $title Heading.
	 * @return string
	 */
	private static function faq( $b, $title ) {
		$items = array();
		foreach ( array( 'items', 'faqs', 'fallback', 'cards' ) as $key ) {
			if ( ! empty( $b[ $key ] ) && is_array( $b[ $key ] ) ) {
				$items = $b[ $key ];
				break;
			}
		}

		$html = '<section class="fgos-faq">';
		if ( $title ) {
			$html .= '<h2 class="fgos-faq__title">' . $title . '</h2>';
		}
		if ( $items ) {
			$html .= '<div class="fgos-faq__list">';
			foreach ( $items as $i ) {
				if ( ! is_array( $i ) ) {
					continue;
				}
				$q = self::text( isset( $i['title'] ) ? $i['title'] : ( isset( $i['question'] ) ? $i['question'] : '' ) );
				$a = self::html( isset( $i['content'] ) ? $i['content'] : ( isset( $i['answer'] ) ? $i['answer'] : '' ) );
				if ( ! $q ) {
					continue;
				}
				$html .= '<details class="fgos-faq__item"><summary class="fgos-faq__q">' . $q . '</summary>';
				$html .= '<div class="fgos-faq__answer">' . $a . '</div></details>';
			}
			$html .= '</div>';
		}
		$html .= '</section>';
		return $html;
	}

	/* ---------------------------------------------------------------- helpers */

	/** Image tag. */
	private static function img_tag( $url, $alt, $class ) {
		return '<img src="' . esc_url( $url ) . '" alt="' . esc_attr( $alt ) . '" class="' . esc_attr( $class ) . '" loading="lazy" decoding="async" />';
	}

	/** Figure wrapper with an image. */
	private static function figure( $url, $alt, $class ) {
		return '<figure class="fgos-figure">' . self::img_tag( $url, $alt, $class ) . '</figure>';
	}

	/** Button, only when both label and URL exist. */
	private static function button( $text, $url, $class = 'fgos-cta__btn' ) {
		if ( ! $text || ! $url ) {
			return '';
		}
		return '<a class="' . esc_attr( $class ) . '" href="' . esc_url( $url ) . '" rel="noopener">' . self::text( $text ) . '</a>';
	}

	/** Plain text, entities preserved (titles may carry &nbsp;). */
	private static function text( $v ) {
		return wp_kses_post( (string) $v );
	}

	/** Simple inline markup, no block tags. */
	private static function inline( $v ) {
		return wp_kses( (string) $v, self::inline_tags() );
	}

	/** Block content. */
	private static function html( $v ) {
		$v = (string) $v;
		if ( '' === trim( $v ) ) {
			return '';
		}
		return wpautop( wp_kses( $v, wp_kses_allowed_html( 'post' ) ) );
	}

	/** Allowed inline tags. */
	private static function inline_tags() {
		return array(
			'a'      => array( 'href' => true, 'rel' => true, 'target' => true ),
			'strong' => array(),
			'em'     => array(),
			'b'      => array(),
			'i'      => array(),
			'span'   => array( 'class' => true ),
			'br'     => array(),
			'code'   => array(),
		);
	}
}