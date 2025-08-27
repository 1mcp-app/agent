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

    // Create transports from server configurations
    const transports = createTransports(servers);
    logger.debug(`Created ${Object.keys(transports).length} transports`);

    const results: ServerCapabilities[] = [];

    // Connect to servers in parallel with timeout
    const connectionPromises = Object.keys(servers).map(async (serverName) => {
      try {
        logger.debug(`Connecting to server: ${serverName}`);

        // Create clients with timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Connection timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        // For now, we'll create a single transport and try to connect
        const transport = transports[serverName];
        if (!transport) {
          throw new Error('Transport not found');
        }

        // Create a temporary client manager for this connection
        const tempClientManager = ClientManager.getOrCreateInstance();
        const tempTransports = { [serverName]: transport };

        // Connect with timeout
        const connectPromise = tempClientManager.createClients(tempTransports);
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
        logger.warn(`Failed to connect to server ${serverName}: ${error instanceof Error ? error.message : error}`);
        results.push({
          serverName,
          connected: false,
          tools: [],
          resources: [],
          prompts: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    await Promise.allSettled(connectionPromises);

    const connectedCount = results.filter((r) => r.connected).length;
    logger.info(`Connected to ${connectedCount}/${Object.keys(servers).length} MCP servers`);

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
      // Get tools
      try {
        const toolsResult = await connection.client.listTools({});
        if (toolsResult && toolsResult.tools) {
          tools.push(...toolsResult.tools);
          logger.debug(`Got ${toolsResult.tools.length} tools from ${serverName}`);
        }
      } catch (error) {
        logger.debug(`Failed to get tools from ${serverName}: ${error instanceof Error ? error.message : error}`);
      }

      // Get resources
      try {
        const resourcesResult = await connection.client.listResources({});
        if (resourcesResult && resourcesResult.resources) {
          resources.push(...resourcesResult.resources);
          logger.debug(`Got ${resourcesResult.resources.length} resources from ${serverName}`);
        }
      } catch (error) {
        logger.debug(`Failed to get resources from ${serverName}: ${error instanceof Error ? error.message : error}`);
      }

      // Get prompts
      try {
        const promptsResult = await connection.client.listPrompts({});
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

    for (const [serverName, connection] of this.connections) {
      try {
        if (connection.client && typeof connection.client.close === 'function') {
          await connection.client.close();
        }
        logger.debug(`Closed connection to ${serverName}`);
      } catch (error) {
        logger.warn(`Error closing connection to ${serverName}: ${error instanceof Error ? error.message : error}`);
      }
    }

    this.connections.clear();
  }
}
