/**
 * Internal tool schemas for MCP installation operations
 *
 * This module contains schema definitions for MCP server installation,
 * uninstallation, and update management tools.
 */
import { z } from 'zod';

// ==================== INPUT SCHEMAS ====================

/**
 * Schema for mcp_install tool - Install MCP server
 */
export const McpInstallToolSchema = z.object({
  name: z.string().describe('Name for the MCP server configuration'),
  version: z.string().optional().describe('Version to install (latest if not specified)'),
  force: z.boolean().optional().default(false).describe('Force installation even if already exists'),
  backup: z.boolean().optional().default(true).describe('Create backup before installation'),
  tags: z.array(z.string()).optional().describe('Tags to assign to the server'),
  env: z.record(z.string(), z.string()).optional().describe('Environment variables for the server'),
  args: z.array(z.string()).optional().describe('Command line arguments for the server'),
  package: z.string().optional().describe('Package name (npm, pypi, or docker image)'),
  command: z.string().optional().describe('Command to run for stdio transport'),
  url: z.string().optional().describe('URL for HTTP/SSE transport'),
  transport: z.enum(['stdio', 'sse', 'http']).optional().default('stdio').describe('Transport type'),
  enabled: z.boolean().optional().default(true).describe('Enable server after installation'),
  autoRestart: z.boolean().optional().default(false).describe('Auto-restart server if it crashes'),
});

/**
 * Schema for mcp_uninstall tool - Remove MCP server
 */
export const McpUninstallToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to remove'),
  preserveConfig: z.boolean().optional().default(false).describe('Preserve configuration but disable server'),
  force: z.boolean().optional().default(false).describe('Force removal even if server is in use'),
  graceful: z.boolean().optional().default(true).describe('Gracefully stop server before uninstalling'),
  backup: z.boolean().optional().default(true).describe('Create backup before uninstallation'),
  removeAll: z.boolean().optional().default(false).describe('Remove all related data and dependencies'),
});

/**
 * Schema for mcp_update tool - Update MCP server
 */
export const McpUpdateToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to update'),
  version: z.string().optional().describe('Target version (latest if not specified)'),
  package: z.string().optional().describe('New package name if changing package'),
  autoRestart: z.boolean().optional().default(true).describe('Restart server after update'),
  backup: z.boolean().optional().default(true).describe('Backup current configuration before update'),
  force: z.boolean().optional().default(false).describe('Force update even if already latest version'),
  dryRun: z.boolean().optional().default(false).describe('Preview update without applying changes'),
});

// ==================== JSON SCHEMA EXAMPLES ====================

/**
 * JSON Schema for mcp_install tool - Example migration from Zod
 */
export const McpInstallToolJsonSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name for the MCP server configuration',
    },
    package: {
      type: 'string',
      description: 'Package name (npm, pypi, or docker image)',
    },
    version: {
      type: 'string',
      description: 'Version to install (latest if not specified)',
    },
    command: {
      type: 'string',
      description: 'Command to run for stdio transport',
    },
    args: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Arguments for the command',
    },
    url: {
      type: 'string',
      description: 'URL for HTTP/SSE transport',
    },
    transport: {
      type: 'string',
      enum: ['stdio', 'sse', 'http'],
      default: 'stdio',
      description: 'Transport type',
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Tags for server filtering',
    },
    enabled: {
      type: 'boolean',
      default: true,
      description: 'Enable server after installation',
    },
    autoRestart: {
      type: 'boolean',
      default: false,
      description: 'Auto-restart server if it crashes',
    },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

/**
 * JSON Schema for mcp_uninstall tool - Example migration from Zod
 */
export const McpUninstallToolJsonSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name of the MCP server to remove',
    },
    preserveConfig: {
      type: 'boolean',
      default: false,
      description: 'Preserve configuration but disable server',
    },
    force: {
      type: 'boolean',
      default: false,
      description: 'Force removal even if server is in use',
    },
    graceful: {
      type: 'boolean',
      default: true,
      description: 'Gracefully stop server before uninstalling',
    },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

// ==================== OUTPUT SCHEMAS ====================

/**
 * Output schema for mcp_install tool
 */
export const McpInstallOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'exists']).describe('Installation status'),
  message: z.string().describe('Status message'),
  package: z.string().optional().describe('Package that was installed'),
  version: z.string().optional().describe('Installed version'),
  location: z.string().optional().describe('Installation location'),
  error: z.string().optional().describe('Error message if failed'),
});

/**
 * Output schema for mcp_uninstall tool
 */
export const McpUninstallOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'not_found']).describe('Uninstallation status'),
  message: z.string().describe('Status message'),
  configPreserved: z.boolean().optional().describe('Whether configuration was preserved'),
  error: z.string().optional().describe('Error message if failed'),
});

/**
 * Output schema for mcp_update tool
 */
export const McpUpdateOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'not_found', 'up_to_date']).describe('Update status'),
  message: z.string().describe('Status message'),
  oldVersion: z.string().optional().describe('Previous version'),
  newVersion: z.string().optional().describe('Updated version'),
  backupCreated: z.boolean().optional().describe('Whether backup was created'),
  error: z.string().optional().describe('Error message if failed'),
});

// ==================== TYPE EXPORTS ====================

// Zod-inferred types (existing pattern)
export type McpInstallToolArgs = z.infer<typeof McpInstallToolSchema>;
export type McpUninstallToolArgs = z.infer<typeof McpUninstallToolSchema>;
export type McpUpdateToolArgs = z.infer<typeof McpUpdateToolSchema>;

// JSON Schema types (new pattern for migration)
export interface McpInstallToolJsonArgs {
  name: string;
  version?: string;
  force?: boolean;
  backup?: boolean;
  tags?: string[];
  env?: Record<string, string>;
  args?: string[];
  package?: string;
  command?: string;
  url?: string;
  transport?: 'stdio' | 'sse' | 'http';
  enabled?: boolean;
  autoRestart?: boolean;
}

export interface McpUninstallToolJsonArgs {
  name: string;
  preserveConfig?: boolean;
  force?: boolean;
  graceful?: boolean;
}

export interface McpUpdateToolJsonArgs {
  name: string;
  version?: string;
  package?: string;
  autoRestart?: boolean;
  backup?: boolean;
}

// Output types
export type McpInstallOutput = z.infer<typeof McpInstallOutputSchema>;
export type McpUninstallOutput = z.infer<typeof McpUninstallOutputSchema>;
export type McpUpdateOutput = z.infer<typeof McpUpdateOutputSchema>;
