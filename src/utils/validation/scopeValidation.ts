import logger from '@src/logger/logger.js';

/**
 * Security constants for scope validation
 */
export const SCOPE_VALIDATION_CONFIG = {
  /** Maximum allowed length for a single scope */
  MAX_SCOPE_LENGTH: 100,
  /** Maximum number of scopes per request */
  MAX_SCOPES_COUNT: 50,
  /** Valid tag name pattern: alphanumeric, underscore, hyphen only */
  TAG_NAME_PATTERN: /^[a-zA-Z0-9_-]+$/,
  /** Valid tag scope pattern: tag: prefix followed by valid tag name */
  TAG_SCOPE_PATTERN: /^tag:[a-zA-Z0-9_-]+$/,
  /** Minimum tag name length */
  MIN_TAG_LENGTH: 1,
  /** Maximum tag name length */
  MAX_TAG_LENGTH: 50,
} as const;

/**
 * Parsed scope structure
 */
export interface ParsedScope {
  type: 'tag';
  value: string;
}

/**
 * Scope validation result
 */
export interface ScopeValidationResult {
  isValid: boolean;
  errors: string[];
  validScopes: string[];
  invalidScopes: string[];
}

/**
 * Validates if a string is a valid tag name
 * @param tagName - The tag name to validate
 * @returns True if valid, false otherwise
 */
export function isValidTagName(tagName: string): boolean {
  if (!tagName || typeof tagName !== 'string') {
    return false;
  }

  // Check length constraints
  if (
    tagName.length < SCOPE_VALIDATION_CONFIG.MIN_TAG_LENGTH ||
    tagName.length > SCOPE_VALIDATION_CONFIG.MAX_TAG_LENGTH
  ) {
    return false;
  }

  // Check pattern
  return SCOPE_VALIDATION_CONFIG.TAG_NAME_PATTERN.test(tagName);
}

/**
 * Validates if a string is a valid tag scope
 * @param scope - The scope to validate
 * @returns True if valid, false otherwise
 */
export function isValidTagScope(scope: string): boolean {
  if (!scope || typeof scope !== 'string') {
    return false;
  }

  // Check length constraints
  if (scope.length > SCOPE_VALIDATION_CONFIG.MAX_SCOPE_LENGTH) {
    return false;
  }

  // Check pattern
  if (!SCOPE_VALIDATION_CONFIG.TAG_SCOPE_PATTERN.test(scope)) {
    return false;
  }

  // Extract and validate tag name
  const tagName = scope.slice(4); // Remove "tag:" prefix
  return isValidTagName(tagName);
}

/**
 * Safely extracts tag name from a tag scope
 * @param scope - The scope string (e.g., "tag:web")
 * @returns The tag name if valid, null otherwise
 */
export function extractTagFromScope(scope: string): string | null {
  if (!isValidTagScope(scope)) {
    logger.warn(`Invalid tag scope format: ${scope}`);
    return null;
  }

  return scope.slice(4); // Remove "tag:" prefix
}

/**
 * Parses a scope string into its components
 * @param scope - The scope string to parse
 * @returns Parsed scope object or null if invalid
 */
export function parseScope(scope: string): ParsedScope | null {
  if (!scope || typeof scope !== 'string') {
    return null;
  }

  // Currently only supporting tag scopes
  if (scope.startsWith('tag:')) {
    const tagName = extractTagFromScope(scope);
    if (!tagName) {
      return null;
    }
    return { type: 'tag', value: tagName };
  }

  // Future: Add support for other scope types (capability:, resource:, etc.)
  return null;
}

/**
 * Validates an array of scopes for format and security
 * @param scopes - Array of scope strings to validate
 * @returns Validation result with details
 */
export function validateScopes(scopes: string[]): ScopeValidationResult {
  const result: ScopeValidationResult = {
    isValid: true,
    errors: [],
    validScopes: [],
    invalidScopes: [],
  };

  // Check for null/undefined input
  if (!scopes || !Array.isArray(scopes)) {
    result.isValid = false;
    result.errors.push('Scopes must be an array');
    return result;
  }

  // Check count limits
  if (scopes.length > SCOPE_VALIDATION_CONFIG.MAX_SCOPES_COUNT) {
    result.isValid = false;
    result.errors.push(`Too many scopes: ${scopes.length} > ${SCOPE_VALIDATION_CONFIG.MAX_SCOPES_COUNT}`);
    return result;
  }

  // Validate each scope
  const seenScopes = new Set<string>();
  for (const scope of scopes) {
    // Check for duplicates
    if (seenScopes.has(scope)) {
      result.errors.push(`Duplicate scope: ${scope}`);
      result.invalidScopes.push(scope);
      continue;
    }
    seenScopes.add(scope);

    // Validate scope format
    if (isValidTagScope(scope)) {
      result.validScopes.push(scope);
    } else {
      result.errors.push(`Invalid scope format: ${scope}`);
      result.invalidScopes.push(scope);
    }
  }

  // Set overall validity
  result.isValid = result.errors.length === 0;

  return result;
}

