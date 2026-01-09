/**
 * Configuration schema generation utilities
 *
 * Generates JSON Schema files from Zod schemas for IDE autocompletion support.
 * Schema version is independent from package version - only bump when schema structure changes.
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';

import { z } from 'zod';

/**
 * Schema version configuration
 * This version is independent from package version and only changes when schema structure changes.
 */
export const SCHEMA_VERSION = 'v1.0.0';

/**
 * Base URL for schema hosting
 */
export const SCHEMA_BASE_URL = 'https://docs.1mcp.app/schemas';

/**
 * Generate JSON Schema from Zod schema with proper metadata
 *
 * @param zodSchema - The Zod schema to convert
 * @param name - Schema name (used for filename and $id)
 * @param description - Human-readable description
 * @returns JSON Schema object with metadata
 */
export function generateConfigSchema(zodSchema: z.ZodType, name: string, description: string): Record<string, unknown> {
  // Convert Zod schema to JSON Schema using draft-07
  const schema = z.toJSONSchema(zodSchema, {
    target: 'jsonSchema7',
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
}

/**
 * Write schema to file with proper formatting
 *
 * @param schema - JSON Schema object
 * @param outputPath - Full path to output file
 */
export async function writeSchemaFile(schema: Record<string, unknown>, outputPath: string): Promise<void> {
  // Ensure directory exists
  await mkdir(dirname(outputPath), { recursive: true });

  // Write schema with proper formatting
  await writeFile(outputPath, JSON.stringify(schema, null, 2), 'utf-8');
}

/**
 * Generate schema with configuration wrapper for mcp.json
 *
 * Wraps the transport config schema in the full MCP server configuration structure
 * that includes mcpServers, mcpTemplates, and templateSettings.
 *
 * @param zodSchema - The base transport config schema
 * @param fullConfigSchema - The full server config schema with mcpServers
 * @returns JSON Schema for complete mcp.json configuration
 */
export function generateMcpConfigSchema(zodSchema: z.ZodType, fullConfigSchema: z.ZodType): Record<string, unknown> {
  // Convert the full config schema to JSON Schema
  const schema = z.toJSONSchema(fullConfigSchema, {
    target: 'jsonSchema7',
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
  const properties = (baseSchema.properties as Record<string, unknown>) || {};

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
