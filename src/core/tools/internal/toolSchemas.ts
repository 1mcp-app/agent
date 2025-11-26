/**
 * Internal management tools for managing the agent itself
 *
 * This module defines tool schemas for internal management operations
 * including discovery, installation, and management of MCP servers.
 */
import { z } from 'zod';

/**
 * Schema for mcp_search tool - Search MCP registry
 */
export const McpSearchToolSchema = z.object({
  query: z.string().optional().describe('Search query for MCP servers'),
  status: z
    .enum(['active', 'archived', 'deprecated', 'all'])
    .optional()
    .default('active')
    .describe('Filter by server status'),
  type: z.enum(['npm', 'pypi', 'docker']).optional().describe('Filter by package registry type'),
  transport: z.enum(['stdio', 'sse', 'http']).optional().describe('Filter by transport type'),
  limit: z.number().optional().default(20).describe('Maximum number of results to return'),
  cursor: z.string().optional().describe('Pagination cursor for next page'),
  format: z.enum(['table', 'list', 'json']).optional().default('table').describe('Output format'),
});

/**
 * Schema for mcp_install tool - Install MCP server
 */
export const McpInstallToolSchema = z.object({
  name: z.string().describe('Name for the MCP server configuration'),
  package: z.string().optional().describe('Package name (npm, pypi, or docker image)'),
  version: z.string().optional().describe('Version to install (latest if not specified)'),
  command: z.string().optional().describe('Command to run for stdio transport'),
  args: z.array(z.string()).optional().describe('Arguments for the command'),
  url: z.string().optional().describe('URL for HTTP/SSE transport'),
  transport: z.enum(['stdio', 'sse', 'http']).optional().default('stdio').describe('Transport type'),
  tags: z.array(z.string()).optional().describe('Tags for server filtering'),
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
});

/**
 * Schema for mcp_enable tool - Enable MCP server
 */
export const McpEnableToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to enable'),
  restart: z.boolean().optional().default(false).describe('Restart server if already running'),
});

/**
 * Schema for mcp_disable tool - Disable MCP server
 */
export const McpDisableToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to disable'),
  graceful: z.boolean().optional().default(true).describe('Gracefully stop server before disabling'),
});

/**
 * Schema for mcp_list tool - List MCP servers
 */
export const McpListToolSchema = z.object({
  status: z
    .enum(['enabled', 'disabled', 'running', 'stopped', 'all'])
    .optional()
    .default('all')
    .describe('Filter by server status'),
  transport: z.enum(['stdio', 'sse', 'http']).optional().describe('Filter by transport type'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  format: z.enum(['table', 'list', 'json']).optional().default('table').describe('Output format'),
  verbose: z.boolean().optional().default(false).describe('Show detailed information'),
});

/**
 * Schema for mcp_status tool - Get MCP server status
 */
export const McpStatusToolSchema = z.object({
  name: z.string().optional().describe('Name of specific MCP server (omit for all servers)'),
  details: z.boolean().optional().default(false).describe('Include detailed connection and capability information'),
  health: z.boolean().optional().default(true).describe('Include health check results'),
});

/**
 * Schema for mcp_reload tool - Reload MCP server or configuration
 */
export const McpReloadToolSchema = z.object({
  target: z.enum(['server', 'config', 'all']).optional().default('config').describe('What to reload'),
  name: z.string().optional().describe('Server name to reload (only when target is "server")'),
  graceful: z.boolean().optional().default(true).describe('Gracefully reload without disconnecting clients'),
  timeout: z.number().optional().default(30000).describe('Reload timeout in milliseconds'),
});

// Type exports for convenience
export type McpSearchToolArgs = z.infer<typeof McpSearchToolSchema>;
export type McpInstallToolArgs = z.infer<typeof McpInstallToolSchema>;
export type McpUninstallToolArgs = z.infer<typeof McpUninstallToolSchema>;
export type McpUpdateToolArgs = z.infer<typeof McpUpdateToolSchema>;
export type McpEnableToolArgs = z.infer<typeof McpEnableToolSchema>;
export type McpDisableToolArgs = z.infer<typeof McpDisableToolSchema>;
export type McpListToolArgs = z.infer<typeof McpListToolSchema>;
export type McpStatusToolArgs = z.infer<typeof McpStatusToolSchema>;
export type McpReloadToolArgs = z.infer<typeof McpReloadToolSchema>;
