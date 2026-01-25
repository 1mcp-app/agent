/**
 * Configuration schema generation utilities
 *
 * Generates JSON Schema files from Zod schemas for IDE autocompletion support.
 * Schema version is independent from package version - only bump when schema structure changes.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';

import { z } from 'zod';

import { SCHEMA_BASE_URL, SCHEMA_VERSION } from '../../../src/constants/schema.js';

/**
 * Generate JSON Schema from Zod schema with proper metadata
 *
 * @param zodSchema - The Zod schema to convert
 * @param name - Schema name (used for filename and $id)
 * @param description - Human-readable description
 * @returns JSON Schema object with metadata
 */
export function generateConfigSchema(zodSchema: z.ZodType, name: string, description: string): Record<string, unknown> {
  try {
    // Convert Zod schema to JSON Schema using draft-07
    const schema = z.toJSONSchema(zodSchema, {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
    });

    // Build the schema ID with version
    const $id = `${SCHEMA_BASE_URL}/${SCHEMA_VERSION}/${name}.json`;

    // Create the full schema with metadata
    return {
      $schema: 'https://json-schema.org/draft-07/schema#',
      $id,
      title: `${name.replace(/-/g, ' ')} configuration schema ${SCHEMA_VERSION}`,
      description: `${description} (${SCHEMA_VERSION})`,
      ...schema,
    };
  } catch (error) {
    const message = `Failed to generate JSON schema for '${name}': ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`[schema-gen] ${message}\n`);
    throw new Error(message);
  }
}

/**
 * Write schema to file with proper formatting
 *
 * @param schema - JSON Schema object
 * @param outputPath - Full path to output file
 */
export async function writeSchemaFile(schema: Record<string, unknown>, outputPath: string): Promise<void> {
  try {
    // Ensure directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    // Write schema with proper formatting
    await writeFile(outputPath, JSON.stringify(schema, null, 2), 'utf-8');
  } catch (error) {
    const message = `Failed to write schema file to '${outputPath}': ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`[schema-gen] ${message}\n`);
    throw new Error(message);
  }
}

/**
 * Generate schema with configuration wrapper for mcp.json
 *
 * Wraps the transport config schema in the full MCP server configuration structure
 * that includes mcpServers, mcpTemplates, and templateSettings.
 *
 * @param _zodSchema - The base transport config schema (unused, kept for API compatibility)
 * @param fullConfigSchema - The full server config schema with mcpServers
 * @returns JSON Schema for complete mcp.json configuration
 */
export function generateMcpConfigSchema(_zodSchema: z.ZodType, fullConfigSchema: z.ZodType): Record<string, unknown> {
  try {
    // Convert the full config schema to JSON Schema
    const schema = z.toJSONSchema(fullConfigSchema, {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
    });

    const $id = `${SCHEMA_BASE_URL}/${SCHEMA_VERSION}/mcp-config.json`;

    return {
      $schema: 'https://json-schema.org/draft-07/schema#',
      $id,
      title: `1MCP Server Configuration ${SCHEMA_VERSION}`,
      description: `JSON Schema for 1MCP server configuration files (${SCHEMA_VERSION})`,
      ...schema,
    };
  } catch (error) {
    const message = `Failed to generate MCP config schema: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`[schema-gen] ${message}\n`);
    throw new Error(message);
  }
}

/**
 * Generate schema with $schema property support
 *
 * Ensures the generated schema includes the $schema property definition
 * so IDEs can validate it in config files.
 *
 * @param baseSchema - The base JSON schema
 * @returns JSON Schema with $schema property support
 */
export function addSchemaPropertySupport(baseSchema: Record<string, unknown>): Record<string, unknown> {
  // Safely extract properties with validation
  const properties =
    baseSchema.properties && typeof baseSchema.properties === 'object'
      ? (baseSchema.properties as Record<string, unknown>)
      : {};

  // Add $schema property as optional
  return {
    ...baseSchema,
    properties: {
      $schema: {
        type: 'string',
        format: 'uri',
        description: 'JSON Schema reference for IDE autocompletion and validation',
      },
      ...properties,
    },
  };
}

/**
 * Re-export schema constants for use in the plugin
 */
export { SCHEMA_BASE_URL, SCHEMA_VERSION } from '../../../src/constants/schema.js';
