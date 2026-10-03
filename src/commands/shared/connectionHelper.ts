import { ClientManager } from '@src/core/client/clientManager.js';
import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import type { OutboundConnection } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import {
  type Prompt as ProtocolPrompt,
  type Resource as ProtocolResource,
  type Tool as ProtocolTool,
  toProtocolPrompts,
  toProtocolResources,
  toProtocolTools,
} from '@src/sdk/contracts/index.js';
import { createTransports } from '@src/transport/transportFactory.js';

export interface ServerCapabilities {
  serverName: string;
  connected: boolean;
  tools: ProtocolTool[];
  resources: ProtocolResource[];
  prompts: ProtocolPrompt[];
  error?: string;
}

interface ToolListResult {
  tools?: unknown[];
}

interface ResourceListResult {
  resources?: unknown[];
}

interface PromptListResult {
  prompts?: unknown[];
}

/**
 * Connection helper for connecting to MCP servers and retrieving their capabilities
 */
export class McpConnectionHelper {
  private connections: Map<string, OutboundConnection> = new Map();

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(errorMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Connect to MCP servers based on configuration
   */
  async connectToServers(
    servers: Record<string, MCPServerParams>,
    timeoutMs: number = 10000,
  ): Promise<ServerCapabilities[]> {
    logger.info('connectionHelper.connecting.to.mcp.servers.461c8d6e');

    const serverNames = Object.keys(servers);
    if (serverNames.length === 0) {
      return [];
    }

    // Create transports from server configurations
    const transports = createTransports(servers) as unknown as Parameters<ClientManager['createClients']>[0];
    logger.debug('connectionHelper.created.transports.f05ade79');

    const results: ServerCapabilities[] = [];

    // Connect to servers in parallel with individual timeouts
    const connectionPromises = serverNames.map(async (serverName) => {
      try {
        logger.debug('connectionHelper.connecting.to.server.18da2df3');

        // Get transport for this server
        const transport = transports[serverName];
        if (!transport) {
          throw new Error('Transport not found');
        }

        // Create clients with timeout
        const tempClientManager = ClientManager.getOrCreateInstance();
        const tempTransports = { [serverName]: transport };

        // Connect with timeout
        const clients = await this.withTimeout(
          tempClientManager.createClients(tempTransports),
          timeoutMs,
          `Connection timeout after ${timeoutMs}ms`,
        );

        const connection = clients.get(serverName);
        if (!connection) {
          throw new Error('Failed to establish connection');
        }

        this.connections.set(serverName, connection);

        // Get capabilities from the connected server
        const capabilities = await this.getServerCapabilities(serverName, connection);

        results.push({
          serverName,
          connected: true,
          ...capabilities,
        });

        logger.debug('connectionHelper.successfully.connected.to.efd457e4');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn('connectionHelper.failed.to.connect.to.server.c68471ca', { error: error });
        results.push({
          serverName,
          connected: false,
          tools: [],
          resources: [],
          prompts: [],
          error: errorMessage,
        });
      }
    });

    // Wait for all connections to complete (success or failure)
    await Promise.allSettled(connectionPromises);

    logger.info('connectionHelper.connected.to.mcp.servers.e37c33e9');

    return results;
  }

  /**
   * Get capabilities from a connected MCP server
   */
  private async getServerCapabilities(
    serverName: string,
    connection: OutboundConnection,
  ): Promise<{
    tools: ProtocolTool[];
    resources: ProtocolResource[];
    prompts: ProtocolPrompt[];
  }> {
    const tools: ProtocolTool[] = [];
    const resources: ProtocolResource[] = [];
    const prompts: ProtocolPrompt[] = [];

    try {
      await this.collectCapabilityItems<ToolListResult, ProtocolTool>({
        serverName,
        items: tools,
        capabilityName: 'tools',
        timeoutMessage: 'Tools listing timeout',
        list: () => requestLegacyAdapter<ToolListResult>(connection.adapter, 'tools/list'),
        select: (result) => toProtocolTools(result?.tools ?? []),
      });
      await this.collectCapabilityItems<ResourceListResult, ProtocolResource>({
        serverName,
        items: resources,
        capabilityName: 'resources',
        timeoutMessage: 'Resources listing timeout',
        list: () => requestLegacyAdapter<ResourceListResult>(connection.adapter, 'resources/list'),
        select: (result) => toProtocolResources(result?.resources ?? []),
      });
      await this.collectCapabilityItems<PromptListResult, ProtocolPrompt>({
        serverName,
        items: prompts,
        capabilityName: 'prompts',
        timeoutMessage: 'Prompts listing timeout',
        list: () => requestLegacyAdapter<PromptListResult>(connection.adapter, 'prompts/list'),
        select: (result) => toProtocolPrompts(result?.prompts ?? []),
      });
    } catch (_error) {
      logger.warn('connectionHelper.error.getting.capabilities.from.67bec470', { error: _error });
    }

    return { tools, resources, prompts };
  }

  private async collectCapabilityItems<TResult, TItem>(options: {
    serverName: string;
    items: TItem[];
    capabilityName: 'tools' | 'resources' | 'prompts';
    timeoutMessage: string;
    list: () => Promise<TResult>;
    select: (result: TResult) => TItem[];
  }): Promise<void> {
    const { items, timeoutMessage, list, select } = options;

    try {
      const result = await this.withTimeout(list(), 5000, timeoutMessage);
      const capabilityItems = select(result);

      if (capabilityItems.length > 0) {
        items.push(...capabilityItems);
      }

      logger.debug('connectionHelper.got.from.9f852132');
    } catch (_error) {
      logger.debug('connectionHelper.failed.to.get.from.37b44b45', { error: _error });
    }
  }

  /**
   * Clean up connections
   */
  async cleanup(): Promise<void> {
    logger.debug('connectionHelper.cleaning.up.mcp.connections.1b42fca5');

    const cleanupPromises: Promise<void>[] = [];

    for (const [_serverName, connection] of this.connections) {
      const cleanupPromise = (async () => {
        try {
          await this.withTimeout(connection.adapter.close(), 3000, 'Client close timeout');
        } catch (_error) {
          logger.warn('connectionHelper.error.closing.client.for.b4896484', { error: _error });
        }

        logger.debug('connectionHelper.closed.connection.to.b8f5aa07');
      })();

      cleanupPromises.push(cleanupPromise);
    }

    // Wait for all cleanup operations to complete
    await Promise.allSettled(cleanupPromises);
    this.connections.clear();
  }
}
