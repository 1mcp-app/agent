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
 * Schema for mcp_registry_status tool - Check registry availability and performance
 */
export const McpRegistryStatusSchema = z.object({
  registry: z.string().optional().default('official').describe('Registry name or URL'),
});

/**
 * Schema for mcp_registry_info tool - Get detailed registry information
 */
export const McpRegistryInfoSchema = z.object({
  registry: z.string().optional().default('official').describe('Registry name or URL'),
});

/**
 * Schema for mcp_registry_list tool - List available registries
 */
export const McpRegistryListSchema = z.object({
  includeStats: z.boolean().optional().default(false).describe('Include package statistics'),
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
  graceful: z.boolean().optional().default(true).describe('Gracefully stop server before uninstalling'),
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
 * Schema for mcp_info tool - Get detailed information about specific MCP server
 */
export const McpInfoToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to get information about'),
  includeCapabilities: z.boolean().optional().default(true).describe('Include tools/resources/prompts list'),
  includeConfig: z.boolean().optional().default(true).describe('Include configuration details'),
  format: z.enum(['table', 'list', 'json']).optional().default('table').describe('Output format'),
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
  includeCapabilities: z.boolean().optional().default(false).describe('Include tool/resource/prompt counts'),
  includeHealth: z.boolean().optional().default(true).describe('Include health check results'),
  sortBy: z.enum(['name', 'status', 'transport', 'lastConnected']).optional().default('name').describe('Sort field'),
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

// ==================== OUTPUT SCHEMAS ====================

/**
 * Output schema for mcp_search tool
 */
export const McpSearchOutputSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string().describe('Package name'),
        version: z.string().describe('Latest version'),
        description: z.string().describe('Package description'),
        author: z.string().optional().describe('Package author'),
        tags: z.array(z.string()).describe('Package tags'),
        transport: z.array(z.string()).describe('Supported transports'),
        registry: z.string().describe('Source registry'),
        downloads: z.number().optional().describe('Download count'),
      }),
    )
    .describe('Search results'),
  total: z.number().describe('Total results found'),
  query: z.string().describe('Search query used'),
  registry: z.string().describe('Registry searched'),
});

/**
 * Output schema for mcp_registry_status tool
 */
export const McpRegistryStatusOutputSchema = z.object({
  registry: z.string().describe('Registry name'),
  status: z.enum(['online', 'offline', 'error']).describe('Registry status'),
  responseTime: z.number().optional().describe('Response time in milliseconds'),
  lastCheck: z.string().describe('Last check timestamp'),
  error: z.string().optional().describe('Error message if status is error'),
  metadata: z.record(z.string(), z.unknown()).optional().describe('Additional registry metadata'),
});

/**
 * Output schema for mcp_registry_info tool
 */
export const McpRegistryInfoOutputSchema = z.object({
  name: z.string().describe('Registry name'),
  url: z.string().describe('Registry URL'),
  description: z.string().describe('Registry description'),
  version: z.string().optional().describe('Registry API version'),
  supportedFormats: z.array(z.string()).describe('Supported data formats'),
  features: z.array(z.string()).describe('Available registry features'),
  statistics: z
    .object({
      totalPackages: z.number().optional().describe('Total packages available'),
      lastUpdated: z.string().optional().describe('Last update timestamp'),
    })
    .optional(),
});

/**
 * Output schema for mcp_registry_list tool
 */
export const McpRegistryListOutputSchema = z.object({
  registries: z
    .array(
      z.object({
        name: z.string().describe('Registry name'),
        url: z.string().describe('Registry URL'),
        status: z.enum(['online', 'offline', 'unknown']).describe('Current status'),
        description: z.string().describe('Registry description'),
        packageCount: z.number().optional().describe('Number of packages (if includeStats=true)'),
      }),
    )
    .describe('List of available registries'),
  total: z.number().describe('Total number of registries'),
});

