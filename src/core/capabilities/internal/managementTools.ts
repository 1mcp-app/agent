/**
 * Internal MCP tool management creators
 *
 * This module contains factory functions for creating management-related internal MCP tools
 * including enable/disable, list, status, edit, and reload operations.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  McpDisableOutputSchema,
  McpDisableToolSchema,
  McpEditOutputSchema,
  McpEditToolSchema,
  McpEnableOutputSchema,
  McpEnableToolSchema,
  McpListOutputSchema,
  McpListToolSchema,
  McpReloadOutputSchema,
  McpReloadToolSchema,
  McpStatusOutputSchema,
  McpStatusToolSchema,
} from '@src/core/tools/internal/schemas/index.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

/**
 * Create enable tool definition
 */
export function createEnableTool(): Tool {
  return {
    name: 'mcp_enable',
    description: 'Enable an MCP server',
    inputSchema: zodToInputSchema(McpEnableToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpEnableOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Enable MCP Server',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    inputSchema: zodToInputSchema(McpDisableToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpDisableOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Disable MCP Server',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    inputSchema: zodToInputSchema(McpListToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpListOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'List MCP Servers',
      readOnlyHint: true,
      openWorldHint: false,
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
    inputSchema: zodToInputSchema(McpStatusToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpStatusOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Get Server Status',
      readOnlyHint: true,
      openWorldHint: false,
    },
  };
}

/**
 * Create edit tool definition
 */
export function createEditTool(): Tool {
  return {
    name: 'mcp_edit',
    description: 'Edit MCP server configuration',
    inputSchema: zodToInputSchema(McpEditToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpEditOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Edit Server Config',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
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
    inputSchema: zodToInputSchema(McpReloadToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpReloadOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Reload Server',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}
