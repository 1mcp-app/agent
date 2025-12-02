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
import { zodToJsonSchema } from '@src/core/tools/internal/utils/schemaUtils.js';

/**
 * Create search tool definition
 */
export function createSearchTool(): Tool {
  return {
    name: 'mcp_search',
    description: 'Search for MCP servers in the registry',
    inputSchema: zodToJsonSchema(McpSearchToolSchema) as Tool['inputSchema'],
    outputSchema: zodToJsonSchema(McpSearchOutputSchema) as Tool['outputSchema'],
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
    inputSchema: zodToJsonSchema(McpRegistryStatusSchema) as Tool['inputSchema'],
    outputSchema: zodToJsonSchema(McpRegistryStatusOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create registry info tool definition
 */
export function createRegistryInfoTool(): Tool {
  return {
    name: 'mcp_registry_info',
    description: 'Get detailed registry information',
    inputSchema: zodToJsonSchema(McpRegistryInfoSchema) as Tool['inputSchema'],
    outputSchema: zodToJsonSchema(McpRegistryInfoOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create registry list tool definition
 */
export function createRegistryListTool(): Tool {
  return {
    name: 'mcp_registry_list',
    description: 'List available registries',
    inputSchema: zodToJsonSchema(McpRegistryListSchema) as Tool['inputSchema'],
    outputSchema: zodToJsonSchema(McpRegistryListOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create info tool definition
 */
export function createInfoTool(): Tool {
  return {
    name: 'mcp_info',
    description: 'Get detailed information about a specific MCP server',
    inputSchema: zodToJsonSchema(McpInfoToolSchema) as Tool['inputSchema'],
    outputSchema: zodToJsonSchema(McpInfoOutputSchema) as Tool['outputSchema'],
  };
}
