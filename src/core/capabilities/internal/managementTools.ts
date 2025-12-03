/**
 * Internal MCP tool management creators
 *
 * This module contains factory functions for creating management-related internal MCP tools
 * including enable/disable, list, status, and reload operations.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  McpDisableOutputSchema,
  McpDisableToolSchema,
  McpEnableOutputSchema,
  McpEnableToolSchema,
  McpListOutputSchema,
  McpListToolSchema,
  McpReloadOutputSchema,
  McpReloadToolSchema,
  McpStatusOutputSchema,
  McpStatusToolSchema,
} from '@src/core/tools/internal/schemas/index.js';

import { z } from 'zod';

/**
 * Create enable tool definition
 */
export function createEnableTool(): Tool {
  return {
    name: 'mcp_enable',
    description: 'Enable an MCP server',
    inputSchema: z.toJSONSchema(McpEnableToolSchema) as Tool['inputSchema'],
    outputSchema: z.toJSONSchema(McpEnableOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create disable tool definition
 */
export function createDisableTool(): Tool {
  return {
    name: 'mcp_disable',
    description: 'Disable an MCP server',
    inputSchema: z.toJSONSchema(McpDisableToolSchema) as Tool['inputSchema'],
    outputSchema: z.toJSONSchema(McpDisableOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create list tool definition
 */
export function createListTool(): Tool {
  return {
    name: 'mcp_list',
    description: 'List MCP servers',
    inputSchema: z.toJSONSchema(McpListToolSchema) as Tool['inputSchema'],
    outputSchema: z.toJSONSchema(McpListOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create status tool definition
 */
export function createStatusTool(): Tool {
  return {
    name: 'mcp_status',
    description: 'Get MCP server status',
    inputSchema: z.toJSONSchema(McpStatusToolSchema) as Tool['inputSchema'],
    outputSchema: z.toJSONSchema(McpStatusOutputSchema) as Tool['outputSchema'],
  };
}

/**
 * Create reload tool definition
 */
export function createReloadTool(): Tool {
  return {
    name: 'mcp_reload',
    description: 'Reload MCP server or configuration',
    inputSchema: z.toJSONSchema(McpReloadToolSchema) as Tool['inputSchema'],
    outputSchema: z.toJSONSchema(McpReloadOutputSchema) as Tool['outputSchema'],
  };
}
