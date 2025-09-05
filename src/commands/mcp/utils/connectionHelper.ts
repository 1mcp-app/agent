import logger from '../../../logger/logger.js';
import { ClientManager } from '../../../core/client/clientManager.js';
import { createTransports } from '../../../transport/transportFactory.js';
import type { MCPServerParams } from '../../../core/types/index.js';
import type { OutboundConnection } from '../../../core/types/client.js';
import type { Tool, Resource, Prompt } from '@modelcontextprotocol/sdk/types.js';

export interface ServerCapabilities {
  serverName: string;
  connected: boolean;
  tools: Tool[];
  resources: Resource[];
  prompts: Prompt[];
  error?: string;
}

/**
 * Connection helper for connecting to MCP servers and retrieving their capabilities
 */
export class McpConnectionHelper {
  private connections: Map<string, OutboundConnection> = new Map();

  /**
   * Connect to MCP servers based on configuration
   */
  async connectToServers(
    servers: Record<string, MCPServerParams>,
    timeoutMs: number = 10000,
  ): Promise<ServerCapabilities[]> {
    logger.info(`Connecting to ${Object.keys(servers).length} MCP servers`);

    const serverNames = Object.keys(servers);
    if (serverNames.length === 0) {
      return [];
    }

    // Create transports from server configurations
    const transports = createTransports(servers);
    logger.debug(`Created ${Object.keys(transports).length} transports`);

    const results: ServerCapabilities[] = [];

    // Connect to servers in parallel with individual timeouts
    const connectionPromises = serverNames.map(async (serverName) => {
      try {
        logger.debug(`Connecting to server: ${serverName}`);

        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Connection timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        // Get transport for this server
        const transport = transports[serverName];
        if (!transport) {
          throw new Error('Transport not found');
        }

        // Create clients with timeout
        const tempClientManager = ClientManager.getOrCreateInstance();
        const tempTransports = { [serverName]: transport };

        // Connect with timeout
        const connectPromise = tempClientManager.createClients(tempTransports);

        // Race between connection and timeout
        const clients = await Promise.race([connectPromise, timeoutPromise]);

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

        logger.debug(`Successfully connected to ${serverName}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`Failed to connect to server ${serverName}: ${errorMessage}`);
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

    const connectedCount = results.filter((r) => r.connected).length;
    logger.info(`Connected to ${connectedCount}/${serverNames.length} MCP servers`);

    return results;
  }

  /**
   * Get capabilities from a connected MCP server
   */
  private async getServerCapabilities(
    serverName: string,
    connection: OutboundConnection,
  ): Promise<{
    tools: Tool[];
    resources: Resource[];
    prompts: Prompt[];
  }> {
    const tools: Tool[] = [];
    const resources: Resource[] = [];
    const prompts: Prompt[] = [];

    try {
      // Get tools with timeout
      try {
        const toolsResult = await Promise.race([
          connection.client.listTools({}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Tools listing timeout')), 5000)),
        ]);

        if (toolsResult && toolsResult.tools) {
          tools.push(...toolsResult.tools);
          logger.debug(`Got ${toolsResult.tools.length} tools from ${serverName}`);
        }
      } catch (error) {
        logger.debug(`Failed to get tools from ${serverName}: ${error instanceof Error ? error.message : error}`);
      }

      // Get resources with timeout
      try {
        const resourcesResult = await Promise.race([
          connection.client.listResources({}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Resources listing timeout')), 5000)),
        ]);

        if (resourcesResult && resourcesResult.resources) {
          resources.push(...resourcesResult.resources);
          logger.debug(`Got ${resourcesResult.resources.length} resources from ${serverName}`);
        }
      } catch (error) {
        logger.debug(`Failed to get resources from ${serverName}: ${error instanceof Error ? error.message : error}`);
      }

      // Get prompts with timeout
      try {
        const promptsResult = await Promise.race([
          connection.client.listPrompts({}),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Prompts listing timeout')), 5000)),
        ]);

        if (promptsResult && promptsResult.prompts) {
          prompts.push(...promptsResult.prompts);
          logger.debug(`Got ${promptsResult.prompts.length} prompts from ${serverName}`);
        }
      } catch (error) {
        logger.debug(`Failed to get prompts from ${serverName}: ${error instanceof Error ? error.message : error}`);
      }
    } catch (error) {
      logger.warn(`Error getting capabilities from ${serverName}: ${error instanceof Error ? error.message : error}`);
    }

    return { tools, resources, prompts };
  }

  /**
   * Clean up connections
   */
  async cleanup(): Promise<void> {
    logger.debug('Cleaning up MCP connections');

    const cleanupPromises: Promise<void>[] = [];

    for (const [serverName, connection] of this.connections) {
      const cleanupPromise = (async () => {
        try {
          if (connection.client && typeof connection.client.close === 'function') {
            // Add timeout to close operation
            await Promise.race([
              connection.client.close(),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Close operation timeout')), 3000)),
            ]);
          }
          logger.debug(`Closed connection to ${serverName}`);
        } catch (error) {
          logger.warn(`Error closing connection to ${serverName}: ${error instanceof Error ? error.message : error}`);
        }
      })();

      cleanupPromises.push(cleanupPromise);
    }

    // Wait for all cleanup operations to complete
    await Promise.allSettled(cleanupPromises);
    this.connections.clear();
  }
}
