<?php
/**
 * HTML → native Elementor document.
 *
 * Walks the incoming article DOM and produces Elementor's `_elementor_data`
 * array, so the post opens in Elementor as real containers and widgets instead of
 * an opaque HTML blob. Only used when elementor mode is active.
 *
 * Mapping (see docs/FGOS-BRIDGE-SPEC.md §8):
 *   img                     → image widget
 *   h1..h6                  → heading widget (header_size = tag)
 *   a (no element children) → button widget (link.url, nofollow, is_external)
 *   p/ul/ol/table/blockquote/iframe/details/aside
 *                          → text-editor widget (inner HTML preserved verbatim)
 *   div/section/article/figure → container
 *   class attribute         → settings.css_classes (so FGOS classes reach Elementor)
 *   .fgos-cols-2/-3/-auto  → container_type grid
 *   style tag               → dropped
 *   root container          → content_width: full
 *
 * Unknown elements still become containers, so nothing in the article is lost.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * HTML to Elementor payload converter.
 */
class FGOS_HTML2Elementor {

	/** @var string Raw HTML. */
	private $html;

	/** @var int Monotonic id counter suffix. */
	private $seq = 0;

	/** @var string Random per-instance prefix so ids are unique across posts. */
	private $prefix;

	/** @var int Nesting cap to avoid pathological trees. */
	private $max_depth = 12;

	/**
	 * @param string $html Article body HTML.
	 */
	public function __construct( $html ) {
		$this->html   = (string) $html;
		$this->prefix = substr( md5( (string) microtime( true ) ), 0, 6 );
	}

	/**
	 * Produce the Elementor elements array.
	 *
	 * @return array
	 */
	public function get() {
		if ( ! class_exists( '\DOMDocument' ) ) {
			return array();
		}
		$nodes = $this->parse();
		$tree  = $this->to_elements( $nodes, 0 );

		// Root wrapper becomes a full-width container.
		if ( 1 === count( $tree ) && 'container' === ( $tree[0]['elType'] ?? '' ) ) {
			$tree[0]['settings']['content_width'] = 'full';
		}

		return $this->prune( $tree );
	}

	/**
	 * Parse HTML into a list of element nodes.
	 *
	 * @return array<int,\DOMElement>
	 */
	private function parse() {
		$prev = libxml_use_internal_errors( true );

		$doc = new \DOMDocument();
		$wrapped = '<?xml encoding="utf-8" ?><html><body><div>'
			. str_replace( "\n", ' ', $this->html )
			. '</div></body></html>';

		$doc->loadHTML(
			mb_convert_encoding( $wrapped, 'HTML-ENTITIES', 'UTF-8' ),
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);

		libxml_clear_errors();
		libxml_use_internal_errors( $prev );

		$body = $doc->getElementsByTagName( 'body' )->item( 0 );
		if ( ! $body ) {
			return array();
		}
		// Unwrap the sentinel div.
		$root = null;
		foreach ( $body->childNodes as $child ) {
			if ( XML_ELEMENT_NODE === $child->nodeType ) {
				$root = $child;
				break;
			}
		}
		return $root ? $this->elements_of( $root->childNodes ) : array();
	}

	/**
	 * Collect element children of a node list.
	 *
	 * @param \DOMNodeList $nodes Node list.
	 * @return array<int,\DOMElement>
	 */
	private function elements_of( $nodes ) {
		$out = array();
		foreach ( $nodes as $node ) {
			if ( XML_ELEMENT_NODE === $node->nodeType ) {
				$out[] = $node;
			}
		}
		return $out;
	}

	/**
	 * Unique element id.
	 *
	 * @return string
	 */
	private function id() {
		return $this->prefix . str_pad( (string) ++$this->seq, 4, '0', STR_PAD_LEFT );
	}

	/**
	 * Map a list of DOM elements to Elementor elements.
	 *
	 * @param array $nodes DOM elements.
	 * @param int   $depth Current depth.
	 * @return array
	 */
	private function to_elements( array $nodes, $depth ) {
		$out = array();
		foreach ( $nodes as $node ) {
			$element = $this->to_element( $node, $depth );
			if ( $element ) {
				$out[] = $element;
			}
		}
		return $out;
	}

