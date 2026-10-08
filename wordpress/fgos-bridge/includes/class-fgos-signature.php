<?php
/**
 * HMAC payload signing/verification for the FGOS webhook.
 *
 * Canonical form: every top-level scalar sorted by key, arrays reduced to the
 * constant 'Array', joined with '|', then HMAC-SHA256 with the shared secret.
 * The `sign` key itself is excluded.
 *
 * @package FGOSBridge
 */

defined( 'ABSPATH' ) || exit;

/**
 * Static signing helpers.
 */
class FGOS_Signature {

	/**
	 * Canonical string for a payload.
	 *
	 * @param array $data Raw request body.
	 * @return string
	 */
	public static function canonical( array $data ) {
		if ( isset( $data['sign'] ) ) {
			unset( $data['sign'] );
		}
		ksort( $data );

		$parts = array();
		foreach ( $data as $value ) {
			$parts[] = is_array( $value ) ? 'Array' : (string) $value;
		}

		return implode( '|', $parts );
	}

	/**
	 * Sign a payload.
	 *
	 * @param array  $data   Payload (without 'sign').
	 * @param string $secret Shared secret.
	 * @return string
	 */
	public static function sign( array $data, $secret ) {
		return hash_hmac( 'sha256', self::canonical( $data ), $secret );
	}

	/**
	 * Verify a payload. Uses hash_equals to avoid timing leaks.
	 *
	 * @param array  $data   Payload including 'sign'.
	 * @param string $secret Shared secret.
	 * @return bool
	 */
	public static function verify( array $data, $secret ) {
		if ( empty( $secret ) || empty( $data['sign'] ) || ! is_string( $data['sign'] ) ) {
			return false;
		}
		return hash_equals( self::sign( $data, $secret ), $data['sign'] );
	}
}