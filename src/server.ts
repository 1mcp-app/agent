import path from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { ConfigChangeHandler } from '@src/core/configChangeHandler.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { AuthProviderTransport } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

import { AsyncLoadingOrchestrator } from './core/capabilities/asyncLoadingOrchestrator.js';
import { ClientManager } from './core/client/clientManager.js';
import { InstructionAggregator } from './core/instructions/instructionAggregator.js';
import { McpLoadingManager } from './core/loading/mcpLoadingManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { PresetManager } from './domains/preset/manager/presetManager.js';
import { PresetNotificationService } from './domains/preset/services/presetNotificationService.js';
import { createTransports, createTransportsWithContext } from './transport/transportFactory.js';

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
  /** Instruction aggregator for combining server instructions */
  instructionAggregator: InstructionAggregator;
}

/**
 * Main function to set up the MCP server
 * Conditionally uses async or legacy loading based on configuration
 */
async function setupServer(configFilePath?: string, context?: ContextData): Promise<ServerSetupResult> {
  try {
    // Initialize the new unified config management system
    const configManager = ConfigManager.getInstance(configFilePath);
    const configChangeHandler = ConfigChangeHandler.getInstance(configManager);

    await configManager.initialize();
    await configChangeHandler.initialize();

    // Check global context manager for context if not provided directly
    if (!context) {
      const globalContextManager = getGlobalContextManager();
      context = globalContextManager.getContext();
    }

    // Load configuration with template processing if context is available
    let mcpConfig: Record<string, MCPServerParams>;
    if (context) {
      const { staticServers, templateServers, errors } = await configManager.loadConfigWithTemplates(context);

      // Merge static and template servers (template servers take precedence)
      mcpConfig = { ...staticServers, ...templateServers };

      // Log template processing results
      if (errors.length > 0) {
        logger.warn(`Template processing completed with ${errors.length} errors:`, { errors });
      }

      const templateCount = Object.keys(templateServers).length;
      if (templateCount > 0) {
        logger.info(`Loaded ${templateCount} template servers with context`);
      }
    } else {
      mcpConfig = configManager.getTransportConfig();
    }

    const agentConfig = AgentConfigManager.getInstance();
    const asyncLoadingEnabled = agentConfig.get('asyncLoading').enabled;

    // Initialize preset management system
    // Extract config directory from config file path if available
    const configDir = configFilePath ? path.dirname(configFilePath) : undefined;
    await initializePresetSystem(configDir);

    // Create transports from configuration with context awareness
    const transports = context ? await createTransportsWithContext(mcpConfig, context) : createTransports(mcpConfig);
    logger.info(`Created ${Object.keys(transports).length} transports${context ? ' with context' : ''}`);

    if (asyncLoadingEnabled) {
      logger.info('Using async loading mode - HTTP server will start immediately, MCP servers load in background');
      return setupServerAsync(transports, context);
    } else {
      logger.info('Using legacy synchronous loading mode - waiting for all MCP servers before starting HTTP server');
      return setupServerSync(transports, context);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to set up server: ${errorMessage}`);
    throw error;
  }
}

/**
 * Set up server with async loading (new mode)
 * HTTP server starts immediately, MCP servers load in background
 */
async function setupServerAsync(
  transports: Record<string, AuthProviderTransport>,
  _context?: ContextData,
): Promise<ServerSetupResult> {
  // Initialize instruction aggregator
  const instructionAggregator = new InstructionAggregator();
  logger.info('Instruction aggregator initialized');

  // Initialize client manager without connecting (for async loading)
  const clientManager = ClientManager.getOrCreateInstance();
  clientManager.setInstructionAggregator(instructionAggregator);
  const clients = clientManager.initializeClientsAsync(transports);
  logger.info(`Initialized storage for ${Object.keys(transports).length} MCP servers`);

  // Create server manager with empty clients initially
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: MCP_SERVER_CAPABILITIES },
    clients,
    transports,
  );
  serverManager.setInstructionAggregator(instructionAggregator);

  // Config reload is now handled by ConfigManager and ConfigChangeHandler initialized in setupServer

  // Create loading manager for async MCP server initialization
  const loadingManager = new McpLoadingManager(clientManager);

  // Create async loading orchestrator for capability tracking and notifications
  const asyncOrchestrator = new AsyncLoadingOrchestrator(clients, serverManager, loadingManager);
  await asyncOrchestrator.initialize();

  // Start async loading (non-blocking)
  const loadingPromise = loadingManager
    .startAsyncLoading(transports)
    .then(() => {
      logger.info('All MCP servers finished loading (successfully or failed)');
    })
    .catch((error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('MCP loading process encountered an error:', errorMessage);
    });

  logger.info('Async server setup completed - HTTP server ready, MCP servers loading in background');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
    asyncOrchestrator,
    instructionAggregator,
  };
}

/**
 * Set up server with legacy synchronous loading
 * Waits for all MCP servers to load before returning
 */
async function setupServerSync(
  transports: Record<string, AuthProviderTransport>,
  _context?: ContextData,
): Promise<ServerSetupResult> {
  // Initialize instruction aggregator
  const instructionAggregator = new InstructionAggregator();
  logger.info('Instruction aggregator initialized');

  // Use the standard synchronous client creation
  const clientManager = ClientManager.getOrCreateInstance();
  clientManager.setInstructionAggregator(instructionAggregator);
  const clients = await clientManager.createClients(transports);
  logger.info(`Connected to ${clients.size} MCP servers synchronously`);

  // Create server manager with connected clients
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: MCP_SERVER_CAPABILITIES },
    clients,
    transports,
  );
  serverManager.setInstructionAggregator(instructionAggregator);

  // Config reload is now handled by ConfigManager and ConfigChangeHandler initialized in setupServer

  // Create a dummy loading manager for compatibility
  const loadingManager = new McpLoadingManager(clientManager);
  const loadingPromise = Promise.resolve(); // Already loaded

  logger.info('Synchronous server setup completed - all MCP servers connected');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
    instructionAggregator,
  };
}

/**
 * Initialize the preset management system
 */
async function initializePresetSystem(configDirOption?: string): Promise<void> {
  try {
    // Initialize preset manager with file watching
    const presetManager = PresetManager.getInstance(configDirOption);
    await presetManager.initialize();

    // Initialize notification service
    const notificationService = PresetNotificationService.getInstance();

    // Connect preset changes to client notifications
    presetManager.onPresetChange(async (presetName: string) => {
      debugIf(() => ({
        message: 'Preset changed, sending notifications',
        meta: { presetName, timestamp: Date.now() },
      }));
      await notificationService.notifyPresetChange(presetName);
    });

    logger.info('Preset management system initialized successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to initialize preset system', { error: errorMessage });
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
