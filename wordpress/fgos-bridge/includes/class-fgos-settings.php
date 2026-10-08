<?php
/**
 * Settings + admin screen.
 *
 * This is the "switchable implementation" the owner asked for: one dropdown
 * chooses between elementor / html / auto, live, with no code deploy. Everything
 * is stored per site in wp_options and can be reverted by flipping the mode.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Settings.
 */
class FGOS_Settings {

	/** Settings page slug. */
	const PAGE = 'fgos-bridge';

	/**
	 * Hook registration.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	/**
	 * Register settings + fields.
	 *
	 * @return void
	 */
	public static function register() {
		register_setting(
			'fgos_bridge',
			FGOS_OPT_ENABLED,
			array( 'type' => 'string', 'default' => '1', 'sanitize_callback' => 'fgos_sanitize_bool' )
		);
		register_setting(
			'fgos_bridge',
			FGOS_OPT_MODE,
			array( 'type' => 'string', 'default' => 'auto', 'sanitize_callback' => array( __CLASS__, 'sanitize_mode' ) )
		);
		register_setting(
			'fgos_bridge',
			FGOS_OPT_SPLIT,
			array( 'type' => 'string', 'default' => '1', 'sanitize_callback' => 'fgos_sanitize_bool' )
		);
		register_setting(
			'fgos_bridge',
			FGOS_OPT_REFERENCE,
			array( 'type' => 'integer', 'default' => 0, 'sanitize_callback' => 'absint' )
		);
		register_setting(
			'fgos_bridge',
			'fgos_tokens_override',
			array(
				'type'              => 'array',
				'default'           => array(),
				'sanitize_callback' => 'fgos_sanitize_tokens_override',
			)
		);
		register_setting(
			'fgos_bridge',
			FGOS_OPT_CSS,
			array( 'type' => 'string', 'default' => '', 'sanitize_callback' => 'wp_kses_post' )
		);
	}

	/**
	 * Sanitize a boolean-ish option.
	 *
	 * @param mixed $v Raw value.
	 * @return string
	 */
	public static function sanitize_bool( $v ) {
		return ( '1' === (string) $v ) ? '1' : '0';
	}

	/**
	 * Sanitize the mode.
	 *
	 * @param mixed $v Raw value.
	 * @return string
	 */
	public static function sanitize_mode( $v ) {
		$v = in_array( (string) $v, array( 'auto', 'elementor', 'html' ), true ) ? (string) $v : 'auto';
		return $v;
	}

	/**
	 * Add the settings page.
	 *
	 * @return void
	 */
	public static function admin_menu() {
		add_options_page(
			'FGOS Bridge',
			'FGOS Bridge',
			'manage_options',
			self::PAGE,
			array( __CLASS__, 'render' )
		);
	}

