/**
 * Management tool handlers
 *
 * This module implements handlers for MCP server management operations
 * including enable/disable, list, status, and reload functionality.
 */
import { FlagManager } from '@src/core/flags/flagManager.js';
import { AdapterFactory } from '@src/core/tools/internal/adapters/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import {
  type McpDisableOutput,
  McpDisableOutputSchema,
  McpDisableToolArgs,
  type McpEnableOutput,
  McpEnableOutputSchema,
  McpEnableToolArgs,
  type McpListOutput,
  McpListOutputSchema,
  McpListToolArgs,
  type McpReloadOutput,
  McpReloadOutputSchema,
  McpReloadToolArgs,
  type McpStatusOutput,
  McpStatusOutputSchema,
  McpStatusToolArgs,
} from './schemas/index.js';

/**
 * Internal tool handler for enabling MCP servers
 */
export async function handleMcpEnable(args: McpEnableToolArgs): Promise<McpEnableOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_enable tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'enable')) {
      const result = {
        name: args.name,
        status: 'failed' as const,
        message: 'MCP server management is currently disabled by configuration',
        error: 'Management tools are disabled',
      };
      return McpEnableOutputSchema.parse(result);
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.enableServer(args.name, {
      restart: args.restart,
      tags: args.tags,
      graceful: args.graceful,
      timeout: args.timeout,
    });

    // Transform to match expected output schema
    const structuredResult = {
      name: result.serverName,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `MCP server '${result.serverName}' ${result.success ? 'enabled' : 'enable failed'}${result.success ? ' successfully' : ''}`,
      enabled: result.enabled,
      restarted: result.restarted,
      warnings: result.warnings,
      reloadRecommended: result.success,
      error: result.success ? undefined : result.errors?.[0] || 'Enable operation failed',
    };

    return McpEnableOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_enable tool handler', { error: errorMessage });

    const result = {
      name: args.name,
      status: 'failed' as const,
      message: `Enable operation failed: ${errorMessage}`,
      error: errorMessage,
    };

    return McpEnableOutputSchema.parse(result);
  }
}

/**
 * Internal tool handler for disabling MCP servers
 */
export async function handleMcpDisable(args: McpDisableToolArgs): Promise<McpDisableOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_disable tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'disable')) {
      const result = {
        name: args.name,
        status: 'failed' as const,
        message: 'MCP server management is currently disabled by configuration',
        error: 'Management tools are disabled',
      };
      return McpDisableOutputSchema.parse(result);
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.disableServer(args.name, {
      graceful: args.graceful,
      timeout: args.timeout,
      tags: args.tags,
      force: args.force,
    });

    // Transform to match expected output schema
    const structuredResult = {
      name: result.serverName,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `MCP server '${result.serverName}' ${result.success ? 'disabled' : 'disable failed'}${result.success ? ' successfully' : ''}`,
      disabled: result.disabled,
      gracefulShutdown: result.gracefulShutdown,
      warnings: result.warnings,
      reloadRecommended: result.success,
      error: result.success ? undefined : result.errors?.[0] || 'Disable operation failed',
    };

    return McpDisableOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_disable tool handler', { error: errorMessage });

    const result = {
      name: args.name,
      status: 'failed' as const,
      message: `Disable operation failed: ${errorMessage}`,
      error: errorMessage,
    };

    return McpDisableOutputSchema.parse(result);
  }
}

/**
 * Internal tool handler for listing MCP servers
 */
export async function handleMcpList(args: McpListToolArgs): Promise<McpListOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_list tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'list')) {
      throw new Error('MCP server management is currently disabled by configuration');
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const servers = await adapter.listServers({
      status: args.status as 'enabled' | 'disabled' | 'all',
      transport: args.transport as 'stdio' | 'sse' | 'http',
      detailed: args.detailed,
      tags: args.tags,
    });

    // Transform to match expected output schema
    const transformedServers = servers.map((server) => ({
      name: server.name,
      status: server.status as 'enabled' | 'disabled' | 'running' | 'stopped' | 'error',
      transport: server.transport as 'stdio' | 'sse' | 'http',
      tags: server.config?.tags,
      lastConnected: typeof server.lastChecked === 'string' ? server.lastChecked : server.lastChecked?.toISOString(),
      uptime: undefined, // Not available in ServerInfo interface
      command: server.config?.command,
      url: server.url,
      healthStatus: server.healthStatus as 'healthy' | 'unhealthy' | 'unknown',
      capabilities: {
        toolCount: undefined, // Not available in metadata
        resourceCount: undefined, // Not available in metadata
        promptCount: undefined, // Not available in metadata
      },
    }));

    const summary = {
      enabled: transformedServers.filter((s) => s.status === 'enabled' || s.status === 'running').length,
      disabled: transformedServers.filter((s) => s.status === 'disabled' || s.status === 'stopped').length,
      running: transformedServers.filter((s) => s.status === 'running').length,
      stopped: transformedServers.filter((s) => s.status === 'stopped').length,
    };

    const result = {
      servers: transformedServers,
      total: transformedServers.length,
      summary,
    };

    return McpListOutputSchema.parse(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_list tool handler', { error: errorMessage });

    const result = {
      servers: [],
      total: 0,
      summary: {
        enabled: 0,
        disabled: 0,
        running: 0,
        stopped: 0,
      },
    };

    return McpListOutputSchema.parse(result);
  }
}

