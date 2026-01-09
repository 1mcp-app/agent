/**
 * VitePress plugin for generating JSON Schema files from Zod schemas
 *
 * This plugin automatically generates JSON Schema files during documentation build,
 * enabling IDE autocompletion and validation for 1MCP configuration files.
 *
 * Schema version is independent from package version - only bump when schema structure changes.
 */
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

import type { Plugin } from 'vite';

import { ProjectConfigSchema } from '../../../src/config/projectConfigTypes.js';
import { mcpServerConfigSchema } from '../../../src/core/types/transport.js';
import {
  addSchemaPropertySupport,
  generateConfigSchema,
  generateMcpConfigSchema,
  SCHEMA_VERSION,
  writeSchemaFile,
} from '../utils/configSchemaGen.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

/**
 * Schema generation plugin configuration
 */
export interface SchemaGenPluginOptions {
  /**
   * Output directory for generated schemas (relative to docs root)
   */
  outDir?: string;

  /**
   * Whether to generate schemas (default: true)
   */
  enabled?: boolean;
}

/**
 * VitePress plugin for JSON Schema generation
 *
 * Generates schemas during build:
 * - mcp-config.json: From mcpServerConfigSchema
 * - project-config.json: From ProjectConfigSchema
 */
export function SchemaGenPlugin(options: SchemaGenPluginOptions = {}): Plugin {
  const { outDir = 'public/schemas', enabled = true } = options;

  return {
    name: 'vitepress-schema-gen',

    // Generate schemas after build but before writing output
    generateBundle: async () => {
      if (!enabled) {
        return;
      }

      try {
        // Generate MCP config schema
        const mcpConfigSchema = generateMcpConfigSchema(mcpServerConfigSchema, mcpServerConfigSchema);
        const mcpConfigWithSchema = addSchemaPropertySupport(mcpConfigSchema);
        const mcpConfigPath = join(process.cwd(), 'docs', outDir, SCHEMA_VERSION, 'mcp-config.json');
        await writeSchemaFile(mcpConfigWithSchema, mcpConfigPath);

        // Generate project config schema
        const projectConfigSchema = generateConfigSchema(
          ProjectConfigSchema,
          'project-config',
          'JSON Schema for 1MCP project-level configuration files',
        );
        const projectConfigWithSchema = addSchemaPropertySupport(projectConfigSchema);
        const projectConfigPath = join(process.cwd(), 'docs', outDir, SCHEMA_VERSION, 'project-config.json');
        await writeSchemaFile(projectConfigWithSchema, projectConfigPath);

        // Log generation results using process.stderr for build output
        const docsRoot = join(process.cwd(), 'docs');
        process.stderr.write(`[schema-gen] Generated schemas:\n`);
        process.stderr.write(`  - ${relative(docsRoot, mcpConfigPath)}\n`);
        process.stderr.write(`  - ${relative(docsRoot, projectConfigPath)}\n`);
      } catch (error) {
        process.stderr.write(
          `[schema-gen] Failed to generate schemas: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        throw error;
      }
    },
  };
}
