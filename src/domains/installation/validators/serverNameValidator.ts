/**
 * Server name validation and sanitization
 */

const LOCAL_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const MAX_NAME_LENGTH = 50;

/**
 * Derive a local server name from a registry ID
 * Ensures the name is valid, sanitized, and not too long
 */
export function deriveLocalName(registryId: string): string {
  // Extract the last part after the slash, or use the full ID if no slash
  const lastPart = registryId.includes('/') ? registryId.split('/').pop()! : registryId;

  // If it already starts with a letter and only contains valid chars, use it as-is
  if (LOCAL_NAME_REGEX.test(lastPart) && lastPart.length <= MAX_NAME_LENGTH) {
    return lastPart;
  }

  // Otherwise, sanitize it
  let sanitized = lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `server_${sanitized}`;
  }

  // Truncate to MAX_NAME_LENGTH characters if longer
  if (sanitized.length > MAX_NAME_LENGTH) {
    sanitized = sanitized.substring(0, MAX_NAME_LENGTH);
  }

  // Ensure it's not empty after sanitization
  if (sanitized.length === 0) {
    sanitized = 'server';
  }

  return sanitized;
}

/**
 * Validate if a server name is valid
 */
export function isValidServerName(name: string): boolean {
  return LOCAL_NAME_REGEX.test(name) && name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

/**
 * Sanitize a server name to make it valid
 */
export function sanitizeServerName(name: string): string {
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');

  // Ensure it starts with a letter
  if (!/^[a-zA-Z]/.test(sanitized)) {
    sanitized = `server_${sanitized}`;
  }

  // Truncate if too long
  if (sanitized.length > MAX_NAME_LENGTH) {
    sanitized = sanitized.substring(0, MAX_NAME_LENGTH);
  }

  // Fallback if empty
  if (sanitized.length === 0) {
    sanitized = 'server';
  }

  return sanitized;
}
