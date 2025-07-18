/**
 * Sanitization utilities for various use cases
 */

/**
 * HTML escape function to prevent XSS attacks
 * Escapes HTML entities in user-provided strings
 *
 * @param unsafe - The string to escape
 * @returns HTML-escaped string safe for display
 */
export function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';

  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes server name for use as filename by replacing special characters.
 * Based on the existing implementation in clientSessionManager.ts
 *
 * @param serverName - The server name to sanitize
 * @returns Sanitized server name safe for use as filename
 */
export function sanitizeServerName(serverName: string): string {
  if (!serverName) {
    return 'default';
  }

  // Replace special characters with safe equivalents
  let sanitized = serverName
    .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace any non-alphanumeric, underscore, or hyphen with underscore
    .replace(/_{2,}/g, '_') // Replace multiple consecutive underscores with single underscore
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .substring(0, 100); // Limit length to prevent filesystem issues

  // If result is empty or only underscores, use default
  if (!sanitized || sanitized.length === 0) {
    return 'default';
  }

  return sanitized;
}

/**
 * Sanitizes server name for display purposes
 * Similar to filename sanitization but preserves more characters for readability
 *
 * @param serverName - The server name to sanitize
 * @returns Sanitized server name safe for display
 */
export function sanitizeServerNameForDisplay(serverName: string): string {
  if (!serverName) {
    return 'default';
  }

  // Allow more characters for display but still escape dangerous ones
  // Create regex pattern for dangerous characters (including control characters)
  const controlChars = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  const dangerousChars = new RegExp(`[<>"/\\|?*${controlChars}\x7f]`, 'g');
  let sanitized = serverName
    .replace(dangerousChars, '_') // Replace dangerous characters
    .replace(/_{2,}/g, '_') // Replace multiple consecutive underscores with single underscore
    .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
    .substring(0, 200); // Longer limit for display

  // If result is empty, use default
  if (!sanitized || sanitized.length === 0) {
    return 'default';
  }

  return sanitized;
}

/**
 * Sanitizes URL parameter values to prevent injection attacks
 *
 * @param param - The parameter value to sanitize
 * @returns URL-safe parameter value
 */
export function sanitizeUrlParam(param: string): string {
  if (!param) return '';

  // Use built-in encodeURIComponent but also limit length
  return encodeURIComponent(param).substring(0, 500);
}

/**
 * Sanitizes error messages for safe display
 * Removes potentially sensitive information and escapes HTML
 *
 * @param error - The error message to sanitize
 * @returns Sanitized error message safe for display
 */
export function sanitizeErrorMessage(error: string): string {
  if (!error) return '';

  // Remove common sensitive patterns - preserve original case in replacement
  let sanitized = error
    .replace(/(password[s]?[:\s=]+)[^\s]+/gi, (_match, prefix) => `${prefix}[REDACTED]`)
    .replace(/(token[s]?[:\s=]+)[^\s]+/gi, (_match, prefix) => `${prefix}[REDACTED]`)
    .replace(/(key[s]?[:\s=]+)[^\s]+/gi, (_match, prefix) => `${prefix}[REDACTED]`)
    .replace(/(secret[s]?[:\s=]+)[^\s]+/gi, (_match, prefix) => `${prefix}[REDACTED]`)
    .replace(/(auth[=][^\s]+)/gi, (_match, _prefix) => `auth=[REDACTED]`)
    .substring(0, 1000); // Limit length

  // HTML escape the result
  return escapeHtml(sanitized);
}

/**
 * Sanitizes HTTP headers for safe logging
 * Redacts sensitive authentication and authorization headers
 *
 * @param headers - The headers object to sanitize
 * @returns Sanitized headers object safe for logging
 */
export function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const sanitized: Record<string, any> = {};
  const sensitiveHeaders = ['authorization', 'auth', 'x-auth-token', 'x-api-key', 'cookie', 'set-cookie'];

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveHeaders.includes(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Comprehensive sanitization for server configuration data
 * Applies appropriate sanitization based on the context
 *
 * @param serverName - The server name to sanitize
 * @param context - The context where this will be used ('filename' | 'display' | 'url' | 'html')
 * @returns Sanitized server name appropriate for the context
 */
export function sanitizeServerNameForContext(
  serverName: string,
  context: 'filename' | 'display' | 'url' | 'html',
): string {
  switch (context) {
    case 'filename':
      return sanitizeServerName(serverName);
    case 'display':
      return sanitizeServerNameForDisplay(serverName);
    case 'url':
      return sanitizeUrlParam(serverName);
    case 'html':
      return escapeHtml(sanitizeServerNameForDisplay(serverName));
    default:
      return sanitizeServerName(serverName);
  }
}