/**
 * Output schema for mcp_info tool
 */
export const McpInfoOutputSchema = z.object({
  server: z
    .object({
      name: z.string().describe('Server name'),
      status: z.enum(['running', 'stopped', 'error', 'unknown']).describe('Current status'),
      transport: z.enum(['stdio', 'sse', 'http']).describe('Transport type'),
      lastConnected: z.string().optional().describe('Last connection timestamp'),
      uptime: z.string().optional().describe('Server uptime'),
    })
    .describe('Basic server information'),
  configuration: z
    .object({
      command: z.string().optional().describe('Command for stdio transport'),
      args: z.array(z.string()).optional().describe('Command arguments'),
      url: z.string().optional().describe('URL for HTTP/SSE transport'),
      tags: z.array(z.string()).describe('Server tags'),
      autoRestart: z.boolean().describe('Auto-restart setting'),
      enabled: z.boolean().describe('Enabled status'),
    })
    .optional()
    .describe('Server configuration'),
  capabilities: z
    .object({
      tools: z
        .array(
          z.object({
            name: z.string().describe('Tool name'),
            description: z.string().describe('Tool description'),
          }),
        )
        .optional()
        .describe('Available tools'),
      resources: z
        .array(
          z.object({
            uri: z.string().describe('Resource URI'),
            name: z.string().describe('Resource name'),
          }),
        )
        .optional()
        .describe('Available resources'),
      prompts: z
        .array(
          z.object({
            name: z.string().describe('Prompt name'),
            description: z.string().describe('Prompt description'),
          }),
        )
        .optional()
        .describe('Available prompts'),
    })
    .optional()
    .describe('Server capabilities'),
  health: z
    .object({
      status: z.enum(['healthy', 'unhealthy', 'unknown']).describe('Health status'),
      lastCheck: z.string().describe('Last health check'),
      responseTime: z.number().optional().describe('Response time in milliseconds'),
      error: z.string().optional().describe('Health error message'),
    })
    .optional()
    .describe('Health check information'),
});

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

/**
 * Output schema for mcp_enable tool
 */
export const McpEnableOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'already_enabled', 'not_found']).describe('Enable status'),
  message: z.string().describe('Status message'),
  restarted: z.boolean().optional().describe('Whether server was restarted'),
  error: z.string().optional().describe('Error message if failed'),
});

/**
 * Output schema for mcp_disable tool
 */
export const McpDisableOutputSchema = z.object({
  name: z.string().describe('Server name'),
  status: z.enum(['success', 'failed', 'already_disabled', 'not_found']).describe('Disable status'),
  message: z.string().describe('Status message'),
  graceful: z.boolean().optional().describe('Whether graceful shutdown was used'),
  error: z.string().optional().describe('Error message if failed'),
});

/**
 * Output schema for mcp_list tool (enhanced)
 */
export const McpListOutputSchema = z.object({
  servers: z
    .array(
      z.object({
        name: z.string().describe('Server name'),
        status: z.enum(['enabled', 'disabled', 'running', 'stopped', 'error']).describe('Server status'),
        transport: z.enum(['stdio', 'sse', 'http']).describe('Transport type'),
        tags: z.array(z.string()).optional().describe('Server tags'),
        lastConnected: z.string().optional().describe('Last connection timestamp'),
        uptime: z.string().optional().describe('Server uptime'),
        command: z.string().optional().describe('Command for stdio servers'),
        url: z.string().optional().describe('URL for HTTP/SSE servers'),
        healthStatus: z.enum(['healthy', 'unhealthy', 'unknown']).optional().describe('Health status'),
        capabilities: z
          .object({
            toolCount: z.number().optional().describe('Number of tools'),
            resourceCount: z.number().optional().describe('Number of resources'),
            promptCount: z.number().optional().describe('Number of prompts'),
          })
          .optional()
          .describe('Capability counts'),
      }),
    )
    .describe('List of MCP servers'),
  total: z.number().describe('Total number of servers'),
  summary: z
    .object({
      enabled: z.number().describe('Number of enabled servers'),
      disabled: z.number().describe('Number of disabled servers'),
      running: z.number().describe('Number of running servers'),
      stopped: z.number().describe('Number of stopped servers'),
    })
    .describe('Server status summary'),
});

