/**
 * Internal MCP tool installation creators
 *
 * This module contains factory functions for creating installation-related internal MCP tools
 * including install, uninstall, and update operations.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  McpInstallOutputSchema,
  McpInstallToolSchema,
  McpUninstallOutputSchema,
  McpUninstallToolSchema,
  McpUpdateOutputSchema,
  McpUpdateToolSchema,
} from '@src/core/tools/internal/schemas/index.js';
import { zodToInputSchema, zodToOutputSchema } from '@src/utils/schemaUtils.js';

/**
 * Create install tool definition
 */
export function createInstallTool(): Tool {
  return {
    name: 'mcp_install',
    description:
      'Install a new MCP server. Use package+command+args for direct package installation (e.g., npm packages), or just name for registry-based installation',
    inputSchema: zodToInputSchema(McpInstallToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpInstallOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Install MCP Server',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  };
}

/**
 * Create uninstall tool definition
 */
export function createUninstallTool(): Tool {
  return {
    name: 'mcp_uninstall',
    description: 'Remove an MCP server',
    inputSchema: zodToInputSchema(McpUninstallToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpUninstallOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Uninstall MCP Server',
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}

/**
 * Create update tool definition
 */
export function createUpdateTool(): Tool {
  return {
    name: 'mcp_update',
    description: 'Update an MCP server',
    inputSchema: zodToInputSchema(McpUpdateToolSchema) as Tool['inputSchema'],
    outputSchema: zodToOutputSchema(McpUpdateOutputSchema) as Tool['outputSchema'],
    annotations: {
      title: 'Update MCP Server',
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
  };
}
