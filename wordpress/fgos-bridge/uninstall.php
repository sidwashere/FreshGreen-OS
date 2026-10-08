<?php
/**
 * Uninstall routine.
 *
 * Removes bridge options and the generator marker from posts. Does NOT delete
 * posts or any FGOS-authored content — uninstalling a connector must never
 * destroy a site's blog.
 *
 * @package FGOSBridge
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

$options = array(
	'fgos_secret',
	'fgos_enabled',
	'fgos_mode',
	'fgos_split_blocks',
	'fgos_reference_post_id',
	'fgos_tokens',
	'fgos_tokens_override',
	'fgos_css',
	'fgos_activated_at',
);

foreach ( $options as $option ) {
	delete_option( $option );
}

// Clear the per-post generator marker, but leave every post intact.
global $wpdb;
$wpdb->query( "DELETE FROM {$wpdb->postmeta} WHERE meta_key = '_fgos_generator'" );