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
} from '@src/core/tools/internal/toolHandlers.js';
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
} from '@src/core/tools/internal/toolSchemas.js';
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

    // If internal tools are enabled, expose ALL tools
    if (this.flagManager.isToolEnabled('internalTools')) {
      // Discovery tools
      tools.push(createSearchTool());
      tools.push(createRegistryTool());
      tools.push(createRegistryStatusTool());
      tools.push(createRegistryInfoTool());
      tools.push(createRegistryListTool());
      tools.push(createInfoTool());

      // Installation tools
      tools.push(createInstallTool());
      tools.push(createUninstallTool());
      tools.push(createUpdateTool());

      // Management tools
      tools.push(createEnableTool());
      tools.push(createDisableTool());
      tools.push(createListTool());
      tools.push(createStatusTool());
      tools.push(createReloadTool());
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
