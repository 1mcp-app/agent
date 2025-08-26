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
 * Tag validation result interface
 */
export interface TagValidationResult {
  isValid: boolean;
  sanitizedTag: string;
  warnings: string[];
  errors: string[];
}

/**
 * Validates and sanitizes a single tag
 * Checks for problematic characters and provides warnings/errors
 *
 * @param tag - The tag to validate and sanitize
 * @returns Validation result with sanitized tag and any warnings/errors
 */
export function validateAndSanitizeTag(tag: string): TagValidationResult {
  const result: TagValidationResult = {
    isValid: true,
    sanitizedTag: '',
    warnings: [],
    errors: [],
  };

  // Handle null/undefined tags
  if (tag === null || tag === undefined || typeof tag !== 'string') {
    result.isValid = false;
    result.errors.push('Tag cannot be empty or null');
    return result;
  }

  // Trim whitespace
  const trimmedTag = tag.trim();

  if (trimmedTag.length === 0) {
    result.isValid = false;
    result.errors.push('Tag cannot be empty or whitespace only');
    return result;
  }

  // Check length limits
  if (trimmedTag.length > 100) {
    result.isValid = false;
    result.errors.push('Tag length cannot exceed 100 characters');
    return result;
  }

  if (trimmedTag.length < 1) {
    result.isValid = false;
    result.errors.push('Tag must be at least 1 character long');
    return result;
  }

  // Decode URL encoding if present
  let decodedTag = trimmedTag;
  try {
    // Check if it's URL encoded and decode it
    if (trimmedTag.includes('%')) {
      decodedTag = decodeURIComponent(trimmedTag);
      if (decodedTag !== trimmedTag) {
        result.warnings.push('Tag was URL decoded');
      }
    }
  } catch (_e) {
    result.warnings.push('Tag contains invalid URL encoding');
    decodedTag = trimmedTag; // Keep original if decode fails
  }

  // Check for problematic characters and warn
  const problematicChars = {
    ',': 'commas can interfere with tag list parsing',
    '&': 'ampersands can interfere with URL parameters',
    '=': 'equals signs can interfere with URL parameters',
    '?': 'question marks can interfere with URL parsing',
    '#': 'hash symbols can interfere with URL fragments',
    '/': 'slashes can interfere with URL paths',
    '\\': 'backslashes can cause parsing issues',
    '<': 'less-than symbols can cause HTML injection issues',
    '>': 'greater-than symbols can cause HTML injection issues',
    '"': 'double quotes can cause parsing issues',
    "'": 'single quotes can cause parsing issues',
    '`': 'backticks can cause script injection issues',
    '\n': 'newlines can cause parsing issues',
    '\r': 'carriage returns can cause parsing issues',
    '\t': 'tabs can cause formatting issues',
  };

  // Check each character for problems
  for (const [char, reason] of Object.entries(problematicChars)) {
    if (decodedTag.includes(char)) {
      result.warnings.push(`Contains '${char}' - ${reason}`);
    }
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  const controlCharRegex = /[\x00-\x1f\x7f]/;
  if (controlCharRegex.test(decodedTag)) {
    result.warnings.push('Contains control characters that may cause issues');
  }

  // Check for non-ASCII characters (international characters are OK, but warn)
  // eslint-disable-next-line no-control-regex
  const nonAsciiRegex = /[^\x00-\x7f]/;
  if (nonAsciiRegex.test(decodedTag)) {
    result.warnings.push('Contains non-ASCII characters (international characters)');
  }

  // Normalize the tag for consistent comparison
  result.sanitizedTag = decodedTag.trim().toLowerCase();

  return result;
}

/**
 * Validates and sanitizes an array of tags
 * Filters out invalid tags and provides consolidated warnings
 *
 * @param tags - Array of tags to validate
 * @param maxTags - Maximum number of tags allowed (default: 50)
 * @returns Object with valid tags, warnings, and errors
 */
export function validateAndSanitizeTags(
  tags: string[],
  maxTags: number = 50,
): {
  validTags: string[];
  warnings: string[];
  errors: string[];
  invalidTags: string[];
} {
  const result = {
    validTags: [] as string[],
    warnings: [] as string[],
    errors: [] as string[],
    invalidTags: [] as string[],
  };

  if (!Array.isArray(tags)) {
    result.errors.push('Tags must be an array');
    return result;
  }

  if (tags.length > maxTags) {
    result.errors.push(`Too many tags: maximum ${maxTags} allowed, got ${tags.length}`);
    return result;
  }

  const seenTags = new Set<string>();

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    const validation = validateAndSanitizeTag(tag);

    if (!validation.isValid) {
      result.invalidTags.push(tag);
      validation.errors.forEach((error) => {
        result.errors.push(`Tag ${i + 1} "${tag}": ${error}`);
      });
      continue;
    }

    // Check for duplicates
    if (seenTags.has(validation.sanitizedTag)) {
      result.warnings.push(`Duplicate tag after normalization: "${tag}"`);
      continue;
    }

    seenTags.add(validation.sanitizedTag);
    result.validTags.push(validation.sanitizedTag);

    // Add warnings with tag context
    validation.warnings.forEach((warning) => {
      result.warnings.push(`Tag "${tag}": ${warning}`);
    });
  }

  return result;
}

/**
 * Normalizes a tag for consistent comparison
 * Applies the same normalization used in validation
 *
 * @param tag - The tag to normalize
 * @returns Normalized tag
 */
export function normalizeTag(tag: string): string {
  if (!tag || typeof tag !== 'string') {
    return '';
  }

  try {
    // Decode URL encoding if present
    let normalized = tag.includes('%') ? decodeURIComponent(tag) : tag;
    return normalized.trim().toLowerCase();
  } catch (_e) {
    // If decode fails, just normalize without decoding
    return tag.trim().toLowerCase();
  }
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
