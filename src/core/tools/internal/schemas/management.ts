/**
 * Internal tool schemas for MCP management operations
 *
 * This module contains schema definitions for MCP server lifecycle management,
 * including enable/disable, listing, status monitoring, and reload operations.
 */
import { z } from 'zod';

// ==================== INPUT SCHEMAS ====================

/**
 * Schema for mcp_enable tool - Enable MCP server
 */
export const McpEnableToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to enable'),
  restart: z.boolean().optional().default(false).describe('Restart server if already running'),
  tags: z.array(z.string()).optional().describe('Tags to enable for'),
  graceful: z.boolean().optional().default(true).describe('Enable gracefully if possible'),
  timeout: z.number().optional().default(30).describe('Timeout in seconds'),
});

/**
 * Schema for mcp_disable tool - Disable MCP server
 */
export const McpDisableToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to disable'),
  graceful: z.boolean().optional().default(true).describe('Gracefully stop server before disabling'),
  timeout: z.number().optional().default(30).describe('Timeout in seconds'),
  tags: z.array(z.string()).optional().describe('Tags to disable for'),
  force: z.boolean().optional().default(false).describe('Force disable even if in use'),
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
  detailed: z.boolean().optional().default(false).describe('Show detailed information'),
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
  server: z.string().optional().describe('Server name to reload'),
  configOnly: z.boolean().optional().default(true).describe('Only reload configuration without restarting server'),
  graceful: z.boolean().optional().default(true).describe('Gracefully reload without disconnecting clients'),
  timeout: z.number().optional().default(30000).describe('Reload timeout in milliseconds'),
  force: z.boolean().optional().default(false).describe('Force reload even if no changes detected'),
});

// ==================== JSON SCHEMA EXAMPLES ====================

/**
 * JSON Schema for mcp_enable tool - Example migration from Zod
 */
export const McpEnableToolJsonSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name of the MCP server to enable',
    },
    restart: {
      type: 'boolean',
      default: false,
      description: 'Restart server if already running',
    },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

/**
 * JSON Schema for mcp_list tool - Example migration from Zod
 */
export const McpListToolJsonSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['enabled', 'disabled', 'running', 'stopped', 'all'],
      default: 'all',
      description: 'Filter by server status',
    },
    transport: {
      type: 'string',
      enum: ['stdio', 'sse', 'http'],
      description: 'Filter by transport type',
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Filter by tags',
    },
    format: {
      type: 'string',
      enum: ['table', 'list', 'json'],
      default: 'table',
      description: 'Output format',
    },
    verbose: {
      type: 'boolean',
      default: false,
      description: 'Show detailed information',
    },
    includeCapabilities: {
      type: 'boolean',
      default: false,
      description: 'Include tool/resource/prompt counts',
    },
    includeHealth: {
      type: 'boolean',
      default: true,
      description: 'Include health check results',
    },
    sortBy: {
      type: 'string',
      enum: ['name', 'status', 'transport', 'lastConnected'],
      default: 'name',
      description: 'Sort field',
    },
  },
  additionalProperties: false,
} as const;

/**
 * JSON Schema for mcp_reload tool - Example migration from Zod
 */
export const McpReloadToolJsonSchema = {
  type: 'object',
  properties: {
    target: {
      type: 'string',
      enum: ['server', 'config', 'all'],
      default: 'config',
      description: 'What to reload',
    },
    name: {
      type: 'string',
      description: 'Server name to reload (only when target is "server")',
    },
    graceful: {
      type: 'boolean',
      default: true,
      description: 'Gracefully reload without disconnecting clients',
    },
    timeout: {
      type: 'number',
      minimum: 1000,
      maximum: 300000,
      default: 30000,
      description: 'Reload timeout in milliseconds',
    },
  },
  additionalProperties: false,
} as const;

// ==================== OUTPUT SCHEMAS ====================

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

// ==================== TYPE EXPORTS ====================

// Zod-inferred types (existing pattern)
export type McpEnableToolArgs = z.infer<typeof McpEnableToolSchema>;
export type McpDisableToolArgs = z.infer<typeof McpDisableToolSchema>;
export type McpListToolArgs = z.infer<typeof McpListToolSchema>;
export type McpStatusToolArgs = z.infer<typeof McpStatusToolSchema>;
export type McpReloadToolArgs = z.infer<typeof McpReloadToolSchema>;

// JSON Schema types (new pattern for migration)
export interface McpEnableToolJsonArgs {
  name: string;
  restart?: boolean;
  tags?: string[];
  graceful?: boolean;
  timeout?: number;
}

export interface McpDisableToolJsonArgs {
  name: string;
  graceful?: boolean;
  timeout?: number;
  tags?: string[];
  force?: boolean;
}

export interface McpListToolJsonArgs {
  status?: 'enabled' | 'disabled' | 'running' | 'stopped' | 'all';
  transport?: 'stdio' | 'sse' | 'http';
  tags?: string[];
  format?: 'table' | 'list' | 'json';
  verbose?: boolean;
  includeCapabilities?: boolean;
  includeHealth?: boolean;
  sortBy?: 'name' | 'status' | 'transport' | 'lastConnected';
}

export interface McpStatusToolJsonArgs {
  name?: string;
  details?: boolean;
  health?: boolean;
}

export interface McpReloadToolJsonArgs {
  target?: 'server' | 'config' | 'all';
  name?: string;
  graceful?: boolean;
  timeout?: number;
  force?: boolean;
}

// Output types
export type McpEnableOutput = z.infer<typeof McpEnableOutputSchema>;
export type McpDisableOutput = z.infer<typeof McpDisableOutputSchema>;
export type McpListOutput = z.infer<typeof McpListOutputSchema>;
export type McpStatusOutput = z.infer<typeof McpStatusOutputSchema>;
export type McpReloadOutput = z.infer<typeof McpReloadOutputSchema>;
