import path from 'path';

import { ConfigManager } from '@src/config/configManager.js';
import { MCP_SERVER_CAPABILITIES, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { ConfigChangeHandler } from '@src/core/configChangeHandler.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

import { AsyncLoadingOrchestrator, type BackendStartupPolicy } from './core/capabilities/asyncLoadingOrchestrator.js';
import { InternalCapabilitiesProvider } from './core/capabilities/internalCapabilitiesProvider.js';
import { LazyLoadingOrchestrator } from './core/capabilities/lazyLoadingOrchestrator.js';
import { ClientManager } from './core/client/clientManager.js';
import { InstructionAggregator } from './core/instructions/instructionAggregator.js';
import { type BackendLoadingPolicy, DEFAULT_BACKEND_LOADING_POLICY } from './core/loading/backendLoadingPolicy.js';
import { McpLoadingManager } from './core/loading/mcpLoadingManager.js';
import { ServerManager } from './core/server/serverManager.js';
import { PresetManager } from './domains/preset/manager/presetManager.js';
import { PresetNotificationService } from './domains/preset/services/presetNotificationService.js';
import { type JsonObject, toJsonValue } from './sdk/contracts/index.js';
import { createTransports } from './transport/transportFactory.js';

type AuthProviderTransport = ReturnType<typeof createTransports>[string];

function toJsonObject(value: unknown, label: string): JsonObject {
  const normalized = toJsonValue(value);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return normalized;
}

const SERVER_CAPABILITIES_RECORD = toJsonObject(MCP_SERVER_CAPABILITIES, 'Server capabilities');

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
  /** Lazy loading orchestrator (only present when lazy loading is enabled) */
  lazyLoadingOrchestrator?: LazyLoadingOrchestrator;
  /** Instruction aggregator for combining server instructions */
  instructionAggregator: InstructionAggregator;
}

/**
 * Main function to set up the MCP server
 * Conditionally uses async or legacy loading based on configuration
 */
async function setupServer(
  configFilePath?: string,
  context?: ContextData,
  backendLoadingPolicy: BackendLoadingPolicy = DEFAULT_BACKEND_LOADING_POLICY,
  startupPolicy: BackendStartupPolicy = 'configured',
): Promise<ServerSetupResult> {
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

    // Load only static servers at startup - template servers are created per-client
    // Templates should only be processed when clients connect, not at server startup
    // Note: ConfigManager already filters out static servers that conflict with template servers
    const mcpConfig = configManager.getTransportConfig();

    const agentConfig = AgentConfigManager.getInstance();
    const asyncLoadingEnabled = agentConfig.get('asyncLoading').enabled;

    // Initialize preset management system
    // Extract config directory from config file path if available
    const configDir = configFilePath ? path.dirname(configFilePath) : undefined;
    await initializePresetSystem(configDir);

    // Create transports from static configuration only (template servers created per-client)
    const transports = createTransports(mcpConfig);
    logger.info('server.created.static.transports.template.servers.will.be.created.per.client.c973cddd');

    const nonblockingStartup = asyncLoadingEnabled || startupPolicy === 'cooperative-activation';
    const setupResult = nonblockingStartup
      ? await setupServerAsync(transports, context, backendLoadingPolicy, startupPolicy)
      : await setupServerSync(transports, context, backendLoadingPolicy);

    const { templateServers, errors } = configManager.loadDeclaredServerConfigs();
    if (errors.length === 0) {
      setupResult.serverManager.getTemplateServerManager().rebuildTemplateIndex({ mcpTemplates: templateServers });
    } else {
      logger.warn('server.skipping.initial.template.index.because.the.declared.configuration.is.inval.4ec2bdfc');
    }

    if (nonblockingStartup) {
      logger.info('server.using.async.loading.mode.http.server.will.start.immediately.mcp.servers.loa.d02f7566');
    } else {
      logger.info('server.using.legacy.synchronous.loading.mode.waiting.for.all.mcp.servers.before.st.0511e111');
    }
    return setupResult;
  } catch (error) {
    logger.error('server.failed.to.set.up.server.8f1b49ea', { error: error });
    throw error;
  }
}

/**
 * Set up server with async loading (new mode)
 * HTTP server starts immediately, MCP servers load in background
 */
