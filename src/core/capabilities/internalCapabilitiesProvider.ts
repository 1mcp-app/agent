/**
 * Internal capabilities provider for internal management tools
 *
 * This module provides internal MCP tools for managing the agent itself.
 * It acts as a special internal capabilities provider that exposes management capabilities.
 */
import { EventEmitter } from 'events';

import { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  createInfoTool,
  createRegistryInfoTool,
  createRegistryListTool,
  createRegistryStatusTool,
  createRegistryTool,
  createSearchTool,
} from '@src/core/capabilities/internal/discoveryTools.js';
import {
  createInstallTool,
  createUninstallTool,
  createUpdateTool,
} from '@src/core/capabilities/internal/installationTools.js';
import {
  createDisableTool,
  createEnableTool,
  createListTool,
  createReloadTool,
  createStatusTool,
} from '@src/core/capabilities/internal/managementTools.js';
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import {
  cleanupInternalToolHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpInfo,
  handleMcpInstall,
  handleMcpList,
  handleMcpRegistryInfo,
  handleMcpRegistryList,
  handleMcpRegistryStatus,
  handleMcpReload,
  handleMcpSearch,
  handleMcpStatus,
  handleMcpUninstall,
  handleMcpUpdate,
} from '@src/core/tools/internal/index.js';
import {
  McpDisableToolArgs,
  McpEnableToolArgs,
  McpInfoToolArgs,
  McpInstallToolArgs,
  McpListToolArgs,
  McpRegistryInfoToolArgs,
  McpRegistryListToolArgs,
  McpRegistryStatusToolArgs,
  McpReloadToolArgs,
  McpSearchToolArgs,
  McpStatusToolArgs,
  McpUninstallToolArgs,
  McpUpdateToolArgs,
} from '@src/core/tools/internal/schemas/index.js';
import logger from '@src/logger/logger.js';

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

    // Check if internal tools are enabled in any way
    const internalToolsEnabled = this.flagManager.isToolEnabled('internalTools');
    const internalToolsList = this.configManager.getInternalToolsList();

    // Only proceed if internal tools are enabled (either by flag or custom list)
    if (internalToolsEnabled || internalToolsList.length > 0) {
      // Determine which tools to expose
      let enabledTools: string[] = [];

      if (internalToolsList.length > 0) {
        // Use custom tools list
        enabledTools = this.flagManager.getEnabledToolsFromList('internalTools', internalToolsList);
      } else {
        // Use all tools (existing behavior when --enable-internal-tools is used)
        enabledTools = this.flagManager.getEnabledTools('internalTools');
      }

      // Add only the enabled tools
      for (const toolName of enabledTools) {
        switch (toolName) {
          // Discovery tools
          case 'search':
            tools.push(createSearchTool());
            break;
          case 'registry':
            tools.push(createRegistryTool());
            break;
          case 'registry_status':
            tools.push(createRegistryStatusTool());
            break;
          case 'registry_info':
            tools.push(createRegistryInfoTool());
            break;
          case 'registry_list':
            tools.push(createRegistryListTool());
            break;
          case 'info':
            tools.push(createInfoTool());
            break;

          // Installation tools
          case 'install':
            tools.push(createInstallTool());
            break;
          case 'uninstall':
            tools.push(createUninstallTool());
            break;
          case 'update':
            tools.push(createUpdateTool());
            break;

          // Management tools
          case 'enable':
            tools.push(createEnableTool());
            break;
          case 'disable':
            tools.push(createDisableTool());
            break;
          case 'list':
            tools.push(createListTool());
            break;
          case 'status':
            tools.push(createStatusTool());
            break;
          case 'reload':
            tools.push(createReloadTool());
            break;

          default:
            logger.warn(`Unknown internal tool: ${toolName}`);
            break;
        }
      }
    }

    return tools;
  }

  /**
   * Execute an internal tool
   */
  public async executeTool(toolName: string, args: unknown): Promise<unknown> {
    if (!this.isInitialized) {
      throw new Error('Internal capabilities provider not initialized');
    }

    switch (toolName) {
      case 'mcp_search':
        return await handleMcpSearch(args as McpSearchToolArgs);
      case 'mcp_registry':
        // Note: mcp_registry is split into separate tools below
        throw new Error(
          'mcp_registry tool has been split into separate tools: mcp_registry_status, mcp_registry_info, mcp_registry_list',
        );
      case 'mcp_registry_status':
        return await handleMcpRegistryStatus(args as McpRegistryStatusToolArgs);
      case 'mcp_registry_info':
        return await handleMcpRegistryInfo(args as McpRegistryInfoToolArgs);
      case 'mcp_registry_list':
        return await handleMcpRegistryList(args as McpRegistryListToolArgs);
      case 'mcp_info':
        return await handleMcpInfo(args as McpInfoToolArgs);
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
   * Cleanup resources
   */
  public cleanup(): void {
    cleanupInternalToolHandlers();
    this.removeAllListeners();
    this.isInitialized = false;
  }

  public getAvailableResources(): Resource[] {
    if (!this.isInitialized) {
      logger.warn('Internal capabilities provider not initialized');
      return [];
    }

    // Internal provider doesn't expose resources
    return [];
  }

  public getAvailablePrompts(): Prompt[] {
    if (!this.isInitialized) {
      logger.warn('Internal capabilities provider not initialized');
      return [];
    }

    // Internal provider doesn't expose prompts
    return [];
  }
}
