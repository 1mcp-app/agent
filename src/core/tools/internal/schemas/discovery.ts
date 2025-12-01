/**
 * Internal tool schemas for MCP discovery operations
 *
 * This module contains schema definitions for MCP registry search,
 * server information discovery, and registry management tools.
 */
import { z } from 'zod';

// ==================== INPUT SCHEMAS ====================

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
  offset: z.number().optional().describe('Pagination offset for results'),
  cursor: z.string().optional().describe('Pagination cursor for next page'),
  tags: z.array(z.string()).optional().describe('Filter by tags'),
  category: z.string().optional().describe('Filter by category'),
  format: z.enum(['table', 'list', 'json']).optional().default('table').describe('Output format'),
});

/**
 * Schema for mcp_registry_status tool - Check registry availability and performance
 */
export const McpRegistryStatusSchema = z.object({
  registry: z.string().optional().default('official').describe('Registry name or URL'),
  includeStats: z.boolean().optional().default(false).describe('Include detailed statistics'),
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
 * Schema for mcp_info tool - Get detailed information about specific MCP server
 */
export const McpInfoToolSchema = z.object({
  name: z.string().describe('Name of the MCP server to get information about'),
  version: z.string().optional().describe('Specific version to query'),
  includeCapabilities: z.boolean().optional().default(true).describe('Include tools/resources/prompts list'),
  includeConfig: z.boolean().optional().default(true).describe('Include configuration details'),
  format: z.enum(['table', 'list', 'json']).optional().default('table').describe('Output format'),
});

// ==================== JSON SCHEMA EXAMPLES ====================

/**
 * JSON Schema for mcp_search tool - Example migration from Zod
 */
export const McpSearchToolJsonSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query for MCP servers',
    },
    status: {
      type: 'string',
      enum: ['active', 'archived', 'deprecated', 'all'],
      default: 'active',
      description: 'Filter by server status',
    },
    type: {
      type: 'string',
      enum: ['npm', 'pypi', 'docker'],
      description: 'Filter by package registry type',
    },
    transport: {
      type: 'string',
      enum: ['stdio', 'sse', 'http'],
      description: 'Filter by transport type',
    },
    limit: {
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 20,
      description: 'Maximum number of results to return',
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for next page',
    },
    format: {
      type: 'string',
      enum: ['table', 'list', 'json'],
      default: 'table',
      description: 'Output format',
    },
  },
  additionalProperties: false,
} as const;

/**
 * JSON Schema for mcp_registry_status tool - Example migration from Zod
 */
export const McpRegistryStatusJsonSchema = {
  type: 'object',
  properties: {
    registry: {
      type: 'string',
      default: 'official',
      description: 'Registry name or URL',
    },
  },
  additionalProperties: false,
} as const;

/**
 * JSON Schema for mcp_info tool - Example migration from Zod
 */
export const McpInfoToolJsonSchema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Name of the MCP server to get information about',
    },
    includeCapabilities: {
      type: 'boolean',
      default: true,
      description: 'Include tools/resources/prompts list',
    },
    includeConfig: {
      type: 'boolean',
      default: true,
      description: 'Include configuration details',
    },
    format: {
      type: 'string',
      enum: ['table', 'list', 'json'],
      default: 'table',
      description: 'Output format',
    },
  },
  required: ['name'],
  additionalProperties: false,
} as const;

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

// ==================== TYPE EXPORTS ====================

// Zod-inferred types (existing pattern)
export type McpSearchToolArgs = z.infer<typeof McpSearchToolSchema>;
export type McpRegistryStatusToolArgs = z.infer<typeof McpRegistryStatusSchema>;
export type McpRegistryInfoToolArgs = z.infer<typeof McpRegistryInfoSchema>;
export type McpRegistryListToolArgs = z.infer<typeof McpRegistryListSchema>;
export type McpInfoToolArgs = z.infer<typeof McpInfoToolSchema>;

// JSON Schema types (new pattern for migration)
export interface McpSearchToolJsonArgs {
  query?: string;
  status?: 'active' | 'archived' | 'deprecated' | 'all';
  type?: 'npm' | 'pypi' | 'docker';
  transport?: 'stdio' | 'sse' | 'http';
  limit?: number;
  offset?: number;
  cursor?: string;
  tags?: string[];
  category?: string;
  format?: 'table' | 'list' | 'json';
}

export interface McpRegistryStatusJsonArgs {
  registry?: string;
}

export interface McpInfoToolJsonArgs {
  name: string;
  includeCapabilities?: boolean;
  includeConfig?: boolean;
  format?: 'table' | 'list' | 'json';
}

// Output types
export type McpSearchOutput = z.infer<typeof McpSearchOutputSchema>;
export type McpRegistryStatusOutput = z.infer<typeof McpRegistryStatusOutputSchema>;
export type McpRegistryInfoOutput = z.infer<typeof McpRegistryInfoOutputSchema>;
export type McpRegistryListOutput = z.infer<typeof McpRegistryListOutputSchema>;
export type McpInfoOutput = z.infer<typeof McpInfoOutputSchema>;
