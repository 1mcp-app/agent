/**
 * Custom JSON Schema Validator to handle MCP SDK Ajv validation issues
 *
 * This validator mimics the interface of AjvJsonSchemaValidator to handle complex schemas
 * with internal references like $ref: '#/$defs/Finding' that cause validation errors.
 */
import type {
  JsonSchemaValidator,
  jsonSchemaValidator,
  JsonSchemaValidatorResult,
} from '@modelcontextprotocol/sdk/validation';

import type { Ajv as AjvType, AnySchema, ErrorObject } from 'ajv';
import Ajv from 'ajv';

/**
 * Custom validator that handles problematic schemas gracefully
 */
export class CustomJsonSchemaValidator implements jsonSchemaValidator {
  private readonly ajv: AjvType;
  private readonly fallbackAjv: AjvType;

  constructor() {
    // Create Ajv instances using factory pattern to avoid type issues
    this.ajv = this.createAjvInstance({
      strict: false,
      validateFormats: false, // Skip format validation to avoid additional errors
      validateSchema: false, // Skip schema meta-validation
      allErrors: true,
      addUsedSchema: false, // Don't add schemas to prevent conflicts
      inlineRefs: false, // Don't inline refs to maintain proper structure
      verbose: true,
      removeAdditional: true, // Remove additional properties to be more permissive
    });

    // Fallback Ajv instance for when primary validation fails
    this.fallbackAjv = this.createAjvInstance({
      strict: false,
      validateFormats: false,
      validateSchema: false,
      allErrors: false, // Only report first error in fallback
      addUsedSchema: false,
      inlineRefs: false,
    });

    // Add formats support if available
    this.addFormatsSupport();
  }

  /**
   * Create Ajv instance with type-safe constructor
   */
  private createAjvInstance(options: Record<string, unknown>): AjvType {
    // Use dynamic instantiation to avoid TypeScript constructor issues
    const AjvConstructor = Ajv as unknown as new (options: Record<string, unknown>) => AjvType;
    return new AjvConstructor(options);
  }

  /**
   * Add format support to Ajv instances if ajv-formats is available
   */
  private async addFormatsSupport(): Promise<void> {
    try {
      const addFormatsModule = await import('ajv-formats');
      const addFormats = (addFormatsModule.default || addFormatsModule) as unknown as (ajv: AjvType) => void;
      addFormats(this.ajv);
      addFormats(this.fallbackAjv);
    } catch {
      // If ajv-formats is not available, continue without format validation
      console.warn('ajv-formats not available, continuing without format validation');
    }
  }

  /**
   * Create a validator for the given JSON Schema
   * Automatically patches schemas to include missing $defs and handles problematic schemas
   */
  getValidator<T>(schema: unknown): JsonSchemaValidator<T> {
    try {
      // Automatically patch the original schema to include missing $defs
      this.patchSchemaWithMissingDefs(schema);

      // Try to compile with the now-patched schema
      const primaryValidator = this.ajv.compile(schema as AnySchema);

      return (input: unknown): JsonSchemaValidatorResult<T> => {
        try {
          const isValid = primaryValidator(input);
          if (isValid) {
            return {
              valid: true,
              data: input as T,
              errorMessage: undefined,
            };
          } else {
            const errors = primaryValidator.errors ?? [];
            return {
              valid: false,
              data: undefined,
              errorMessage: this.formatErrors(errors),
            };
          }
        } catch (_error) {
          // If primary validation fails, try fallback
          return this.validateWithFallback<T>(input, schema);
        }
      };
    } catch (_error) {
      // If schema compilation fails, create a very permissive fallback validator
      return this.createLenientValidator<T>(schema);
    }
  }

  /**
   * Automatically patch schema in-place to add missing $defs
   * This ensures the schema object is modified directly, so callers get the complete schema
   */
  private patchSchemaWithMissingDefs(schema: unknown): void {
    if (!schema || typeof schema !== 'object') {
      return;
    }

    const schemaObj = schema as Record<string, unknown>;

    // First, collect all referenced definitions that are missing
    const missingDefs = this.findMissingDefinitions(schema);

    // Inject placeholder definitions for missing ones
    if (missingDefs.length > 0) {
      // Check if schema uses $defs or definitions
      if (schemaObj.$defs !== undefined) {
        // Schema already has $defs, add missing ones
        this.injectPlaceholderDefinitions(schemaObj.$defs as Record<string, unknown>, missingDefs);
      } else if (schemaObj.definitions !== undefined) {
        // Schema uses definitions (legacy format), add missing ones
        this.injectPlaceholderDefinitions(schemaObj.definitions as Record<string, unknown>, missingDefs);
      } else {
        // No definitions section, create $defs (preferred modern format)
        schemaObj.$defs = {} as Record<string, unknown>;
        this.injectPlaceholderDefinitions(schemaObj.$defs as Record<string, unknown>, missingDefs);
      }
    }

    // Remove fake $id that doesn't solve the real problem
    if (schemaObj.$id === 'https://mcp.1mcp.app/generated-schema') {
      delete schemaObj.$id;
    }
  }

