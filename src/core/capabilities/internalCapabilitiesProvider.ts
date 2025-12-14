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
  createSearchTool,
} from '@src/core/capabilities/internal/discoveryTools.js';
import {
  createInstallTool,
  createUninstallTool,
  createUpdateTool,
} from '@src/core/capabilities/internal/installationTools.js';
import {
  createDisableTool,
  createEditTool,
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
  handleMcpEdit,
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
  McpDisableToolSchema,
  McpEditToolSchema,
  McpEnableToolSchema,
  McpInfoToolSchema,
  McpInstallToolSchema,
  McpListToolSchema,
  McpRegistryInfoSchema,
  McpRegistryListSchema,
  McpRegistryStatusSchema,
  McpReloadToolSchema,
  McpSearchToolSchema,
  McpStatusToolSchema,
  McpUninstallToolSchema,
  McpUpdateToolSchema,
} from '@src/core/tools/internal/schemas/index.js';
import logger from '@src/logger/logger.js';

import { z } from 'zod';

/**
 * Validate tool arguments using a Zod schema
 *
 * @param schema The Zod schema to validate against
 * @param args The raw arguments to validate
 * @param toolName The name of the tool for error reporting
 * @returns Validated and typed arguments
 * @throws Error if validation fails
 */
function validateToolArgs<T extends z.ZodType>(schema: T, args: unknown, toolName: string): z.infer<T> {
  try {
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');

      logger.error(`Tool argument validation failed for ${toolName}`, {
        toolName,
        errors: error.issues,
        receivedArgs: args,
      });

      throw new Error(
        `Invalid arguments for ${toolName}: ${errorMessages}. ` +
          `Expected format: ${JSON.stringify(schema._def, null, 2)}`,
      );
    }

    logger.error(`Unexpected validation error for ${toolName}`, {
      toolName,
      error: error instanceof Error ? error.message : String(error),
      receivedArgs: args,
    });

    throw new Error(`Validation failed for ${toolName}: ${error}`);
  }
}

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
          // registry case removed - mcp_registry tool has been deprecated and split into separate tools
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

          // Edit tools
          case 'edit':
            tools.push(createEditTool());
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

    let result: unknown;

    switch (toolName) {
      case 'mcp_search': {
        const validatedArgs = validateToolArgs(McpSearchToolSchema, args, toolName);
        result = await handleMcpSearch(validatedArgs);
        break;
      }
      // mcp_registry case removed - tool has been deprecated and split into separate tools
      case 'mcp_registry_status': {
        const validatedArgs = validateToolArgs(McpRegistryStatusSchema, args, toolName);
        result = await handleMcpRegistryStatus(validatedArgs);
        break;
      }
      case 'mcp_registry_info': {
        const validatedArgs = validateToolArgs(McpRegistryInfoSchema, args, toolName);
        result = await handleMcpRegistryInfo(validatedArgs);
        break;
      }
      case 'mcp_registry_list': {
        const validatedArgs = validateToolArgs(McpRegistryListSchema, args, toolName);
        result = await handleMcpRegistryList(validatedArgs);
        break;
      }
      case 'mcp_info': {
        const validatedArgs = validateToolArgs(McpInfoToolSchema, args, toolName);
        result = await handleMcpInfo(validatedArgs);
        break;
      }
      case 'mcp_install': {
        const validatedArgs = validateToolArgs(McpInstallToolSchema, args, toolName);
        result = await handleMcpInstall(validatedArgs);
        break;
      }
      case 'mcp_uninstall': {
        const validatedArgs = validateToolArgs(McpUninstallToolSchema, args, toolName);
        result = await handleMcpUninstall(validatedArgs);
        break;
      }
      case 'mcp_update': {
        const validatedArgs = validateToolArgs(McpUpdateToolSchema, args, toolName);
        result = await handleMcpUpdate(validatedArgs);
        break;
      }
      case 'mcp_edit': {
        const validatedArgs = validateToolArgs(McpEditToolSchema, args, toolName);
        result = await handleMcpEdit(validatedArgs);
        break;
      }
      case 'mcp_enable': {
        const validatedArgs = validateToolArgs(McpEnableToolSchema, args, toolName);
        result = await handleMcpEnable(validatedArgs);
        break;
      }
      case 'mcp_disable': {
        const validatedArgs = validateToolArgs(McpDisableToolSchema, args, toolName);
        result = await handleMcpDisable(validatedArgs);
        break;
      }
      case 'mcp_list': {
        const validatedArgs = validateToolArgs(McpListToolSchema, args, toolName);
        result = await handleMcpList(validatedArgs);
        break;
      }
      case 'mcp_status': {
        const validatedArgs = validateToolArgs(McpStatusToolSchema, args, toolName);
        result = await handleMcpStatus(validatedArgs);
        break;
      }
      case 'mcp_reload': {
        const validatedArgs = validateToolArgs(McpReloadToolSchema, args, toolName);
        result = await handleMcpReload(validatedArgs);
        break;
      }
      default:
        throw new Error(`Unknown internal tool: ${toolName}`);
    }

    // Return the structured result directly - let the MCP SDK handle wrapping
    return result;
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
