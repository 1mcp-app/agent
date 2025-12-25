/**
 * Internal MCP tool discovery creators
 *
 * This module contains factory functions for creating discovery-related internal MCP tools
 * including search and registry management tools.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  McpInfoOutputSchema,
  McpInfoToolSchema,
  McpRegistryInfoOutputSchema,
  McpRegistryInfoSchema,
  McpRegistryListOutputSchema,
  McpRegistryListSchema,
  McpRegistryStatusOutputSchema,
  McpRegistryStatusSchema,
  McpSearchOutputSchema,
  McpSearchToolSchema,
} from '@src/core/tools/internal/schemas/index.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

/**
 * Create search tool definition
 */
export function createSearchTool(): Tool {
  return {
    name: 'mcp_search',
    description: 'Search for MCP servers in the registry',
    inputSchema: zodToInputSchema(McpSearchToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpSearchOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Search MCP Servers',
      readOnlyHint: true,
      openWorldHint: true,
    },
  };
}

// createRegistryTool function removed - mcp_registry tool has been deprecated and split into separate tools

/**
 * Create registry status tool definition
 */
export function createRegistryStatusTool(): Tool {
  return {
    name: 'mcp_registry_status',
    description: 'Check registry availability and performance',
    inputSchema: zodToInputSchema(McpRegistryStatusSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpRegistryStatusOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Check Registry Status',
      readOnlyHint: true,
      openWorldHint: true,
    },
  };
}

/**
 * Create registry info tool definition
 */
export function createRegistryInfoTool(): Tool {
  return {
    name: 'mcp_registry_info',
    description: 'Get detailed registry information',
    inputSchema: zodToInputSchema(McpRegistryInfoSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpRegistryInfoOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Get Registry Info',
      readOnlyHint: true,
      openWorldHint: true,
    },
  };
}

/**
 * Create registry list tool definition
 */
export function createRegistryListTool(): Tool {
  return {
    name: 'mcp_registry_list',
    description: 'List available registries',
    inputSchema: zodToInputSchema(McpRegistryListSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpRegistryListOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'List Registries',
      readOnlyHint: true,
      openWorldHint: true,
    },
  };
}

/**
 * Create info tool definition
 */
export function createInfoTool(): Tool {
  return {
    name: 'mcp_info',
    description: 'Get detailed information about a specific MCP server',
    inputSchema: zodToInputSchema(McpInfoToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpInfoOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Get Server Info',
      readOnlyHint: true,
      openWorldHint: true,
    },
  };
}
