/**
 * Common validation result types shared across the codebase.
 */

/**
 * Base validation result with a single optional error message.
 * Used for validation operations that need to indicate success/failure
 * and optionally provide an error message.
 *
 * Uses discriminated union to prevent invalid states at compile time.
 */
export type ValidationResult = { valid: true } | { valid: false; error: string };

/**
 * Validation result for operations that may have multiple errors.
 * Used for validation operations that need to report multiple issues
 * (e.g., tag validation where multiple tags may be invalid).
 *
 * Uses discriminated union to prevent invalid states at compile time.
 */
export type TagsValidationResult = { valid: true } | { valid: false; errors: readonly string[] };