/**
 * Internal tool handler for getting MCP server status
 */
export async function handleMcpStatus(args: McpStatusToolArgs): Promise<McpStatusOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_status tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'status')) {
      throw new Error('MCP server management is currently disabled by configuration');
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.getServerStatus(args.name);

    // Transform to match expected output schema
    const transformedServers = (result.servers || []).map((server) => ({
      name: server.name,
      status: server.status as 'running' | 'stopped' | 'error' | 'unknown',
      transport: server.transport as 'stdio' | 'sse' | 'http',
      uptime: undefined, // Not available in ServerStatusInfo
      lastConnected: server.lastChecked,
      pid: undefined, // Not available in ServerStatusInfo
      memoryUsage: undefined, // Not available in ServerStatusInfo
      capabilities: {
        tools: undefined, // Not available in ServerStatusInfo
        resources: undefined, // Not available in ServerStatusInfo
        prompts: undefined, // Not available in ServerStatusInfo
      },
      health: {
        status: server.healthStatus as 'healthy' | 'unhealthy' | 'unknown',
        lastCheck: server.lastChecked,
        responseTime: undefined, // Not available in ServerStatusInfo
      },
    }));

    const overall = {
      total: transformedServers.length,
      running: transformedServers.filter((s) => s.status === 'running').length,
      stopped: transformedServers.filter((s) => s.status === 'stopped').length,
      errors: transformedServers.filter((s) => s.status === 'error').length,
    };

    const schemaResult = {
      servers: transformedServers,
      timestamp: result.timestamp || new Date().toISOString(),
      overall,
    };

    return McpStatusOutputSchema.parse(schemaResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_status tool handler', { error: errorMessage });

    const result = {
      servers: [],
      timestamp: new Date().toISOString(),
      overall: {
        total: 0,
        running: 0,
        stopped: 0,
        errors: 0,
      },
    };

    return McpStatusOutputSchema.parse(result);
  }
}

/**
 * Internal tool handler for reloading MCP configuration
 */
export async function handleMcpReload(args: McpReloadToolArgs): Promise<McpReloadOutput> {
  try {
    debugIf(() => ({
      message: 'Executing mcp_reload tool',
      meta: { args },
    }));

    // Check if management tools are enabled
    const flagManager = FlagManager.getInstance();
    if (!flagManager.isToolEnabled('internalTools', 'management', 'reload')) {
      const result = {
        target: (args.server ? 'server' : 'config') as 'server' | 'config' | 'all',
        status: 'failed' as const,
        message: 'MCP server management is currently disabled by configuration',
        timestamp: new Date().toISOString(),
        error: 'Management tools are disabled',
      };
      return McpReloadOutputSchema.parse(result);
    }

    const adapter = AdapterFactory.getManagementAdapter();
    const result = await adapter.reloadConfiguration({
      server: args.server,
      configOnly: args.configOnly,
      force: args.force,
      timeout: args.timeout,
    });

    // Transform to match expected output schema
    const structuredResult = {
      target: result.target,
      action: result.action,
      status: result.success ? ('success' as const) : ('failed' as const),
      message: `Reload ${result.success ? 'completed' : 'failed'} ${result.success ? 'successfully' : ''} for ${result.target}`,
      timestamp: result.timestamp,
      reloadedServers: result.reloadedServers,
      error: result.success ? undefined : result.errors?.[0] || 'Reload operation failed',
    };

    return McpReloadOutputSchema.parse(structuredResult);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error in mcp_reload tool handler', { error: errorMessage });

    const result = {
      target: (args.server ? 'server' : 'config') as 'server' | 'config' | 'all',
      status: 'failed' as const,
      message: `Reload operation failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
      error: errorMessage,
    };

    return McpReloadOutputSchema.parse(result);
  }
}

/**
 * Cleanup function for management handlers
 */
export function cleanupManagementHandlers(): void {
  AdapterFactory.cleanup();
}
