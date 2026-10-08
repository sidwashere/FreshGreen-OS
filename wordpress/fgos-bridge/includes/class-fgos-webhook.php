<?php
/**
 * The webhook FGOS calls instead of POSTing raw HTML to /wp/v2/posts.
 *
 * Responsibilities:
 *  - verify HMAC
 *  - sanitize content with wp_kses (deliberate: this is why design lives in CSS)
 *  - resolve mode (elementor | html)
 *  - write the post, the generator marker, SEO meta, images
 *
 * Elementor conversion happens only here, and only in elementor mode. On a
 * non-Elementor site the same payload still works via the html path.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Webhook.
 */
class FGOS_Webhook {

	const NS = 'fgos/v1';

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
	}

	/**
	 * Register the publish endpoint.
	 *
	 * @return void
	 */
	public static function register_routes() {
		register_rest_route(
			self::NS,
			'/publish',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle_publish' ),
				// Auth is the HMAC, not a WP capability — matches the FGOS
				// server-to-server push model.
				'permission_callback' => '__return_true',
			)
		);
	}

	/**
	 * Handle a publish/update/delete request.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response
	 */
	public static function handle_publish( \WP_REST_Request $request ) {
		$data = $request->get_json_params();
		if ( ! is_array( $data ) ) {
			return new \WP_REST_Response( array( 'result' => 0, 'error' => 'Invalid JSON body.' ), 400 );
		}

		if ( '1' !== (string) get_option( FGOS_OPT_ENABLED, '1' ) ) {
			return new \WP_REST_Response( array( 'result' => 0, 'error' => 'FGOS Bridge is disabled.' ), 403 );
		}

		$secret = (string) get_option( FGOS_OPT_SECRET, '' );
		if ( ! FGOS_Signature::verify( $data, $secret ) ) {
			return new \WP_REST_Response( array( 'result' => 0, 'error' => 'Invalid signature.' ), 403 );
		}

		$action = isset( $data['action'] ) ? sanitize_key( $data['action'] ) : 'publish';

		// Harmless capability probe used by FGOS's "bridge status" check. It
		// verifies the shared secret without writing anything.
		if ( 'status' === $action ) {
			$tokens = get_option( FGOS_OPT_TOKENS, array() );
			return new \WP_REST_Response(
				array(
					'result'      => 1,
					'mode'        => FGOS_Renderer::effective_mode(),
					'configured'  => (string) get_option( FGOS_OPT_MODE, 'auto' ),
					'elementor'   => FGOS_Renderer::elementor_active(),
					'split_blocks' => FGOS_Renderer::split_blocks(),
					'tokens'      => is_array( $tokens ) ? $tokens : array(),
					'version'     => FGOS_BRIDGE_VERSION,
				)
			);
		}

		if ( 'delete' === $action ) {
			$post_id = isset( $data['post_id'] ) ? (int) $data['post_id'] : 0;
			if ( $post_id && wp_delete_post( $post_id, true ) ) {
				return new \WP_REST_Response( array( 'result' => 1, 'deleted' => $post_id ) );
			}
			return new \WP_REST_Response( array( 'result' => 0, 'error' => 'Delete failed.' ), 400 );
		}

		// --- Resolve mode (single source of truth) -------------------------
		$mode = FGOS_Renderer::effective_mode();

		$postarr = self::build_postarr( $data, $mode );
		if ( is_wp_error( $postarr ) ) {
			return new \WP_REST_Response(
				array( 'result' => 0, 'error' => $postarr->get_error_message() ),
				400
			);
		}

		$existing = ! empty( $data['post_id'] ) ? (int) $data['post_id'] : 0;
		if ( $existing && get_post( $existing ) ) {
			$postarr['ID'] = $existing;
			$post_id       = wp_update_post( $postarr, true );
		} else {
			$post_id = wp_insert_post( $postarr, true );
		}

		if ( is_wp_error( $post_id ) ) {
			return new \WP_REST_Response(
				array( 'result' => 0, 'error' => $post_id->get_error_message() ),
				400
			);
		}

		update_post_meta( $post_id, FGOS_META_GENERATOR, 'fgos' );

		// The per-post scoped wrapper can only be applied once the ID exists, so
		// post_content is written in a second pass. In elementor mode the body is
		// a fallback for RSS/REST consumers; Elementor renders the real thing.
		self::write_content( $post_id, $data, $mode );

		if ( 'elementor' === $mode ) {
			self::write_elementor_meta( $post_id, $data );
		}

		if ( ! empty( $data['fgos_meta'] ) && is_array( $data['fgos_meta'] ) ) {
			foreach ( $data['fgos_meta'] as $k => $v ) {
				update_post_meta( $post_id, '_fgos_' . sanitize_key( $k ), sanitize_text_field( (string) $v ) );
			}
		}

		// SEO meta fan-out — writes whichever keys the active SEO plugin uses.
		self::write_seo_meta( $post_id, $data );

		// Featured image (side-load to media library so it is not hot-linked).
		if ( ! empty( $data['featured_image'] ) ) {
			self::maybe_set_featured_image( $post_id, $data['featured_image'] );
		}

		return new \WP_REST_Response(
			array(
				'result'  => 1,
				'post_id' => $post_id,
				'url'     => get_permalink( $post_id ),
				'slug'    => get_post_field( 'post_name', $post_id ),
				'mode'    => $mode,
			)
		);
	}

	/**
	 * Build wp_insert_post args from the payload.
	 *
	 * @param array  $data Payload.
	 * @param string $mode Effective mode.
	 * @return array|\WP_Error
	 */
	private static function build_postarr( array $data, $mode ) {
		$status = ( isset( $data['publish'] ) && 1 === (int) $data['publish'] ) ? 'publish' : 'draft';
		$time   = isset( $data['post_time'] ) ? (int) $data['post_time'] : time();

		if ( 'publish' === $status && $time > time() ) {
			$status = 'future';
		}

		$html = isset( $data['html'] ) ? (string) $data['html'] : '';
		if ( '' === trim( $html ) ) {
			return new \WP_Error( 'fgos_empty', 'No article HTML supplied.' );
		}

		// Always sanitise. This strips <style>, which is exactly why the design
		// system lives in a stylesheet and never per post.
		$html = wp_kses( $html, wp_kses_allowed_html( 'post' ) );

		if ( 'elementor' === $mode ) {
			// Elementor builds the visible document from _elementor_data (written
			// after insert). post_content keeps a readable fallback for RSS, REST
			// consumers and crawlers.
			$postarr['post_content'] = $html;
		} else {
			$postarr['post_content'] = $html;
		}

		if ( ! empty( $data['author_id'] ) ) {
			$postarr['post_author'] = (int) $data['author_id'];
		}
		if ( ! empty( $data['post_slug'] ) ) {
			$slug = sanitize_title( $data['post_slug'] );
			if ( $slug ) {
				$postarr['post_name'] = $slug;
			}
		}
		if ( ! empty( $data['excerpt'] ) && ! empty( $data['description'] ) ) {
			$postarr['post_excerpt'] = sanitize_text_field( $data['description'] );
		}
		if ( isset( $data['tags'] ) && is_array( $data['tags'] ) && $data['tags'] ) {
			$postarr['tags_input'] = array_map( 'sanitize_text_field', $data['tags'] );
		}
		if ( isset( $data['category'] ) && '' !== $data['category'] ) {
			$ids = array_filter( array_map( 'intval', explode( ',', (string) $data['category'] ) ) );
			if ( $ids ) {
				$postarr['post_category'] = $ids;
			}
		}

		return $postarr;
	}

	/**
	 * Write the scoped article body once the post ID is known.
	 *
	 * @param int    $post_id Post ID.
	 * @param array  $data    Payload.
	 * @param string $mode    Effective mode.
	 * @return void
	 */
	private static function write_content( $post_id, array $data, $mode ) {
		$html = isset( $data['html'] ) ? (string) $data['html'] : '';
		if ( '' === trim( $html ) ) {
			return;
		}
		$html = wp_kses( $html, wp_kses_allowed_html( 'post' ) );

		// wp_update_post re-runs kses on post_content, which would strip our
		// classes' siblings, so the scoped wrapper is applied here and the whole
		// body is written directly to avoid double-sanitisation surprises.
		global $wpdb;
		$wrapped = FGOS_Renderer::wrap( $html, $post_id );
		$wpdb->update(
			$wpdb->posts,
			array( 'post_content' => $wrapped ),
			array( 'ID' => $post_id )
		);
		clean_post_cache( $post_id );

		unset( $mode );
	}

	/**
	 * Write Elementor meta for elementor mode.
	 *
	 * Called after the post exists (needs the ID). Kept separate so build_postarr
	 * stays testable.
	 *
	 * @param int   $post_id Post ID.
	 * @param array $data    Payload.
	 * @return void
	 */
	public static function write_elementor_meta( $post_id, array $data ) {
		if ( 'elementor' !== FGOS_Renderer::effective_mode() ) {
			return;
		}
		$html = isset( $data['html'] ) ? (string) $data['html'] : '';
		$html = wp_kses( $html, wp_kses_allowed_html( 'post' ) );

		$converter = new FGOS_HTML2Elementor( $html );
		$elements  = $converter->get();
		if ( ! $elements ) {
			return;
		}

		update_post_meta( $post_id, '_elementor_edit_mode', 'builder' );
		update_post_meta( $post_id, '_elementor_template_type', 'wp-post' );
		update_post_meta( $post_id, '_elementor_version', defined( 'ELEMENTOR_VERSION' ) ? ELEMENTOR_VERSION : '' );
		update_post_meta( $post_id, '_elementor_data', wp_slash( wp_json_encode( $elements ) ) );
	}

	/**
	 * Write SEO meta for whichever SEO plugin is active.
	 *
	 * @param int   $post_id Post ID.
	 * @param array $data    Payload.
	 * @return void
	 */
	private static function write_seo_meta( $post_id, array $data ) {
		$title   = isset( $data['theme'] ) ? sanitize_text_field( $data['theme'] ) : '';
		$desc    = isset( $data['description'] ) ? sanitize_text_field( $data['description'] ) : '';
		$focus   = isset( $data['main_keyword'] ) ? sanitize_text_field( $data['main_keyword'] ) : '';
		$keys    = isset( $data['keywords'] ) && is_array( $data['keywords'] ) ? $data['keywords'] : array();
		$all     = $keys ? implode( ',', array_map( 'sanitize_text_field', $keys ) ) : $focus;

		// Yoast
		if ( defined( 'WPSEO_VERSION' ) ) {
			update_post_meta( $post_id, '_yoast_wpseo_title', $title );
			update_post_meta( $post_id, '_yoast_wpseo_metadesc', $desc );
			update_post_meta( $post_id, '_yoast_wpseo_focuskw', $focus );
		}
		// Rank Math
		if ( defined( 'RANK_MATH_VERSION' ) ) {
			update_post_meta( $post_id, 'rank_math_title', $title );
			update_post_meta( $post_id, 'rank_math_description', $desc );
			update_post_meta( $post_id, 'rank_math_focus_keyword', $all );
		}
		// AIOSEO
		if ( defined( 'AIOSEO_VERSION' ) ) {
			update_post_meta( $post_id, '_aioseo_title', $title );
			update_post_meta( $post_id, '_aioseo_description', $desc );
			update_post_meta( $post_id, '_aioseo_keywords', $focus );
		}
		// SEOPress
		if ( defined( 'SEOPRESS_VERSION' ) ) {
			update_post_meta( $post_id, '_seopress_titles_title', $title );
			update_post_meta( $post_id, '_seopress_titles_desc', $desc );
			update_post_meta( $post_id, '_seopress_analysis_target_kw', $all );
		}
		// Squirrly
		if ( defined( 'SQR_VERSION' ) ) {
			update_post_meta( $post_id, '_sq_title', $title );
			update_post_meta( $post_id, '_sq_description', $desc );
		}
	}

	/**
	 * Side-load a remote image and set it as the featured image.
	 *
	 * @param int    $post_id Post ID.
	 * @param string $url     Remote image URL.
	 * @return void
	 */
	private static function maybe_set_featured_image( $post_id, $url ) {
		if ( ! function_exists( 'media_sideload_image' ) ) {
			require_once ABSPATH . 'wp-admin/includes/media.php';
			require_once ABSPATH . 'wp-admin/includes/file.php';
			require_once ABSPATH . 'wp-admin/includes/image.php';
		}
		if ( has_post_thumbnail( $post_id ) ) {
			return; // Don't clobber an existing featured image on update.
		}
		$att_id = media_sideload_image( esc_url_raw( $url ), $post_id, null, 'id' );
		if ( ! is_wp_error( $att_id ) ) {
			set_post_thumbnail( $post_id, $att_id );
		}
	}
}