/**
 * Output schema for mcp_status tool
 */
export const McpStatusOutputSchema = z.object({
  servers: z
    .array(
      z.object({
        name: z.string().describe('Server name'),
        status: z.enum(['running', 'stopped', 'error', 'unknown']).describe('Current status'),
        transport: z.enum(['stdio', 'sse', 'http']).describe('Transport type'),
        uptime: z.string().optional().describe('Server uptime'),
        lastConnected: z.string().optional().describe('Last connection timestamp'),
        pid: z.number().optional().describe('Process ID'),
        memoryUsage: z
          .object({
            rss: z.number().optional().describe('Resident set size in MB'),
            heapUsed: z.number().optional().describe('Heap used in MB'),
            heapTotal: z.number().optional().describe('Total heap size in MB'),
          })
          .optional()
          .describe('Memory usage information'),
        capabilities: z
          .object({
            tools: z.number().optional().describe('Number of tools'),
            resources: z.number().optional().describe('Number of resources'),
            prompts: z.number().optional().describe('Number of prompts'),
          })
          .optional()
          .describe('Capability summary'),
        health: z
          .object({
            status: z.enum(['healthy', 'unhealthy', 'unknown']).describe('Health status'),
            lastCheck: z.string().describe('Last health check'),
            responseTime: z.number().optional().describe('Response time in milliseconds'),
          })
          .optional()
          .describe('Health information'),
      }),
    )
    .describe('Server status information'),
  timestamp: z.string().describe('Status check timestamp'),
  overall: z
    .object({
      total: z.number().describe('Total servers'),
      running: z.number().describe('Running servers'),
      stopped: z.number().describe('Stopped servers'),
      errors: z.number().describe('Servers with errors'),
    })
    .describe('Overall status summary'),
});

/**
 * Output schema for mcp_reload tool
 */
export const McpReloadOutputSchema = z.object({
  target: z.enum(['server', 'config', 'all']).describe('What was reloaded'),
  status: z.enum(['success', 'failed', 'partial']).describe('Reload status'),
  message: z.string().describe('Status message'),
  affectedServers: z.array(z.string()).optional().describe('List of affected server names'),
  timestamp: z.string().describe('Reload timestamp'),
  duration: z.number().optional().describe('Reload duration in milliseconds'),
  error: z.string().optional().describe('Error message if failed'),
});

// Type exports for convenience
export type McpSearchToolArgs = z.infer<typeof McpSearchToolSchema>;
export type McpRegistryStatusToolArgs = z.infer<typeof McpRegistryStatusSchema>;
export type McpRegistryInfoToolArgs = z.infer<typeof McpRegistryInfoSchema>;
export type McpRegistryListToolArgs = z.infer<typeof McpRegistryListSchema>;
export type McpInstallToolArgs = z.infer<typeof McpInstallToolSchema>;
export type McpUninstallToolArgs = z.infer<typeof McpUninstallToolSchema>;
export type McpUpdateToolArgs = z.infer<typeof McpUpdateToolSchema>;
export type McpEnableToolArgs = z.infer<typeof McpEnableToolSchema>;
export type McpDisableToolArgs = z.infer<typeof McpDisableToolSchema>;
export type McpInfoToolArgs = z.infer<typeof McpInfoToolSchema>;
export type McpListToolArgs = z.infer<typeof McpListToolSchema>;
export type McpStatusToolArgs = z.infer<typeof McpStatusToolSchema>;
export type McpReloadToolArgs = z.infer<typeof McpReloadToolSchema>;