/**
 * Validates that requested scopes are available (allowlist approach)
 * @param requestedScopes - Scopes requested by client
 * @param availableTags - Tags available on the server
 * @returns Validation result
 */
export function validateScopesAgainstAvailableTags(
  requestedScopes: string[],
  availableTags: string[],
): ScopeValidationResult {
  const result: ScopeValidationResult = {
    isValid: true,
    errors: [],
    validScopes: [],
    invalidScopes: [],
  };

  // First validate scope formats
  const formatValidation = validateScopes(requestedScopes);
  if (!formatValidation.isValid) {
    return formatValidation;
  }

  // Create set of available tags for fast lookup
  const availableTagSet = new Set(availableTags);

  // Check each scope against available tags
  for (const scope of requestedScopes) {
    const tagName = extractTagFromScope(scope);
    if (!tagName) {
      result.errors.push(`Invalid scope format: ${scope}`);
      result.invalidScopes.push(scope);
      continue;
    }

    if (availableTagSet.has(tagName)) {
      result.validScopes.push(scope);
    } else {
      result.errors.push(`Scope not available: ${scope} (tag: ${tagName})`);
      result.invalidScopes.push(scope);
    }
  }

  result.isValid = result.errors.length === 0;

  return result;
}

/**
 * Checks if granted scopes satisfy the requirements for requested tags
 * @param grantedScopes - Scopes granted during OAuth flow
 * @param requestedTags - Tags requested for current operation
 * @returns True if all requested tags are covered by granted scopes
 */
export function hasRequiredScopes(grantedScopes: string[], requestedTags: string[]): boolean {
  // Fail-secure: deny if inputs are invalid
  if (!grantedScopes || !Array.isArray(grantedScopes) || !requestedTags || !Array.isArray(requestedTags)) {
    logger.warn('Invalid input to hasRequiredScopes', { grantedScopes, requestedTags });
    return false;
  }

  // No tags requested means access is allowed
  if (requestedTags.length === 0) {
    return true;
  }

  // Extract tags from granted scopes
  const grantedTags = grantedScopes
    .map((scope) => extractTagFromScope(scope))
    .filter((tag) => tag !== null) as string[];

  // Check if all requested tags are in granted tags
  const hasAllTags = requestedTags.every((tag) => grantedTags.includes(tag));

  if (!hasAllTags) {
    logger.warn('Insufficient scopes for requested tags', {
      grantedTags,
      requestedTags,
      missing: requestedTags.filter((tag) => !grantedTags.includes(tag)),
    });
  }

  return hasAllTags;
}

/**
 * Converts tags to their corresponding scopes
 * @param tags - Array of tag names
 * @returns Array of tag scopes
 */
export function tagsToScopes(tags: string[]): string[] {
  if (!tags || !Array.isArray(tags)) {
    return [];
  }

  return tags.filter((tag) => isValidTagName(tag)).map((tag) => `tag:${tag}`);
}

/**
 * Converts scopes to their corresponding tags
 * @param scopes - Array of scope strings
 * @returns Array of tag names
 */
export function scopesToTags(scopes: string[]): string[] {
  if (!scopes || !Array.isArray(scopes)) {
    return [];
  }

  return scopes.map((scope) => extractTagFromScope(scope)).filter((tag) => tag !== null) as string[];
}

/**
 * Security utility to audit scope operations
 * @param operation - The operation being performed
 * @param context - Additional context for logging
 */
export function auditScopeOperation(
  operation: string,
  context: {
    clientId?: string;
    requestedScopes?: string[];
    grantedScopes?: string[];
    success?: boolean;
    error?: string;
  },
): void {
  logger.info(`Scope operation: ${operation}`, {
    operation,
    clientId: context.clientId,
    requestedScopes: context.requestedScopes,
    grantedScopes: context.grantedScopes,
    success: context.success,
    error: context.error,
    timestamp: new Date().toISOString(),
  });
}
