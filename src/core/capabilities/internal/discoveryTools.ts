/**
 * Internal MCP tool discovery creators
 *
 * This module contains factory functions for creating discovery-related internal MCP tools
 * including search and registry management tools.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Create search tool definition
 */
export function createSearchTool(): Tool {
  return {
    name: 'mcp_search',
    description: 'Search for MCP servers in the registry',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for MCP servers',
        },
        status: {
          type: 'string',
          enum: ['active', 'archived', 'deprecated', 'all'],
          description: 'Filter by server status',
          default: 'active',
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
          description: 'Maximum number of results to return',
          default: 20,
        },
        cursor: {
          type: 'string',
          description: 'Pagination cursor for next page',
        },
        format: {
          type: 'string',
          enum: ['table', 'list', 'json'],
          description: 'Output format',
          default: 'table',
        },
      },
    },
  };
}

/**
 * Create registry tool definition
 */
export function createRegistryTool(): Tool {
  return {
    name: 'mcp_registry',
    description: 'Get information about MCP registries',
    inputSchema: {
      type: 'object',
      properties: {
        registry: {
          type: 'string',
          description: 'Registry name or URL',
          default: 'official',
        },
        action: {
          type: 'string',
          enum: ['info', 'status', 'list'],
          description: 'Registry action to perform',
          default: 'status',
        },
      },
    },
  };
}

/**
 * Create registry status tool definition
 */
export function createRegistryStatusTool(): Tool {
  return {
    name: 'mcp_registry_status',
    description: 'Check registry availability and performance',
    inputSchema: {
      type: 'object',
      properties: {
        registry: {
          type: 'string',
          description: 'Registry name or URL',
          default: 'official',
        },
      },
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
    inputSchema: {
      type: 'object',
      properties: {
        registry: {
          type: 'string',
          description: 'Registry name or URL',
          default: 'official',
        },
      },
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
    inputSchema: {
      type: 'object',
      properties: {
        includeStats: {
          type: 'boolean',
          description: 'Include package statistics',
          default: false,
        },
      },
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
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to get information about',
        },
        includeCapabilities: {
          type: 'boolean',
          description: 'Include tools/resources/prompts list',
          default: true,
        },
        includeConfig: {
          type: 'boolean',
          description: 'Include configuration details',
          default: true,
        },
        format: {
          type: 'string',
          enum: ['table', 'list', 'json'],
          description: 'Output format',
          default: 'table',
        },
      },
      required: ['name'],
    },
  };
}
