import { EnhancedTransport } from '@src/core/types/transport.js';

/**
 * Get the effective request timeout with proper precedence
 * Returns: requestTimeout > timeout (fallback) > undefined
 *
 * @param transport The transport configuration
 * @returns The effective request timeout in milliseconds, or undefined if not set
 */
export function getRequestTimeout(transport: EnhancedTransport): number | undefined {
  return transport.requestTimeout ?? transport.timeout;
}

/**
 * Get the effective connection timeout with proper precedence
 * Returns: connectionTimeout > timeout (fallback) > undefined
 *
 * @param transport The transport configuration
 * @returns The effective connection timeout in milliseconds, or undefined if not set
 */
export function getConnectionTimeout(transport: EnhancedTransport): number | undefined {
  return transport.connectionTimeout ?? transport.timeout;
}
