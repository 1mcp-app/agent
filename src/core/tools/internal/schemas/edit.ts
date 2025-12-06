/**
 * Internal tool schemas for MCP configuration editing operations
 *
 * This module contains schema definitions for MCP server configuration editing,
 * including modifying server properties, environment variables, and transport-specific settings.
 */
import { z } from 'zod';

// ==================== INPUT SCHEMAS ====================

/**
 * Schema for mcp_edit tool - Edit MCP server configuration
 */
export const McpEditToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to edit'),

  // Basic server properties
  newName: z.string().optional().describe('New name for the server (renames the server)'),
  tags: z.array(z.string()).optional().describe('Replace all tags with new values'),
  disabled: z.boolean().optional().describe('Enable or disable the server'),
  timeout: z.number().min(0).optional().describe('Deprecated timeout value in milliseconds'),
  connectionTimeout: z.number().min(0).optional().describe('Connection timeout in milliseconds'),
  requestTimeout: z.number().min(0).optional().describe('Request timeout in milliseconds'),

  // Environment variables
  env: z.record(z.string(), z.string()).optional().describe('Environment variables (replaces all existing env vars)'),

  // Stdio transport properties
  command: z.string().optional().describe('Command for stdio transport'),
  args: z.array(z.string()).optional().describe('Command line arguments for stdio transport'),
  cwd: z.string().optional().describe('Working directory for stdio transport'),
  inheritParentEnv: z.boolean().optional().describe('Inherit parent environment for stdio transport'),
  envFilter: z.array(z.string()).optional().describe('Environment variable filter for stdio transport'),
  restartOnExit: z.boolean().optional().describe('Restart server on exit for stdio transport'),
  maxRestarts: z.number().min(0).optional().describe('Maximum restart attempts for stdio transport'),
  restartDelay: z.number().min(0).optional().describe('Delay between restarts in milliseconds for stdio transport'),

  // HTTP/SSE transport properties
  url: z.string().url().optional().describe('URL for HTTP/SSE transport'),
  headers: z.record(z.string(), z.string()).optional().describe('HTTP headers for HTTP/SSE transport'),

  // OAuth configuration
  oauth: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      autoRegister: z.boolean().optional(),
      redirectUrl: z.string().optional(),
    })
    .optional()
    .describe('OAuth configuration'),

  // Operation control
  preview: z.boolean().optional().describe('Preview changes without applying them'),
  backup: z.boolean().optional().describe('Create backup before applying changes'),
  interactive: z.boolean().optional().describe('Launch interactive editor mode'),
});

// ==================== OUTPUT SCHEMAS ====================

/**
 * Output schema for mcp_edit tool
 */
export const McpEditOutputSchema = z.object({
  success: z.boolean().describe('Whether the edit operation was successful'),
  message: z.string().describe('Status message describing the result'),
  serverName: z.string().describe('Name of the server that was edited'),

  // Change tracking
  changes: z
    .array(
      z.object({
        field: z.string().describe('Field name that was changed'),
        oldValue: z.unknown().optional().describe('Previous value'),
        newValue: z.unknown().optional().describe('New value'),
      }),
    )
    .optional()
    .describe('List of changes that were made'),

  // Operation results
  preview: z.boolean().optional().describe('Whether this was a preview operation'),
  backupPath: z.string().optional().describe('Path to backup file if created'),
  warnings: z.array(z.string()).optional().describe('Warning messages'),
  reloadRecommended: z.boolean().optional().describe('Whether server reload is recommended'),

  // Error handling
  error: z.string().optional().describe('Error message if the operation failed'),
});

// ==================== TYPE EXPORTS ====================

// Zod-inferred types (existing pattern)
export type McpEditToolArgs = z.infer<typeof McpEditToolSchema>;

// JSON Schema types (new pattern for migration)
export interface McpEditToolJsonArgs {
  name: string;
  newName?: string;
  tags?: string[];
  disabled?: boolean;
  timeout?: number;
  connectionTimeout?: number;
  requestTimeout?: number;
  env?: Record<string, string>;
  command?: string;
  args?: string[];
  cwd?: string;
  inheritParentEnv?: boolean;
  envFilter?: string[];
  restartOnExit?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
  url?: string;
  headers?: Record<string, string>;
  oauth?: {
    clientId?: string;
    clientSecret?: string;
    scopes?: string[];
    autoRegister?: boolean;
    redirectUrl?: string;
  };
  preview?: boolean;
  backup?: boolean;
  interactive?: boolean;
}

// Output types
export type McpEditOutput = z.infer<typeof McpEditOutputSchema>;

// Change tracking type
export interface ConfigChange {
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
}
