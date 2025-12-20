import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ConfigManager } from '@src/config/configManager.js';
import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import { ClientTemplateTracker, FilterCache, getFilterCache, TemplateIndex } from '@src/core/filtering/index.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ConnectionManager } from '@src/core/server/connectionManager.js';
import { MCPServerLifecycleManager } from '@src/core/server/mcpServerLifecycleManager.js';
import { TemplateConfigurationManager } from '@src/core/server/templateConfigurationManager.js';
import { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import type {
  InboundConnection,
  InboundConnectionConfig,
  MCPServerParams,
  OperationOptions,
  OutboundConnection,
  OutboundConnections,
} from '@src/core/types/index.js';
import { MCPServerConfiguration } from '@src/core/types/transport.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

/**
 * Refactored ServerManager that coordinates various server management components
 *
 * This class acts as a facade that delegates to specialized managers:
 * - ConnectionManager: Handles transport connection lifecycle
 * - TemplateServerManager: Manages template-based server instances
 * - MCPServerLifecycleManager: Manages MCP server start/stop/restart operations
 * - ConfigurationManager: Handles configuration reprocessing with circuit breaker
 */
export class ServerManager {
  private static instance: ServerManager | undefined;
  private serverConfig: { name: string; version: string };
  private serverCapabilities: { capabilities: Record<string, unknown> };
  private outboundConns: OutboundConnections;
  private transports: Record<string, Transport>;
  private serverConfigData: MCPServerConfiguration | null = null; // Cache the config data
  private instructionAggregator?: InstructionAggregator;

  // Component managers
  private connectionManager: ConnectionManager;
  private templateServerManager: TemplateServerManager;
  private mcpServerLifecycleManager: MCPServerLifecycleManager;
  private templateConfigurationManager: TemplateConfigurationManager;

  // Filtering cache (kept separate as it's a shared resource)
  private filterCache = getFilterCache();

  private constructor(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ) {
    this.serverConfig = config;
    this.serverCapabilities = capabilities;
    this.outboundConns = outboundConns;
    this.transports = transports;

    // Initialize component managers
    this.connectionManager = new ConnectionManager(config, capabilities, outboundConns);
    this.templateServerManager = new TemplateServerManager();
    this.mcpServerLifecycleManager = new MCPServerLifecycleManager();
    this.templateConfigurationManager = new TemplateConfigurationManager();
  }

  public static getOrCreateInstance(
    config: { name: string; version: string },
    capabilities: { capabilities: Record<string, unknown> },
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): ServerManager {
    if (!ServerManager.instance) {
      ServerManager.instance = new ServerManager(config, capabilities, outboundConns, transports);
    }
    return ServerManager.instance;
  }

  public static get current(): ServerManager {
    if (!ServerManager.instance) {
      throw new Error('ServerManager not initialized');
    }
    return ServerManager.instance;
  }

  // Test utility method to reset singleton state
  public static async resetInstance(): Promise<void> {
    if (ServerManager.instance) {
      await ServerManager.instance.cleanup();
      ServerManager.instance = undefined;
    }
  }

  /**
   * Set the instruction aggregator instance
   */
  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;

    // Listen for instruction changes and update existing server instances
    aggregator.on('instructions-changed', () => {
      this.updateServerInstructions();
    });

    // Set up context change listener for template processing
    this.setupContextChangeListener();

    debugIf('Instruction aggregator set for ServerManager');
  }

  /**
   * Set up context change listener for dynamic template processing
   */
  private setupContextChangeListener(): void {
    const globalContextManager = getGlobalContextManager();

    globalContextManager.on('context-changed', async (data: { newContext: ContextData; sessionIdChanged: boolean }) => {
      logger.info('Context changed, reprocessing templates', {
        sessionId: data.newContext?.sessionId,
        sessionChanged: data.sessionIdChanged,
      });

      try {
        await this.templateConfigurationManager.reprocessTemplatesWithNewContext(data.newContext, async (newConfig) => {
          try {
            await this.templateConfigurationManager.updateServersWithNewConfig(
              newConfig,
              this.getCurrentServerConfigs(),
              (serverName, config) => this.startServer(serverName, config),
              (serverName) => this.stopServer(serverName),
              (serverName, config) => this.restartServer(serverName, config),
            );
          } catch (updateError) {
            logger.error('Failed to update all servers with new config, attempting individual updates:', updateError);
            await this.templateConfigurationManager.updateServersIndividually(newConfig, (serverName, config) =>
              this.updateServerMetadata(serverName, config),
            );
          }
        });
      } catch (error) {
        logger.error('Failed to reprocess templates after context change:', error);
      }
    });

    debugIf('Context change listener set up for ServerManager');
  }

  /**
   * Get current server configurations
   */
  private getCurrentServerConfigs(): Map<string, MCPServerParams> {
    const configs = new Map<string, MCPServerParams>();
    const status = this.mcpServerLifecycleManager.getMcpServerStatus();
    for (const [serverName, serverInfo] of status) {
      if (serverInfo.running) {
        configs.set(serverName, serverInfo.config);
      }
    }
    return configs;
  }

  /**
   * Update all server instances with new aggregated instructions
   */
  private updateServerInstructions(): void {
    const inboundConns = this.connectionManager.getInboundConnections();
    logger.info(`Server instructions have changed. Active sessions: ${inboundConns.size}`);

    for (const [sessionId, _inboundConn] of inboundConns) {
      try {
        debugIf(() => ({
          message: `Instructions changed notification for session ${sessionId}`,
          meta: { sessionId },
        }));
      } catch (error) {
        logger.warn(`Failed to process instruction change for session ${sessionId}: ${error}`);
      }
    }
  }

  public async connectTransport(
    transport: Transport,
    sessionId: string,
    opts: InboundConnectionConfig,
    context?: ContextData,
  ): Promise<void> {
    // Get filtered instructions based on client's filter criteria using InstructionAggregator
    const filteredInstructions = this.instructionAggregator?.getFilteredInstructions(opts, this.outboundConns) || '';

    // Load configuration data if not already loaded
    if (!this.serverConfigData) {
      const configManager = ConfigManager.getInstance();
      const { staticServers, templateServers } = await configManager.loadConfigWithTemplates(context);
      this.serverConfigData = {
        mcpServers: staticServers,
        mcpTemplates: templateServers,
      };
    }

    // If we have context, create template-based servers
    if (context && this.serverConfigData.mcpTemplates) {
      await this.templateServerManager.createTemplateBasedServers(
        sessionId,
        context,
        opts,
        this.serverConfigData,
        this.outboundConns,
        this.transports,
      );
    }

    // Connect the transport
    await this.connectionManager.connectTransport(transport, sessionId, opts, context, filteredInstructions);
  }

  public async disconnectTransport(sessionId: string, forceClose: boolean = false): Promise<void> {
    // Clean up template-based servers for this client
    await this.templateServerManager.cleanupTemplateServers(sessionId, this.outboundConns, this.transports);

    // Disconnect the transport
    await this.connectionManager.disconnectTransport(sessionId, forceClose);
  }

  public getTransport(sessionId: string): Transport | undefined {
    return this.connectionManager.getTransport(sessionId);
  }

  public getTransports(): Map<string, Transport> {
    return this.connectionManager.getTransports();
  }

  public getClientTransports(): Record<string, Transport> {
    return this.transports;
  }

  public getClients(): OutboundConnections {
    return this.outboundConns;
  }

  public getClient(serverName: string): OutboundConnection | undefined {
    return this.outboundConns.get(serverName);
  }

  public getActiveTransportsCount(): number {
    return this.connectionManager.getActiveTransportsCount();
  }

  public getServer(sessionId: string): InboundConnection | undefined {
    return this.connectionManager.getServer(sessionId);
  }

  public getInboundConnections(): Map<string, InboundConnection> {
    return this.connectionManager.getInboundConnections();
  }

  public updateClientsAndTransports(newClients: OutboundConnections, newTransports: Record<string, Transport>): void {
    this.outboundConns = newClients;
    this.transports = newTransports;
  }

  public async executeServerOperation<T>(
    inboundConn: InboundConnection,
    operation: (inboundConn: InboundConnection) => Promise<T>,
    options: OperationOptions = {},
  ): Promise<T> {
    return this.connectionManager.executeServerOperation(inboundConn, operation, options);
  }

  public async startServer(serverName: string, config: MCPServerParams): Promise<void> {
    await this.mcpServerLifecycleManager.startServer(serverName, config, this.outboundConns, this.transports);
  }

  public async stopServer(serverName: string): Promise<void> {
    await this.mcpServerLifecycleManager.stopServer(serverName, this.outboundConns, this.transports);
  }

  public async restartServer(serverName: string, config: MCPServerParams): Promise<void> {
    await this.mcpServerLifecycleManager.restartServer(serverName, config, this.outboundConns, this.transports);
  }

  public getMcpServerStatus(): Map<string, { running: boolean; config: MCPServerParams }> {
    return this.mcpServerLifecycleManager.getMcpServerStatus();
  }

  public isMcpServerRunning(serverName: string): boolean {
    return this.mcpServerLifecycleManager.isMcpServerRunning(serverName);
  }

  public async updateServerMetadata(serverName: string, newConfig: MCPServerParams): Promise<void> {
    await this.mcpServerLifecycleManager.updateServerMetadata(serverName, newConfig, this.outboundConns);
  }

  public getFilteringStats(): {
    tracker: ReturnType<ClientTemplateTracker['getStats']> | null;
    cache: ReturnType<FilterCache['getStats']> | null;
    index: ReturnType<TemplateIndex['getStats']> | null;
    enabled: boolean;
  } {
    const stats = this.templateServerManager.getFilteringStats();
    return {
      tracker: stats.tracker,
      cache: this.filterCache.getStats(),
      index: stats.index,
      enabled: stats.enabled,
    };
  }

  public getClientTemplateInfo(): ReturnType<ClientTemplateTracker['getDetailedInfo']> {
    return this.templateServerManager.getClientTemplateInfo();
  }

  public rebuildTemplateIndex(): void {
    this.templateServerManager.rebuildTemplateIndex(this.serverConfigData || undefined);
  }

  public clearFilterCache(): void {
    this.filterCache.clear();
    logger.info('Filter cache cleared');
  }

  public getIdleTemplateInstances(idleTimeoutMs: number = 10 * 60 * 1000): Array<{
    templateName: string;
    instanceId: string;
    idleTime: number;
  }> {
    return this.templateServerManager.getIdleTemplateInstances(idleTimeoutMs);
  }

  public async cleanupIdleInstances(): Promise<number> {
    return this.templateServerManager.cleanupIdleInstances();
  }

  /**
   * Clean up all resources (for shutdown)
   */
  public async cleanup(): Promise<void> {
    // Clean up all connections
    await this.connectionManager.cleanup();

    // Clean up template server manager
    this.templateServerManager.cleanup();

    // Clean up configuration manager
    this.templateConfigurationManager.cleanup();

    // Clear cache
    this.filterCache.clear();

    logger.info('ServerManager cleanup completed');
  }
}