  /**
   * Preprocess schema to handle common issues with MCP server schemas
   */
  public preprocessSchema(schema: unknown): unknown {
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const schemaObj = schema as Record<string, unknown>;
    const processed = { ...schemaObj };

    // First, collect all referenced definitions that are missing
    const missingDefs = this.findMissingDefinitions(schema);

    // Inject placeholder definitions for missing ones
    if (missingDefs.length > 0) {
      if (!processed.$defs) {
        processed.$defs = {} as Record<string, unknown>;
      }
      this.injectPlaceholderDefinitions(processed.$defs as Record<string, unknown>, missingDefs);
    }

    // Remove fake $id that doesn't solve the real problem
    if (processed.$id === 'https://mcp.1mcp.app/generated-schema') {
      delete processed.$id;
    }

    return processed;
  }

  /**
   * Find all missing $defs referenced in the schema
   */
  private findMissingDefinitions(schema: unknown): string[] {
    const missingDefs = new Set<string>();
    const existingDefs = new Set<string>();

    // Collect existing definitions from both $defs and definitions
    if (schema && typeof schema === 'object') {
      const schemaObj = schema as Record<string, unknown>;

      if (schemaObj.$defs && typeof schemaObj.$defs === 'object') {
        Object.keys(schemaObj.$defs).forEach((key) => existingDefs.add(key));
      }

      if (schemaObj.definitions && typeof schemaObj.definitions === 'object') {
        Object.keys(schemaObj.definitions).forEach((key) => existingDefs.add(key));
      }
    }

    // Recursively find all $ref references
    const findRefs = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object') {
        return;
      }

      if (Array.isArray(obj)) {
        obj.forEach(findRefs);
        return;
      }

      const objRecord = obj as Record<string, unknown>;
      for (const [key, value] of Object.entries(objRecord)) {
        if (key === '$ref' && typeof value === 'string') {
          // Extract definition name from $ref like "#/$defs/SearchResult" or "#/definitions/SearchResult"
          const defsMatch = value.match(/^#\/\$defs\/([^/]+)$/);
          const definitionsMatch = value.match(/^#\/definitions\/([^/]+)$/);

          const match = defsMatch || definitionsMatch;
          if (match && !existingDefs.has(match[1])) {
            missingDefs.add(match[1]);
          }
        } else {
          findRefs(value);
        }
      }
    };

    findRefs(schema);
    return Array.from(missingDefs);
  }

  /**
   * Inject placeholder definitions for missing ones
   */
  private injectPlaceholderDefinitions(defs: Record<string, unknown>, missingDefs: string[]): void {
    for (const defName of missingDefs) {
      if (!defs[defName]) {
        // Create a permissive placeholder definition
        defs[defName] = this.createPlaceholderDefinition(defName);
      }
    }
  }

  /**
   * Create a placeholder definition that accepts most data types
   */
  private createPlaceholderDefinition(defName: string): Record<string, unknown> {
    // Common placeholder types based on naming patterns
    if (defName.toLowerCase().includes('result') || defName.toLowerCase().includes('response')) {
      return {
        type: 'object',
        properties: {
          data: {
            type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
          },
          status: { type: 'string' },
          message: { type: 'string' },
        },
        additionalProperties: true,
        description: `Placeholder definition for ${defName} (auto-generated by 1MCP)`,
      };
    }

    if (defName.toLowerCase().includes('error')) {
      return {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: ['object', 'string'] },
        },
        additionalProperties: true,
        description: `Placeholder error definition for ${defName} (auto-generated by 1MCP)`,
      };
    }

    // Generic fallback - accepts most common types
    return {
      type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
      description: `Placeholder definition for ${defName} (auto-generated by 1MCP)`,
    };
  }

  /**
   * Validate using fallback Ajv instance
   */
  private validateWithFallback<T>(input: unknown, schema: unknown): JsonSchemaValidatorResult<T> {
    try {
      const fallbackValidator = this.fallbackAjv.compile(schema as AnySchema);
      const isValid = fallbackValidator(input);

      if (isValid) {
        return {
          valid: true,
          data: input as T,
          errorMessage: undefined,
        };
      } else {
        const errors = fallbackValidator.errors ?? [];
        return {
          valid: false,
          data: undefined,
          errorMessage: this.formatErrors(errors),
        };
      }
    } catch (fallbackError) {
      // If even fallback fails, return a permissive validation
      console.warn(
        `Validation bypassed due to schema compilation errors: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      );
      return {
        valid: true,
        data: input as T,
        errorMessage: undefined,
      };
    }
  }

  /**
   * Create a very lenient validator that always passes validation
   * Used as a last resort when schema compilation completely fails
   */
  private createLenientValidator<T>(_schema: unknown): JsonSchemaValidator<T> {
    console.warn(`Validation bypassed due to invalid schema structure`);
    return (input: unknown): JsonSchemaValidatorResult<T> => {
      return {
        valid: true,
        data: input as T,
        errorMessage: undefined,
      };
    };
  }

  /**
   * Format Ajv errors into a readable message
   */
  private formatErrors(errors: ErrorObject[] | null | undefined): string {
    if (!errors || !Array.isArray(errors) || errors.length === 0) {
      return 'Unknown validation error';
    }

    const errorMessages = errors
      .map((error) => {
        const message = error.message ?? 'Validation error';
        const instancePath = error.instancePath ?? '';
        const schemaPath = error.schemaPath ?? '';
        return `${message} at ${instancePath} (${schemaPath})`;
      })
      .slice(0, 5); // Limit to first 5 errors

    return errorMessages.join('; ');
  }
}