async function setupServerAsync(
  transports: Record<string, AuthProviderTransport>,
  _context: ContextData | undefined,
  backendLoadingPolicy: BackendLoadingPolicy,
  startupPolicy: BackendStartupPolicy,
): Promise<ServerSetupResult> {
  // Get agent config for feature flags
  const agentConfig = AgentConfigManager.getInstance();

  // Initialize instruction aggregator
  const instructionAggregator = new InstructionAggregator();
  logger.info('server.instruction.aggregator.initialized.e753c4c6');

  // Initialize client manager without connecting (for async loading)
  const clientManager = ClientManager.getOrCreateInstance();
  clientManager.setInstructionAggregator(instructionAggregator);
  const clients = clientManager.initializeClientsAsync(transports);
  logger.info('server.initialized.storage.for.mcp.servers.fbc15149');

  // Create server manager with empty clients initially
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: SERVER_CAPABILITIES_RECORD },
    clients,
    transports,
  );
  serverManager.setInstructionAggregator(instructionAggregator);

  // Config reload is now handled by ConfigManager and ConfigChangeHandler initialized in setupServer

  // Create loading manager for async MCP server initialization
  const loadingManager = new McpLoadingManager(clientManager, backendLoadingPolicy);

  // Create async loading orchestrator for capability tracking and notifications
  const asyncOrchestrator = new AsyncLoadingOrchestrator(clients, serverManager, loadingManager);
  await asyncOrchestrator.initialize(startupPolicy);

  // Create lazy loading orchestrator if enabled
  const lazyLoadingEnabled = agentConfig.get('lazyLoading').enabled;
  let lazyLoadingOrchestrator: LazyLoadingOrchestrator | undefined;
  if (lazyLoadingEnabled) {
    lazyLoadingOrchestrator = new LazyLoadingOrchestrator(clients, agentConfig, asyncOrchestrator);
    await lazyLoadingOrchestrator.initialize();
    serverManager.setLazyLoadingOrchestrator(lazyLoadingOrchestrator);

    // Inject lazy loading orchestrator into internal capabilities provider
    const internalProvider = InternalCapabilitiesProvider.getInstance();
    internalProvider.setLazyLoadingOrchestrator(lazyLoadingOrchestrator);

    logger.info('server.lazy.loading.orchestrator.initialized.630c4de5');
  }

  clientManager.setBackendAvailabilityHandler(async () => {
    await asyncOrchestrator.refreshCapabilities();
    if (lazyLoadingOrchestrator) {
      await lazyLoadingOrchestrator.refreshCapabilities();
    }
  });

  // Start async loading (non-blocking)
  const loadingPromise = loadingManager
    .startAsyncLoading(transports)
    .then(() => loadingManager.waitForInitialLoading())
    .then(() => {
      logger.info('server.all.mcp.servers.finished.loading.successfully.or.failed.c38ed544');
    })
    .catch((_error) => {
      logger.error('server.mcp.loading.process.encountered.an.error.7f0984df');
    });

  logger.info('server.async.server.setup.completed.http.server.ready.mcp.servers.loading.in.backg.c75ae6ef');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
    asyncOrchestrator,
    lazyLoadingOrchestrator,
    instructionAggregator,
  };
}

/**
 * Set up server with legacy synchronous loading
 * Waits for all MCP servers to load before returning
 */
async function setupServerSync(
  transports: Record<string, AuthProviderTransport>,
  _context: ContextData | undefined,
  backendLoadingPolicy: BackendLoadingPolicy,
): Promise<ServerSetupResult> {
  // Get agent config for feature flags
  const agentConfig = AgentConfigManager.getInstance();

  // Initialize instruction aggregator
  const instructionAggregator = new InstructionAggregator();
  logger.info('server.instruction.aggregator.initialized.e753c4c6');

  // Use the standard synchronous client creation
  const clientManager = ClientManager.getOrCreateInstance();
  clientManager.setInstructionAggregator(instructionAggregator);
  const clients = await clientManager.createClients(transports);
  logger.info('server.connected.to.mcp.servers.synchronously.cb5b7480');

  // Create server manager with connected clients
  const serverManager = ServerManager.getOrCreateInstance(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: SERVER_CAPABILITIES_RECORD },
    clients,
    transports,
  );
  serverManager.setInstructionAggregator(instructionAggregator);
  serverManager.syncMcpServerLifecycleFromConnectedClients();

  // Config reload is now handled by ConfigManager and ConfigChangeHandler initialized in setupServer

  // Create lazy loading orchestrator if enabled (no async orchestrator in sync mode)
  const lazyLoadingEnabled = agentConfig.get('lazyLoading').enabled;
  let lazyLoadingOrchestrator: LazyLoadingOrchestrator | undefined;
  if (lazyLoadingEnabled) {
    lazyLoadingOrchestrator = new LazyLoadingOrchestrator(clients, agentConfig, undefined);
    await lazyLoadingOrchestrator.initialize();
    serverManager.setLazyLoadingOrchestrator(lazyLoadingOrchestrator);

    // Inject lazy loading orchestrator into internal capabilities provider
    const internalProvider = InternalCapabilitiesProvider.getInstance();
    internalProvider.setLazyLoadingOrchestrator(lazyLoadingOrchestrator);

    logger.info('server.lazy.loading.orchestrator.initialized.630c4de5');
  }

  // Create a dummy loading manager for compatibility
  const loadingManager = new McpLoadingManager(clientManager, backendLoadingPolicy);
  const loadingPromise = Promise.resolve(); // Already loaded
  clientManager.setBackendAvailabilityHandler(() => serverManager.notifyBackendCapabilityListsChanged());

  logger.info('server.synchronous.server.setup.completed.all.mcp.servers.connected.5893f787');

  return {
    serverManager,
    loadingManager,
    loadingPromise,
    lazyLoadingOrchestrator,
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
      debugIf(() => ({ message: 'server.preset.changed.sending.notifications.0e9970c7' }));
      await notificationService.notifyPresetChange(presetName);
    });

    logger.info('server.preset.management.system.initialized.successfully.df5fbccc');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('server.failed.to.initialize.preset.system.7da5a6aa', { error: errorMessage });
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