	/**
	 * Render the settings screen.
	 *
	 * @return void
	 */
	public static function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		// Re-probe action.
		if ( isset( $_GET['fgos_probe'] ) && check_admin_referer( 'fgos_probe' ) ) {
			$reference = (int) get_option( FGOS_OPT_REFERENCE, 0 );
			update_option( FGOS_OPT_TOKENS, FGOS_ThemeProbe::probe( $reference ) );
			wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'probed' => 1 ), admin_url( 'options-general.php' ) ) );
			exit;
		}

		// Regenerate secret.
		if ( isset( $_GET['fgos_regen'] ) && check_admin_referer( 'fgos_regen' ) ) {
			update_option( FGOS_OPT_SECRET, wp_generate_password( 40, false, false ) );
			wp_safe_redirect( add_query_arg( array( 'page' => self::PAGE, 'regen' => 1 ), admin_url( 'options-general.php' ) ) );
			exit;
		}

		$mode      = (string) get_option( FGOS_OPT_MODE, 'auto' );
		$effective = FGOS_Renderer::effective_mode();
		$elementor = FGOS_Renderer::elementor_active();
		$secret    = (string) get_option( FGOS_OPT_SECRET, '' );
		$tokens    = get_option( FGOS_OPT_TOKENS, array() );
		$reference = (int) get_option( FGOS_OPT_REFERENCE, 0 );
		$webhook   = rest_url( FGOS_Webhook::NS . '/publish' );
		?>
		<div class="wrap">
			<h1>FGOS Bridge</h1>
			<p class="description">
				Receives FGOS articles so they <strong>inherit your theme</strong> — existing
				layouts, fonts and colours. Converts to native Elementor containers when
				Elementor is available; otherwise publishes clean semantic HTML.
			</p>

			<?php if ( isset( $_GET['probed'] ) ) : ?>
				<div class="notice notice-success is-dismissible"><p>Theme tokens re-probed.</p></div>
			<?php endif; ?>
			<?php if ( isset( $_GET['regen'] ) ) : ?>
				<div class="notice notice-warning is-dismissible"><p>Secret regenerated — update FGOS with the new secret.</p></div>
			<?php endif; ?>
			<?php if ( 'elementor' === $mode && ! $elementor ) : ?>
				<div class="notice notice-warning">
					<p>Mode is set to <strong>Elementor</strong> but Elementor is not active, so
					articles will publish in <strong>HTML</strong> mode. Activate Elementor, or switch the mode.</p>
				</div>
			<?php endif; ?>

			<form method="post" action="options.php">
				<?php settings_fields( 'fgos_bridge' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="fgos_enabled">Bridge enabled</label></th>
						<td>
							<select id="fgos_enabled" name="<?php echo esc_attr( FGOS_OPT_ENABLED ); ?>">
								<option value="1" <?php selected( get_option( FGOS_OPT_ENABLED, '1' ), '1' ); ?>>Yes</option>
								<option value="0" <?php selected( get_option( FGOS_OPT_ENABLED, '1' ), '0' ); ?>>No (return 403)</option>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="fgos_mode">Render mode</label></th>
						<td>
							<select id="fgos_mode" name="<?php echo esc_attr( FGOS_OPT_MODE ); ?>">
								<option value="auto" <?php selected( $mode, 'auto' ); ?>>Auto — Elementor if available, otherwise HTML</option>
								<option value="elementor" <?php selected( $mode, 'elementor' ); ?>>Elementor — always native containers</option>
								<option value="html" <?php selected( $mode, 'html' ); ?>>HTML — always semantic HTML + scoped stylesheet</option>
							</select>
							<p class="description">
								Elementor: <?php echo $elementor ? '<strong>active</strong>' : '<strong>not active</strong>'; ?> ·
								Effective now: <code><?php echo esc_html( $effective ); ?></code>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="fgos_split_blocks">Split into Elementor blocks</label></th>
						<td>
							<select id="fgos_split_blocks" name="<?php echo esc_attr( FGOS_OPT_SPLIT ); ?>">
								<option value="1" <?php selected( (string) get_option( FGOS_OPT_SPLIT, '1' ), '1' ); ?>>Yes — each block becomes a widget</option>
								<option value="0" <?php selected( (string) get_option( FGOS_OPT_SPLIT, '1' ), '0' ); ?>>No — one text widget (faster for long posts)</option>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="fgos_reference_post_id">Match layout of</label></th>
						<td>
							<input type="number" id="fgos_reference_post_id" class="small-text"
								name="<?php echo esc_attr( FGOS_OPT_REFERENCE ); ?>"
								value="<?php echo esc_attr( (string) $reference ); ?>" />
							<p class="description">
								Post or page ID whose fonts, colours and content width FGOS articles should match
								(e.g. your “Our Blog” page). Leave empty to inherit the theme's own defaults.
							</p>
							<?php
							$a = wp_nonce_url( add_query_arg( array( 'page' => self::PAGE, 'fgos_probe' => 1 ), admin_url( 'options-general.php' ) ), 'fgos_probe' );
							printf( '<p><a class="button" href="%s">Re-probe theme tokens</a></p>', esc_url( $a ) );
							?>
						</td>
					</tr>
					<tr>
						<th scope="row">Probed tokens</th>
						<td>
							<?php if ( is_array( $tokens ) && $tokens ) : ?>
								<table class="widefat striped" style="max-width:640px">
									<tbody>
									<?php foreach ( $tokens as $k => $v ) : ?>
										<tr>
											<td><code><?php echo esc_html( $k ); ?></code></td>
											<td><code><?php echo esc_html( $v ); ?></code></td>
										</tr>
									<?php endforeach; ?>
									</tbody>
								</table>
								<p class="description">Tokens are applied as CSS custom properties scoped to each FGOS article.</p>
							<?php else : ?>
								<p class="description">No tokens probed — articles will inherit the theme's styles directly.</p>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row">Token overrides</th>
						<td>
							<textarea name="fgos_tokens_override" rows="6" style="width:100%;max-width:640px;font-family:monospace"
								placeholder="--fgos-color-primary: #10b981&#10;--fgos-font-body: Inter, sans-serif"><?php
								$ov = get_option( 'fgos_tokens_override', array() );
								echo esc_textarea( is_array( $ov ) ? wp_json_encode( $ov, JSON_PRETTY_PRINT ) : (string) $ov );
							?></textarea>
							<p class="description">JSON object of CSS custom properties. Leave empty to inherit everything from the theme.</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="fgos_css">Extra site CSS</label></th>
						<td>
							<textarea id="fgos_css" name="<?php echo esc_attr( FGOS_OPT_CSS ); ?>" rows="6" style="width:100%;max-width:640px;font-family:monospace"><?php echo esc_textarea( (string) get_option( FGOS_OPT_CSS, '' ) ); ?></textarea>
							<p class="description">Optional additional CSS, loaded only on FGOS posts.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Webhook URL</th>
						<td>
							<code style="display:block;padding:8px;background:#f0f0f1;"><?php echo esc_html( $webhook ); ?></code>
							<p class="description">Point FGOS at this URL instead of <code>/wp-json/wp/v2/posts</code>.</p>
						</td>
					</tr>
					<tr>
						<th scope="row">Shared secret</th>
						<td>
							<code style="display:block;padding:8px;background:#f0f0f1;word-break:break-all;"><?php echo esc_html( $secret ? $secret : '(not set)' ); ?></code>
							<?php
							$r = wp_nonce_url( add_query_arg( array( 'page' => self::PAGE, 'fgos_regen' => 1 ), admin_url( 'options-general.php' ) ), 'fgos_regen' );
							printf( '<p><a class="button" href="%s">Regenerate secret</a></p>', esc_url( $r ) );
							?>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<hr>
			<h2>Token overrides</h2>
			<p class="description">
				<strong>Note:</strong> token overrides are posted as a JSON string above. Save, then edit them as JSON.
			</p>
		</div>
		<?php
	}
}

/**
 * Sanitize the token override field.
 *
 * Accepts a JSON object (preferred) or simple `key: value` lines, so an owner
 * can paste `--fgos-color-primary: #10b981` without escaping anything.
 *
 * @param mixed $v Raw value.
 * @return array
 */
function fgos_sanitize_tokens_override( $v ) {
	if ( is_array( $v ) ) {
		return $v;
	}
	$raw = trim( (string) $v );
	if ( '' === $raw ) {
		return array();
	}

	$decoded = json_decode( $raw, true );
	if ( is_array( $decoded ) ) {
		return $decoded;
	}

	$out = array();
	foreach ( preg_split( '/\R/', $raw ) as $line ) {
		$line = trim( $line );
		if ( '' === $line || false === strpos( $line, ':' ) ) {
			continue;
		}
		list( $k, $val ) = explode( ':', $line, 2 );
		$k   = trim( $k );
		$val = trim( $val );
		if ( '' !== $k && '' !== $val ) {
			$out[ $k ] = $val;
		}
	}
	return $out;
}