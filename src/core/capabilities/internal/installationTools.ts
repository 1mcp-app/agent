/**
 * Internal MCP tool installation creators
 *
 * This module contains factory functions for creating installation-related internal MCP tools
 * including install, uninstall, and update operations.
 */
import { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Create install tool definition
 */
export function createInstallTool(): Tool {
  return {
    name: 'mcp_install',
    description: 'Install a new MCP server',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name for the MCP server configuration',
        },
        package: {
          type: 'string',
          description: 'Package name (npm, pypi, or docker image)',
        },
        version: {
          type: 'string',
          description: 'Version to install (latest if not specified)',
        },
        command: {
          type: 'string',
          description: 'Command to run for stdio transport',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments for the command',
        },
        url: {
          type: 'string',
          description: 'URL for HTTP/SSE transport',
        },
        transport: {
          type: 'string',
          enum: ['stdio', 'sse', 'http'],
          description: 'Transport type',
          default: 'stdio',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for server filtering',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable server after installation',
          default: true,
        },
        autoRestart: {
          type: 'boolean',
          description: 'Auto-restart server if it crashes',
          default: false,
        },
      },
      required: ['name'],
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
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to remove',
        },
        preserveConfig: {
          type: 'boolean',
          description: 'Preserve configuration but disable server',
          default: false,
        },
        force: {
          type: 'boolean',
          description: 'Force removal even if server is in use',
          default: false,
        },
      },
      required: ['name'],
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
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the MCP server to update',
        },
        version: {
          type: 'string',
          description: 'Target version (latest if not specified)',
        },
        package: {
          type: 'string',
          description: 'New package name if changing package',
        },
        autoRestart: {
          type: 'boolean',
          description: 'Restart server after update',
          default: true,
        },
        backup: {
          type: 'boolean',
          description: 'Backup current configuration before update',
          default: true,
        },
      },
      required: ['name'],
    },
  };
}
