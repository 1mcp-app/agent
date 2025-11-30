/**
 * Internal MCP tool management creators
 *
 * This module contains factory functions for creating management-related internal MCP tools
 * including enable/disable, list, status, and reload operations.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Create enable tool definition
 */
export function createEnableTool(): Tool {
  return {
    name: 'mcp_enable',
    description: 'Enable an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to enable',
        },
        restart: {
          type: 'boolean',
          description: 'Restart server if already running',
          default: false,
        },
      },
      required: ['name'],
    },
  };
}

/**
 * Create disable tool definition
 */
export function createDisableTool(): Tool {
  return {
    name: 'mcp_disable',
    description: 'Disable an MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to disable',
        },
        graceful: {
          type: 'boolean',
          description: 'Gracefully stop server before disabling',
          default: true,
        },
      },
      required: ['name'],
    },
  };
}

/**
 * Create list tool definition
 */
export function createListTool(): Tool {
  return {
    name: 'mcp_list',
    description: 'List MCP servers',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['enabled', 'disabled', 'running', 'stopped', 'all'],
          description: 'Filter by server status',
          default: 'all',
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'sse', 'http'],
          description: 'Filter by transport type',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags',
        },
        format: {
          type: 'string',
          enum: ['table', 'list', 'json'],
          description: 'Output format',
          default: 'table',
        },
        verbose: {
          type: 'boolean',
          description: 'Show detailed information',
          default: false,
        },
        includeCapabilities: {
          type: 'boolean',
          description: 'Include tool/resource/prompt counts',
          default: false,
        },
        includeHealth: {
          type: 'boolean',
          description: 'Include health check results',
          default: true,
        },
        sortBy: {
          type: 'string',
          enum: ['name', 'status', 'transport', 'lastConnected'],
          description: 'Sort field',
          default: 'name',
        },
      },
    },
  };
}

/**
 * Create status tool definition
 */
export function createStatusTool(): Tool {
  return {
    name: 'mcp_status',
    description: 'Get MCP server status',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of specific MCP server (omit for all servers)',
        },
        details: {
          type: 'boolean',
          description: 'Include detailed connection and capability information',
          default: false,
        },
        health: {
          type: 'boolean',
          description: 'Include health check results',
          default: true,
        },
      },
    },
  };
}

/**
 * Create reload tool definition
 */
export function createReloadTool(): Tool {
  return {
    name: 'mcp_reload',
    description: 'Reload MCP server or configuration',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['server', 'config', 'all'],
          description: 'What to reload',
          default: 'config',
        },
        name: {
          type: 'string',
          description: 'Server name to reload (only when target is "server")',
        },
        graceful: {
          type: 'boolean',
          description: 'Gracefully reload without disconnecting clients',
          default: true,
        },
        timeout: {
          type: 'number',
          description: 'Reload timeout in milliseconds',
          default: 30000,
        },
      },
    },
  };
}
