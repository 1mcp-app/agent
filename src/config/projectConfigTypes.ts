import { z } from 'zod';

/**
 * Project-level configuration for .1mcprc file
 *
 * This file allows projects to specify default connection settings
 * that will be automatically detected by the proxy command.
 */

/**
 * Zod schema for .1mcprc validation
 */
export const ProjectConfigSchema = z.object({
  preset: z.string().optional(),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  filter: z.string().optional(),
});

/**
 * TypeScript interface for project configuration
 */
export interface ProjectConfig {
  preset?: string;
  tags?: string | string[];
  filter?: string;
}

/**
 * Validate project configuration
 */
export function validateProjectConfig(data: unknown): ProjectConfig {
  return ProjectConfigSchema.parse(data);
}
