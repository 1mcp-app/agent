import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './constants.js';
import logger from './logger/logger.js';
import { createTransports } from './transport/transportFactory.js';
import { ClientManager } from './core/client/clientManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { McpConfigManager } from './config/mcpConfigManager.js';
import { AgentConfigManager } from './core/server/agentConfig.js';
import configReloadService from './services/configReloadService.js';
import { McpLoadingManager } from './core/loading/mcpLoadingManager.js';
import { AsyncLoadingOrchestrator } from './core/capabilities/asyncLoadingOrchestrator.js';
import { PresetManager } from './utils/presetManager.js';
import { PresetNotificationService } from './utils/presetNotificationService.js';

/**
 * Result of server setup including both sync and async components
 */
export interface ServerSetupResult {
  /** Server manager ready for HTTP transport */
  serverManager: ServerManager;
  /** Loading manager for async MCP server initialization */
  loadingManager: McpLoadingManager;
  /** Promise that resolves when all MCP servers finish loading */
  loadingPromise: Promise<void>;
  /** Async loading orchestrator (only present in async mode) */
  asyncOrchestrator?: AsyncLoadingOrchestrator;
}

/**
 * Main function to set up the MCP server
 * Conditionally uses async or legacy loading based on configuration
 */
async function setupServer(): Promise<ServerSetupResult> {
  try {
    const mcpConfig = McpConfigManager.getInstance().getTransportConfig();
    const agentConfig = AgentConfigManager.getInstance();
    const asyncLoadingEnabled = agentConfig.isAsyncLoadingEnabled();

    // Initialize preset management system
    await initializePresetSystem();

    // Create transports from configuration
    const transports = createTransports(mcpConfig);
    logger.info(`Created ${Object.keys(transports).length} transports`);

    if (asyncLoadingEnabled) {
      logger.info('Using async loading mode - HTTP server will start immediately, MCP servers load in background');
      return setupServerAsync(transports);
    } else {
      logger.info('Using legacy synchronous loading mode - waiting for all MCP servers before starting HTTP server');
      return setupServerSync(transports);
    }
  } catch (error) {
    logger.error(`Failed to set up server: ${error}`);
    throw error;
  }
}

/**
 * Set up server with async loading (new mode)
 * HTTP server starts immediately, MCP servers load in background
 */
async function setupServerAsync(transports: Record<string, any>): Promise<ServerSetupResult> {
  // Initialize client manager without connecting (for async loading)
  const clientManager = ClientManager.getOrCreateInstance();
  const clients = clientManager.initializeClientsAsync(transports);
  logger.info(`Initialized storage for ${Object.keys(transports).length} MCP servers`);

  // Create server manager with empty clients initially
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: MCP_SERVER_CAPABILITIES },
    clients,
    transports,
  );

  // Initialize config reload service
  configReloadService.initialize(transports);

  // Create loading manager for async MCP server initialization
  const loadingManager = new McpLoadingManager(clientManager);

  // Create async loading orchestrator for capability tracking and notifications
  const asyncOrchestrator = new AsyncLoadingOrchestrator(clients, serverManager, loadingManager);
  asyncOrchestrator.initialize();

  // Start async loading (non-blocking)
  const loadingPromise = loadingManager
    .startAsyncLoading(transports)
    .then(() => {
      logger.info('All MCP servers finished loading (successfully or failed)');
    })
    .catch((error) => {
      logger.error('MCP loading process encountered an error:', error);
    });

  logger.info('Async server setup completed - HTTP server ready, MCP servers loading in background');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
    asyncOrchestrator,
  };
}

/**
 * Set up server with legacy synchronous loading
 * Waits for all MCP servers to load before returning
 */
async function setupServerSync(transports: Record<string, any>): Promise<ServerSetupResult> {
  // Use the standard synchronous client creation
  const clientManager = ClientManager.getOrCreateInstance();
  const clients = await clientManager.createClients(transports);
  logger.info(`Connected to ${clients.size} MCP servers synchronously`);

  // Create server manager with connected clients
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: MCP_SERVER_CAPABILITIES },
    clients,
    transports,
  );

  // Initialize config reload service
  configReloadService.initialize(transports);

  // Create a dummy loading manager for compatibility
  const loadingManager = new McpLoadingManager(clientManager);
  const loadingPromise = Promise.resolve(); // Already loaded

  logger.info('Synchronous server setup completed - all MCP servers connected');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
  };
}

/**
 * Initialize the preset management system
 */
async function initializePresetSystem(): Promise<void> {
  try {
    // Initialize preset manager with file watching
    const presetManager = PresetManager.getInstance();
    await presetManager.initialize();

    // Initialize notification service
    const notificationService = PresetNotificationService.getInstance();

    // Connect preset changes to client notifications
    presetManager.onPresetChange(async (presetName: string) => {
      logger.debug('Preset changed, sending notifications', { presetName });
      await notificationService.notifyPresetChange(presetName);
    });

    logger.info('Preset management system initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize preset system', { error });
    throw error;
  }
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use setupServer() which returns ServerSetupResult
 */
async function setupServerLegacy(): Promise<ServerManager> {
  const result = await setupServer();
  // Wait for loading to complete for legacy behavior
  await result.loadingPromise;
  return result.serverManager;
}

export { setupServer, setupServerLegacy };
