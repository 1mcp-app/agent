import { CustomJsonSchemaValidator } from '@src/core/validation/CustomJsonSchemaValidator.js';

import { describe, expect, it } from 'vitest';

describe('CustomJsonSchemaValidator', () => {
  describe('missing definition handling', () => {
    it('should inject placeholder definition for missing SearchResult', () => {
      const validator = new CustomJsonSchemaValidator();

      const problematicSchema = {
        type: 'object',
        properties: {
          result: {
            type: 'array',
            items: {
              $ref: '#/$defs/SearchResult',
            },
          },
        },
      };

      const schemaValidator = validator.getValidator(problematicSchema);

      // The validator should be able to handle data with missing SearchResult
      const testData = {
        result: [{ id: 1, name: 'test' }],
      };

      const result = schemaValidator(testData);

      // Should validate successfully with placeholder definition
      expect(result.valid).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it('should inject placeholder definition for missing Error', () => {
      const validator = new CustomJsonSchemaValidator();

      const problematicSchema = {
        type: 'object',
        properties: {
          error: {
            $ref: '#/$defs/ApiError',
          },
        },
      };

      const schemaValidator = validator.getValidator(problematicSchema);

      const testData = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
        },
      };

      const result = schemaValidator(testData);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it('should create generic placeholder for unknown missing definitions', () => {
      const validator = new CustomJsonSchemaValidator();

      const problematicSchema = {
        type: 'object',
        properties: {
          data: {
            $ref: '#/$defs/UnknownType',
          },
        },
      };

      const schemaValidator = validator.getValidator(problematicSchema);

      const testData = {
        data: { someField: 'someValue' },
      };

      const result = schemaValidator(testData);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it('should not modify schemas with all definitions present', () => {
      const validator = new CustomJsonSchemaValidator();

      const completeSchema = {
        type: 'object',
        properties: {
          result: {
            type: 'array',
            items: {
              $ref: '#/$defs/SearchResult',
            },
          },
        },
        $defs: {
          SearchResult: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
            },
          },
        },
      };

      const schemaValidator = validator.getValidator(completeSchema);

      const testData = {
        result: [{ id: 1, name: 'test' }],
      };

      const result = schemaValidator(testData);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(testData);
    });

    it('should remove fake mcp.1mcp.app $id if present', () => {
      const validator = new CustomJsonSchemaValidator();

      const schemaWithFakeId = {
        $id: 'https://mcp.1mcp.app/generated-schema',
        type: 'object',
        properties: {},
      };

      // This should not throw an error and the fake ID should be removed
      const schemaValidator = validator.getValidator(schemaWithFakeId);

      expect(schemaValidator).toBeDefined();
    });

    it('should handle complex nested references', () => {
      const validator = new CustomJsonSchemaValidator();

      const complexSchema = {
        type: 'object',
        properties: {
          search: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: { $ref: '#/$defs/SearchResult' },
              },
              pagination: { $ref: '#/$defs/PaginationInfo' },
            },
          },
        },
      };

      const schemaValidator = validator.getValidator(complexSchema);

      const testData = {
        search: {
          results: [{ id: 1, name: 'test' }],
          pagination: { page: 1, total: 100 },
        },
      };

      const result = schemaValidator(testData);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(testData);
    });
  });

  describe('error handling', () => {
    it('should handle completely invalid schemas gracefully', () => {
      const validator = new CustomJsonSchemaValidator();

      const invalidSchema = null;

      const schemaValidator = validator.getValidator(invalidSchema);

      const result = schemaValidator('any data');

      expect(result.valid).toBe(true);
      expect(result.data).toBe('any data');
    });

    it('should handle circular references gracefully', () => {
      const validator = new CustomJsonSchemaValidator();

      const circularSchema = {
        type: 'object',
        properties: {
          node: {
            $ref: '#/$defs/Node',
          },
        },
      };

      const schemaValidator = validator.getValidator(circularSchema);

      const testData = {
        node: { value: 'test', next: null },
      };

      const result = schemaValidator(testData);

      expect(result.valid).toBe(true);
    });
  });

  describe('robustness', () => {
    it('should not mutate the original schema', () => {
      const validator = new CustomJsonSchemaValidator();
      const originalSchema = {
        type: 'object',
        properties: {
          result: {
            $ref: '#/$defs/Missing',
          },
        },
      };
      const schemaCopy = JSON.parse(JSON.stringify(originalSchema));

      validator.getValidator(originalSchema);

      expect(originalSchema).toEqual(schemaCopy);
      expect((originalSchema as any).$defs).toBeUndefined();
    });

    it('should support "definitions" keyword in addition to "$defs"', () => {
      const validator = new CustomJsonSchemaValidator();
      const schemaWithDefinitions = {
        type: 'object',
        properties: {
          result: {
            $ref: '#/definitions/Missing',
          },
        },
      };

      const schemaValidator = validator.getValidator(schemaWithDefinitions);
      const result = schemaValidator({ result: 'test' });

      expect(result.valid).toBe(true);
    });
  });
});