	/**
	 * Map one DOM element to an Elementor element.
	 *
	 * @param \DOMElement $node  Node.
	 * @param int         $depth Depth.
	 * @return array|null
	 */
	private function to_element( \DOMElement $node, $depth ) {
		$tag = strtolower( $node->tagName );

		// Styles live in the stylesheet, never per post.
		if ( 'style' === $tag || 'script' === $tag ) {
			return null;
		}

		$classes = trim( $node->getAttribute( 'class' ) );
		$text    = trim( $node->textContent );
		$child_elements = $this->elements_of( $node->childNodes );

		// Containers we should recurse into.
		$is_container_tag = in_array(
			$tag,
			array( 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'ul', 'ol' ),
			true
		);
		// Leaf-ish blocks that keep their HTML intact inside a text-editor.
		$is_text_block = in_array(
			$tag,
			array( 'p', 'ul', 'ol', 'table', 'blockquote', 'iframe', 'details', 'figcaption', 'pre', 'hr' ),
			true
		);

		$settings = array();
		$widget   = '';
		$children = array();

		// Class names always ride along into Elementor so our CSS still applies.
		if ( '' !== $classes ) {
			$settings['css_classes'] = $classes;
		}

		if ( 'img' === $tag ) {
			$widget   = 'image';
			$settings['image'] = array(
				'url' => $node->getAttribute( 'src' ),
				'alt' => trim( $node->getAttribute( 'alt' ) ),
				'id'  => $this->id(),
			);
		} elseif ( $is_text_block ) {
			$widget   = 'text-editor';
			$settings['editor'] = $this->inner_html( $node );
			// A list that only wraps list items still belongs in one widget.
			if ( in_array( $tag, array( 'ul', 'ol' ), true ) ) {
				$children = array();
			}
		} elseif ( in_array( $tag, array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ), true ) ) {
			$widget   = 'heading';
			$settings['title']       = $text;
			$settings['header_size'] = $tag;
		} elseif ( 'a' === $tag && ! $child_elements ) {
			$widget = 'button';
			$settings['text'] = $text;
			$settings['link'] = array(
				'url'         => $node->getAttribute( 'href' ),
				'is_external' => ( '_blank' === $node->getAttribute( 'target' ) ) ? 'on' : 'off',
				'nofollow'    => 'on',
			);
		} elseif ( $is_container_tag && $depth < $this->max_depth ) {
			// A div/section with no element children but real text is a text block.
			if ( ! $child_elements && '' !== $text ) {
				$widget   = 'text-editor';
				$settings['editor'] = $this->inner_html( $node );
			} else {
				$children = $this->to_elements( $child_elements, $depth + 1 );
				// Grid wrappers become real Elementor grid containers.
				if ( $this->is_grid( $classes ) ) {
					$settings['container_type'] = 'grid';
					$settings['grid_rows_grid'] = array(
						'unit'  => 'fr',
						'size'  => 1,
						'sizes' => array(),
					);
				}
			}
		} else {
			// Unknown leaf: keep the HTML.
			$widget   = 'text-editor';
			$settings['editor'] = $this->inner_html( $node );
		}

		$el = array(
			'id'       => $this->id(),
			'isInner'  => $depth > 0,
			'elType'   => ( '' === $widget ) ? 'container' : 'widget',
			'settings' => $settings,
			'elements' => $children,
		);
		if ( '' !== $widget ) {
			$el['widgetType'] = $widget;
		}

		return $el;
	}

	/**
	 * Does this class list denote a grid?
	 *
	 * @param string $classes Class attribute.
	 * @return bool
	 */
	private function is_grid( $classes ) {
		return (bool) preg_match( '/\bfgos-(cols-2|cols-3|cols-4|auto-cols)\b/', (string) $classes );
	}

	/**
	 * Inner HTML of a node, preserved verbatim.
	 *
	 * @param \DOMElement $node Node.
	 * @return string
	 */
	private function inner_html( \DOMElement $node ) {
		$html = '';
		foreach ( $node->childNodes as $child ) {
			$html .= $node->ownerDocument->saveHTML( $child );
		}
		return $html;
	}

	/**
	 * Remove empty containers so Elementor's navigator stays usable.
	 *
	 * @param array $list Elements.
	 * @return array
	 */
	private function prune( array $list ) {
		$out = array();
		foreach ( $list as $element ) {
			if ( ! empty( $element['elements'] ) ) {
				$element['elements'] = $this->prune( $element['elements'] );
			}
			// Drop containers that ended up with nothing in them.
			if ( 'container' === $element['elType'] && empty( $element['elements'] ) ) {
				continue;
			}
			$out[] = $element;
		}
		return $out;
	}
}