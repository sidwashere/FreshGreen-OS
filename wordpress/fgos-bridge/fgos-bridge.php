<?php
/**
 * Plugin Name:       FGOS Bridge
 * Plugin URI:        https://github.com/sidwashere/FreshGreen-OS
 * Description:       Receives FGOS articles and renders them so they inherit the site's own theme layout, typography and colours. Converts to native Elementor containers when Elementor is available; otherwise publishes clean semantic HTML. Works on non-Elementor themes with no configuration.
 * Version:           0.1.0
 * Requires at least: 5.9
 * Requires PHP:      7.4
 * Author:            FGOS
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       fgos-bridge
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

define( 'FGOS_BRIDGE_VERSION', '0.1.0' );
define( 'FGOS_BRIDGE_FILE', __FILE__ );
define( 'FGOS_BRIDGE_DIR', plugin_dir_path( __FILE__ ) );
define( 'FGOS_BRIDGE_URL', plugin_dir_url( __FILE__ ) );

/** Option keys — all namespaced so they never collide with the theme. */
define( 'FGOS_OPT_SECRET', 'fgos_secret' );
define( 'FGOS_OPT_ENABLED', 'fgos_enabled' );
define( 'FGOS_OPT_MODE', 'fgos_mode' );
define( 'FGOS_OPT_SPLIT', 'fgos_split_blocks' );
define( 'FGOS_OPT_REFERENCE', 'fgos_reference_post_id' );
define( 'FGOS_OPT_TOKENS', 'fgos_tokens' );
define( 'FGOS_OPT_CSS', 'fgos_css' );

/** Marks a post as FGOS-authored (used to scope the stylesheet). */
define( 'FGOS_META_GENERATOR', '_fgos_generator' );

require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-signature.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-blocks.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-settings.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-theme-probe.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-html2elementor.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-renderer.php';
require_once FGOS_BRIDGE_DIR . 'includes/class-fgos-webhook.php';

/**
 * Boot the plugin. Deliberately minimal: the webhook, the scoped stylesheet and
 * the admin screen. Nothing here requires Elementor.
 */
function fgos_bridge_boot() {
	FGOS_Settings::init();
	FGOS_Webhook::init();

	// The design-system stylesheet loads ONLY on single views of FGOS posts, and
	// only when there is no Elementor-provided stylesheet for the same post. In
	// elementor mode Elementor's own CSS handles the layout, so the bridge CSS is
	// only used for the component classes that Elementor does not style.
	add_action( 'wp_enqueue_scripts', array( 'FGOS_Renderer', 'enqueue' ) );
	add_filter( 'body_class', array( 'FGOS_Renderer', 'body_class' ) );

	if ( is_admin() ) {
		FGOS_Settings::admin_menu();
	}
}
add_action( 'plugins_loaded', 'fgos_bridge_boot' );

/**
 * Activation: generate a secret if absent, and sanity-check the environment.
 * Never fatal — a site without Elementor must still activate cleanly.
 */
function fgos_bridge_activate() {
	if ( ! get_option( FGOS_OPT_SECRET ) ) {
		update_option( FGOS_OPT_SECRET, wp_generate_password( 40, false, false ) );
	}
	if ( ! get_option( FGOS_OPT_ENABLED ) ) {
		update_option( FGOS_OPT_ENABLED, '1' );
	}
	if ( ! get_option( FGOS_OPT_MODE ) ) {
		update_option( FGOS_OPT_MODE, 'auto' );
	}
	update_option( 'fgos_activated_at', current_time( 'mysql' ) );
}
register_activation_hook( __FILE__, 'fgos_bridge_activate' );

/**
 * Deactivation: leave options intact so a reactivation restores the configuration.
 * (Deleting a secret on deactivation would silently break an FGOS integration.)
 */
function fgos_bridge_deactivate() {
	wp_clear_scheduled_hook( 'fgos_cron_tick' );
}
register_deactivation_hook( __FILE__, 'fgos_bridge_deactivate' );