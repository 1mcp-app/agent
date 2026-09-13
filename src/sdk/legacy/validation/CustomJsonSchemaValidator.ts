import type { JsonSchemaValidator, jsonSchemaValidator } from '@src/sdk/legacy/validation.js';

/** SDK convenience validators are synchronous and cannot own untrusted schema execution.
 * Runtime adapters use raw request codecs; the async SchemaBoundary is authoritative.
 * Accidental SDK convenience-method use fails closed instead of running on the event loop.
 */
export class CustomJsonSchemaValidator implements jsonSchemaValidator {
  getValidator<T>(_schema: unknown): JsonSchemaValidator<T> {
    return () => ({ valid: false, data: undefined, errorMessage: 'schema_evaluation_unavailable' });
  }
}
