/**
 * Internal capabilities provider for internal management tools
 *
 * This module provides internal MCP tools for managing the agent itself.
 * It acts as a special internal capabilities provider that exposes management capabilities.
 */
import { EventEmitter } from 'events';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { FlagManager } from '@src/core/flags/flagManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  cleanupInternalToolHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpInstall,
  handleMcpList,
  handleMcpReload,
  handleMcpSearch,
  handleMcpStatus,
  handleMcpUninstall,
  handleMcpUpdate,
} from '@src/core/tools/internal/toolHandlers.js';
import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpInstallToolArgs,
  McpListToolArgs,
  McpReloadToolArgs,
  McpSearchToolArgs,
  McpStatusToolArgs,
  McpUninstallToolArgs,
  McpUpdateToolArgs,
} from '@src/core/tools/internal/toolSchemas.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Internal capabilities provider that serves internal management tools
 */
export class InternalCapabilitiesProvider extends EventEmitter {
  private static instance: InternalCapabilitiesProvider | undefined;
  private configManager: AgentConfigManager;
  private flagManager: FlagManager;
  private isInitialized = false;

  private constructor() {
    super();
    this.configManager = AgentConfigManager.getInstance();
    this.flagManager = FlagManager.getInstance();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): InternalCapabilitiesProvider {
    if (!InternalCapabilitiesProvider.instance) {
      InternalCapabilitiesProvider.instance = new InternalCapabilitiesProvider();
    }
    return InternalCapabilitiesProvider.instance;
  }

  /**
   * Initialize the internal provider
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    debugIf(() => ({
      message: 'Initializing internal capabilities provider',
      meta: {},
    }));

    this.isInitialized = true;

    // Emit ready event
    this.emit('ready');
  }

  /**
   * Get all available internal tools based on current feature flags
   */
  public getAvailableTools(): Tool[] {
    if (!this.isInitialized) {
      logger.warn('Internal capabilities provider not initialized');
      return [];
    }

    const tools: Tool[] = [];

    // If internal tools are enabled, expose ALL tools
    if (this.flagManager.isToolEnabled('internalTools')) {
      // Discovery tools
      tools.push(this.createSearchTool());
      tools.push(this.createRegistryTool());

      // Installation tools
      tools.push(this.createInstallTool());
      tools.push(this.createUninstallTool());
      tools.push(this.createUpdateTool());

      // Management tools
      tools.push(this.createEnableTool());
      tools.push(this.createDisableTool());
      tools.push(this.createListTool());
      tools.push(this.createStatusTool());
      tools.push(this.createReloadTool());
    }

    debugIf(() => ({
      message: 'Internal tools provided',
      meta: { count: tools.length, tools: tools.map((t) => t.name) },
    }));

    return tools;
  }

  /**
   * Execute an internal tool
   */
  public async executeTool(toolName: string, args: unknown): Promise<unknown> {
    if (!this.isInitialized) {
      throw new Error('Internal capabilities provider not initialized');
    }

    debugIf(() => ({
      message: 'Executing internal tool',
      meta: { toolName, args },
    }));

    switch (toolName) {
      case 'mcp_search':
        return await handleMcpSearch(args as McpSearchToolArgs);
      case 'mcp_install':
        return await handleMcpInstall(args as McpInstallToolArgs);
      case 'mcp_uninstall':
        return await handleMcpUninstall(args as McpUninstallToolArgs);
      case 'mcp_update':
        return await handleMcpUpdate(args as McpUpdateToolArgs);
      case 'mcp_enable':
        return await handleMcpEnable(args as McpEnableToolArgs);
      case 'mcp_disable':
        return await handleMcpDisable(args as McpDisableToolArgs);
      case 'mcp_list':
        return await handleMcpList(args as McpListToolArgs);
      case 'mcp_status':
        return await handleMcpStatus(args as McpStatusToolArgs);
      case 'mcp_reload':
        return await handleMcpReload(args as McpReloadToolArgs);
      default:
        throw new Error(`Unknown internal tool: ${toolName}`);
    }
  }

  /**
   * Create search tool definition
   */
  private createSearchTool(): Tool {
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
  private createRegistryTool(): Tool {
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
   * Create install tool definition
   */
  private createInstallTool(): Tool {
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
  private createUninstallTool(): Tool {
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
  private createUpdateTool(): Tool {
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

  /**
   * Create enable tool definition
   */
  private createEnableTool(): Tool {
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
  private createDisableTool(): Tool {
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
  private createListTool(): Tool {
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
        },
      },
    };
  }

  /**
   * Create status tool definition
   */
  private createStatusTool(): Tool {
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
  private createReloadTool(): Tool {
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

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    debugIf(() => ({
      message: 'Cleaning up internal capabilities provider',
      meta: {},
    }));

    cleanupInternalToolHandlers();
    this.removeAllListeners();
    this.isInitialized = false;
  }
}
