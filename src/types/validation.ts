/**
 * Common validation result types shared across the codebase.
 */

/**
 * Base validation result with a single optional error message.
 * Used for validation operations that need to indicate success/failure
 * and optionally provide an error message.
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validation result for operations that may have multiple errors.
 * Used for validation operations that need to report multiple issues
 * (e.g., tag validation where multiple tags may be invalid).
 */
export interface TagsValidationResult {
  valid: boolean;
  errors: string[];
}
