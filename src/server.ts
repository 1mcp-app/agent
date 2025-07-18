import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants.js';
import logger from './logger/logger.js';
import { createTransports } from './transport/transportFactory.js';
import { createClients } from './core/client/clientManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { McpConfigManager } from './config/mcpConfigManager.js';
import configReloadService from './services/configReloadService.js';

/**
 * Main function to set up the MCP server
 */
async function setupServer(): Promise<ServerManager> {
  try {
    const mcpConfig = McpConfigManager.getInstance().getTransportConfig();
    // Create transports from configuration
    const transports = createTransports(mcpConfig);
    logger.info(`Created ${Object.keys(transports).length} transports`);

    // Create clients for each transport
    const clients = await createClients(transports);
    logger.info(`Created ${clients.size} clients`);

    const serverManager = ServerManager.getOrCreateInstance(
      { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      { capabilities: MCP_SERVER_CAPABILITIES },
      clients,
      transports,
    );

    // Initialize config reload service at server startup
    configReloadService.initialize(transports);

    logger.info('Server setup completed successfully');
    return serverManager;
  } catch (error) {
    logger.error(`Failed to set up server: ${error}`);
    throw error;
  }
}

export { setupServer };
