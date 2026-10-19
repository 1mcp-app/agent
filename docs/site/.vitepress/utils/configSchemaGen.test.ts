import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  addSchemaPropertySupport,
  generateConfigSchema,
  generateMcpConfigSchema,
  SCHEMA_BASE_URL,
  SCHEMA_VERSION,
  writeSchemaFile,
} from './configSchemaGen.js';

// Simple FileHelpers for tests (inline since vitest doesn't include docs/ in test pattern)
function createTempDir(prefix: string = 'schema-gen-test'): string {
  const tempDir = join(tmpdir(), `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupTempDir(tempDir: string): void {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe('configSchemaGen', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = createTempDir('schema-gen-test');
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
    vi.restoreAllMocks();
  });

  describe('generateConfigSchema', () => {
    it('should generate valid JSON Schema from Zod schema', () => {
      const testSchema = z.object({
        name: z.string(),
        count: z.number(),
      });

      const result = generateConfigSchema(testSchema, 'test-config', 'Test configuration');

      expect(result).toHaveProperty('$schema', 'https://json-schema.org/draft-07/schema#');
      expect(result).toHaveProperty('$id', `${SCHEMA_BASE_URL}/${SCHEMA_VERSION}/test-config.json`);
      expect(result).toHaveProperty('title');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('type', 'object');
    });

    it('should include schema version in metadata', () => {
      const testSchema = z.object({ value: z.string() });
      const result = generateConfigSchema(testSchema, 'test', 'Test');

      expect(result.$id).toContain(SCHEMA_VERSION);
      expect(result.title).toContain(SCHEMA_VERSION);
      expect(result.description).toContain(SCHEMA_VERSION);
    });

    it('should handle complex nested schemas', () => {
      const testSchema = z.object({
        nested: z.object({
          array: z.array(z.string()),
          optional: z.number().optional(),
        }),
      });

      const result = generateConfigSchema(testSchema, 'complex', 'Complex schema');

      expect(result).toHaveProperty('properties');
      expect(result.properties).toHaveProperty('nested');
    });

    it('should generate schema with required fields for non-optional properties', () => {
      const testSchema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      });

      const result = generateConfigSchema(testSchema, 'required-test', 'Test required fields');

      expect(result).toHaveProperty('required');
      expect(Array.isArray(result.required)).toBe(true);
      expect(result.required).toContain('required');
      expect(result.required).not.toContain('optional');
    });
  });

  describe('writeSchemaFile', () => {
    it('should create directory if it does not exist', async () => {
      const schema = { type: 'object' };
      const outputPath = join(tempDir, 'nested', 'dir', 'schema.json');

      await writeSchemaFile(schema, outputPath);

      const exists = await fsPromises
        .access(outputPath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should write schema with proper JSON formatting', async () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };
      const outputPath = join(tempDir, 'schema.json');

      await writeSchemaFile(schema, outputPath);

      const content = await fsPromises.readFile(outputPath, 'utf-8');
      expect(content).toBe(JSON.stringify(schema, null, 2));
    });

    it('should include newline at end of file', async () => {
      const schema = { type: 'object' };
      const outputPath = join(tempDir, 'schema.json');

      await writeSchemaFile(schema, outputPath);

      const content = await fsPromises.readFile(outputPath, 'utf-8');
      expect(content.endsWith('\n')).toBe(true);
    });
  });

  describe('addSchemaPropertySupport', () => {
    it('should add $schema property as optional', () => {
      const baseSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const result = addSchemaPropertySupport(baseSchema);
      const properties = result.properties as Record<string, unknown>;

      expect(properties).toHaveProperty('$schema');
      expect(properties.$schema).toEqual({
        type: 'string',
        format: 'uri',
        description: 'JSON Schema reference for IDE autocompletion and validation',
      });
      expect(properties).toHaveProperty('name');
    });

    it('should handle null or undefined properties', () => {
      const baseSchema = {
        type: 'object',
        properties: null,
      };

      const result = addSchemaPropertySupport(baseSchema);
      const properties = result.properties as Record<string, unknown>;

      expect(properties).toHaveProperty('$schema');
      expect(Object.keys(properties as object)).toHaveLength(1);
    });

    it('should preserve all existing properties', () => {
      const baseSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
          active: { type: 'boolean' },
        },
      };

      const result = addSchemaPropertySupport(baseSchema);
      const properties = result.properties as Record<string, unknown>;

      expect(properties).toHaveProperty('$schema');
      expect(properties).toHaveProperty('name');
      expect(properties).toHaveProperty('age');
      expect(properties).toHaveProperty('active');
    });

    it('should not modify the original schema object', () => {
      const baseSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const originalProperties = baseSchema.properties;
      addSchemaPropertySupport(baseSchema);

      expect(baseSchema.properties).toBe(originalProperties);
      expect(baseSchema.properties as Record<string, unknown>).not.toHaveProperty('$schema');
    });
  });

  describe('generateMcpConfigSchema', () => {
    it('should generate schema with mcpServers structure', () => {
      const testSchema = z.object({ test: z.string() });
      const result = generateMcpConfigSchema(testSchema, testSchema);

      expect(result).toHaveProperty('properties');
      expect(result.properties).toHaveProperty('mcpServers');
      expect(result.properties).toHaveProperty('$schema');
    });

    it('should include correct schema metadata', () => {
      const testSchema = z.object({ test: z.string() });
      const result = generateMcpConfigSchema(testSchema, testSchema);

      expect(result.$id).toContain('mcp-config.json');
      expect(result.title).toContain('1MCP Server Configuration');
      expect(result.title).toContain(SCHEMA_VERSION);
      expect(result.description).toContain(SCHEMA_VERSION);
    });

    it('should use correct $schema reference', () => {
      const testSchema = z.object({ test: z.string() });
      const result = generateMcpConfigSchema(testSchema, testSchema);

      expect(result.$schema).toBe('https://json-schema.org/draft-07/schema#');
    });
  });

  describe('SCHEMA_VERSION and SCHEMA_BASE_URL exports', () => {
    it('should export SCHEMA_VERSION constant', () => {
      expect(SCHEMA_VERSION).toBe('v1.0.0');
    });

    it('should export SCHEMA_BASE_URL constant', () => {
      expect(SCHEMA_BASE_URL).toBe('https://docs.1mcp.app/schemas');
    });
  });
});
