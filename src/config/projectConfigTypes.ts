import { z } from 'zod';

/**
 * Project-level configuration for .1mcprc file
 *
 * This file allows projects to specify default connection settings
 * that will be automatically detected by the proxy command.
 *
 * Extended to support context collection and template parameters.
 */

/**
 * Context configuration schema
 */
export const ContextConfigSchema = z.object({
  projectId: z.string().optional(),
  environment: z.string().optional(),
  team: z.string().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
  envPrefixes: z.array(z.string()).optional(),
  includeGit: z.boolean().default(true),
  sanitizePaths: z.boolean().default(true),
});

/**
 * Zod schema for .1mcprc validation
 */
export const ProjectConfigSchema = z.object({
  preset: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  filter: z.string().optional(),
  context: ContextConfigSchema.optional(),
});

/**
 * TypeScript interface for context configuration
 */
export interface ContextConfig {
  projectId?: string;
  environment?: string;
  team?: string;
  custom?: Record<string, unknown>;
  envPrefixes?: string[];
  includeGit?: boolean;
  sanitizePaths?: boolean;
}

/**
 * TypeScript interface for project configuration
 */
export interface ProjectConfig {
  preset?: string;
  tags?: string | string[];
  filter?: string;
  context?: ContextConfig;
}

/**
 * Validate project configuration
 */
export function validateProjectConfig(data: unknown): ProjectConfig {
  return ProjectConfigSchema.parse(data);
}

/**
 * Validate context configuration
 */
export function validateContextConfig(data: unknown): ContextConfig {
  return ContextConfigSchema.parse(data);
}
