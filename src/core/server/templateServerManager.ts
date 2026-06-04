import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ClientTemplateTracker, TemplateFilteringService, TemplateIndex } from '@src/core/filtering/index.js';
import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ClientInstancePool, type PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import {
  createRenderedIdentity,
  createSessionIdentity,
  resolveTemplateIdentityMode,
  serializeTemplateIdentity,
} from '@src/core/server/templateIdentity.js';
import {
  cleanupExpiredEphemeralClients,
  cleanupTemplateServersForSession,
  type EphemeralTemplateClient,
} from '@src/core/server/templateServerCleanup.js';
import type { AuthProviderTransport, OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';
import type { InboundConnectionConfig } from '@src/core/types/server.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

/**
 * Options for rebuilding the template index
 */
export interface TemplateRebuildOptions {
  mcpTemplates?: Record<string, MCPServerParams>;
}

export type TemplateClientLifecycle = 'persistent' | 'ephemeral';

/**
 * Manages template-based server instances and client pools
 */
export class TemplateServerManager {
  private clientInstancePool: ClientInstancePool;
  private templateSessionMap?: Map<string, string>; // Maps template name to session ID for tracking
  private cleanupTimer?: ReturnType<typeof setInterval>; // Timer for idle instance cleanup
  private instructionAggregator?: InstructionAggregator;
  private ephemeralClients = new Map<string, Map<string, EphemeralTemplateClient>>();
  private persistentSessions = new Set<string>();
  private outboundConns?: OutboundConnections;
  private transports?: Record<string, Transport>;

  // Maps sessionId -> (templateName -> renderedHash) for routing shareable servers
  private sessionToRenderedHash = new Map<string, Map<string, string>>();

  // Enhanced filtering components
  private clientTemplateTracker = new ClientTemplateTracker();
  private templateIndex = new TemplateIndex();

  // Track failed template server creation attempts
  private failedTemplates: Array<{
    templateName: string;
    sessionId: string;
    error: string;
    timestamp: Date;
  }> = [];

  constructor() {
    // Initialize the client instance pool
    this.clientInstancePool = new ClientInstancePool({
      maxInstances: 50, // Configurable limit
      idleTimeout: 5 * 60 * 1000, // 5 minutes - faster cleanup for development
      cleanupInterval: 30 * 1000, // 30 seconds - more frequent cleanup checks
    });

    // Start cleanup timer for idle template instances
    this.startCleanupTimer();
  }

  /**
   * Set the instruction aggregator for extracting and caching server instructions
   */
  public setInstructionAggregator(aggregator: InstructionAggregator): void {
    this.instructionAggregator = aggregator;
  }

  /**
   * Starts the periodic cleanup timer for idle template instances
   */
  private startCleanupTimer(): void {
    const cleanupInterval = 30 * 1000; // 30 seconds - match pool's cleanup interval
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupIdleInstances();
      } catch (error) {
        logger.error('Error during idle instance cleanup:', error);
      }
    }, cleanupInterval);

    // Ensure the timer doesn't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }

    debugIf(() => ({
      message: 'TemplateServerManager cleanup timer started',
      meta: { interval: cleanupInterval },
    }));
  }

  /**
   * Create template-based servers for a client connection
   */
  public async createTemplateBasedServers(
    sessionId: string,
    context: ContextData,
    opts: InboundConnectionConfig,
    serverConfigData: { mcpTemplates?: Record<string, MCPServerParams> }, // MCPServerConfiguration with templates
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
    lifecycle: TemplateClientLifecycle = 'persistent',
  ): Promise<void> {
    this.outboundConns = outboundConns;
    this.transports = transports;

    if (lifecycle === 'persistent') {
      this.trackPersistentClient(sessionId);
    }

    // Get template servers that match the client's tags/preset
    const templateConfigs = this.getMatchingTemplateConfigs(opts, serverConfigData);

    logger.info(`Creating ${templateConfigs.length} template-based servers for session ${sessionId}`, {
      templates: templateConfigs.map(([name]) => name),
    });

    // Create client instances from templates
    for (const [templateName, templateConfig] of templateConfigs) {
      try {
        // Get or create client instance from template
        const instance = await this.clientInstancePool.getOrCreateClientInstance(
          templateName,
          templateConfig,
          context,
          sessionId,
          templateConfig.template,
        );

        // CRITICAL: Register the template server in outbound connections for capability aggregation
        const renderedHash = instance.renderedHash; // From the pooled instance

        const identityMode = resolveTemplateIdentityMode(templateConfig.template);
        const outboundKey = serializeTemplateIdentity(
          identityMode === 'session'
            ? createSessionIdentity(templateName, sessionId)
            : createRenderedIdentity(templateName, renderedHash),
        );

        outboundConns.set(outboundKey, {
          name: templateName, // Keep clean name for tool namespacing (serena_1mcp_*)
          transport: instance.transport as AuthProviderTransport,
          client: instance.client,
          status: ClientStatus.Connected, // Template servers should be connected
          capabilities: undefined, // Will be populated by setupCapabilities
        });

        // Extract and cache instructions for template servers
        // This ensures instructions are available on first connection
        if (this.instructionAggregator) {
          try {
            const instructions = instance.client.getInstructions();
            if (instructions?.trim()) {
              // Use clean template name (not the hash-suffixed outboundKey)
              this.instructionAggregator.setInstructions(templateName, instructions);
              debugIf(() => ({
                message: `Cached instructions for template server: ${templateName}`,
                meta: { templateName, instructionLength: instructions.length },
              }));
            }
          } catch (error) {
            logger.warn(`Failed to extract instructions from template server ${templateName}: ${error}`);
          }
        }

        // Track session -> rendered hash mapping for routing
        if (!this.sessionToRenderedHash.has(sessionId)) {
          this.sessionToRenderedHash.set(sessionId, new Map());
        }
        this.sessionToRenderedHash.get(sessionId)!.set(templateName, renderedHash);

        // Store session ID mapping separately for cleanup tracking
        if (!this.templateSessionMap) {
          this.templateSessionMap = new Map<string, string>();
        }
        this.templateSessionMap.set(templateName, sessionId);

        // Add to transports map as well using instance ID
        transports[instance.id] = instance.transport;

        // Enhanced client-template tracking
        this.clientTemplateTracker.addClientTemplate(sessionId, templateName, instance.id, {
          shareable: templateConfig.template?.shareable,
          perClient: templateConfig.template?.perClient,
        });

        if (lifecycle === 'ephemeral') {
          this.trackEphemeralClient(sessionId, templateName, instance, outboundKey);
        }

        debugIf(() => ({
          message: `TemplateServerManager.createTemplateBasedServers: Tracked client-template relationship`,
          meta: {
            sessionId,
            templateName,
            outboundKey,
            instanceId: instance.id,
            referenceCount: instance.referenceCount,
            shareable: identityMode === 'rendered',
            perClient: templateConfig.template?.perClient,
            renderedHash: renderedHash.substring(0, 8),
            registeredInOutbound: true,
          },
        }));

        logger.info(`Connected to template client instance: ${templateName} (${instance.id})`, {
          sessionId,
          clientCount: instance.referenceCount,
          registeredInCapabilities: true,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to create client instance from template ${templateName}:`, error);

        // Track the failure
        this.failedTemplates.push({
          templateName,
          sessionId,
          error: errorMessage,
          timestamp: new Date(),
        });

        // Keep only last 100 failures to prevent memory growth
        if (this.failedTemplates.length > 100) {
          this.failedTemplates.shift();
        }
      }
    }
  }

  /**
   * Clean up template-based servers when a client disconnects
   */
  public async cleanupTemplateServers(
    sessionId: string,
    outboundConns: OutboundConnections,
    transports: Record<string, Transport>,
  ): Promise<void> {
    this.outboundConns = outboundConns;
    this.transports = transports;

    await cleanupTemplateServersForSession(sessionId, outboundConns, transports, {
      clientInstancePool: this.clientInstancePool,
      clientTemplateTracker: this.clientTemplateTracker,
      sessionToRenderedHash: this.sessionToRenderedHash,
      ephemeralClients: this.ephemeralClients,
      persistentSessions: this.persistentSessions,
    });
  }

  public trackPersistentClient(sessionId: string): void {
    this.persistentSessions.add(sessionId);
    this.ephemeralClients.delete(sessionId);
  }

  public trackEphemeralClient(
    sessionId: string,
    templateName: string,
    instance: PooledClientInstance,
    outboundKey = `${templateName}:${instance.renderedHash}`,
  ): void {
    if (this.persistentSessions.has(sessionId)) {
      return;
    }

    if (!this.ephemeralClients.has(sessionId)) {
      this.ephemeralClients.set(sessionId, new Map());
    }

    this.ephemeralClients.get(sessionId)!.set(templateName, {
      templateName,
      instanceId: instance.id,
      instanceKey: instance.instanceKey ?? `${templateName}:${instance.renderedHash}`,
      outboundKey,
      lastUsedAt: new Date(),
      idleTimeout: instance.idleTimeout,
    });
  }

  public touchEphemeralClient(sessionId: string, templateName?: string): void {
    const clients = this.ephemeralClients.get(sessionId);
    if (!clients || this.persistentSessions.has(sessionId)) {
      return;
    }

    const now = new Date();
    if (templateName) {
      const client = clients.get(templateName);
      if (client) {
        client.lastUsedAt = now;
      }
      return;
    }

    for (const client of clients.values()) {
      client.lastUsedAt = now;
    }
  }

  /**
   * Get template configurations that match the client's filter criteria
   */
  private getMatchingTemplateConfigs(
    opts: InboundConnectionConfig,
    serverConfigData: { mcpTemplates?: Record<string, MCPServerParams> },
  ): Array<[string, MCPServerParams]> {
    if (!serverConfigData?.mcpTemplates) {
      return [];
    }

    // Validate template entries to ensure type safety
    const templateEntries = Object.entries(serverConfigData.mcpTemplates);
    const templates: Array<[string, MCPServerParams]> = templateEntries.filter(([_name, config]) => {
      // Basic validation of MCPServerParams structure
      return config && typeof config === 'object' && 'command' in config;
    }) as Array<[string, MCPServerParams]>;

    logger.info('TemplateServerManager.getMatchingTemplateConfigs: Using enhanced filtering', {
      totalTemplates: templates.length,
      filterMode: opts.tagFilterMode,
      tags: opts.tags,
      presetName: opts.presetName,
      templateNames: templates.map(([name]) => name),
    });

    return TemplateFilteringService.getMatchingTemplates(templates, opts);
  }

  /**
   * Get idle template instances for cleanup
   */
  public getIdleTemplateInstances(idleTimeoutMs: number = 10 * 60 * 1000): Array<{
    templateName: string;
    instanceId: string;
    idleTime: number;
  }> {
    return this.clientTemplateTracker.getIdleInstances(idleTimeoutMs);
  }

  /**
   * Force cleanup of idle template instances
   */
  public async cleanupIdleInstances(
    outboundConns: OutboundConnections = this.outboundConns ?? new Map<string, OutboundConnection>(),
    transports: Record<string, Transport> = this.transports ?? {},
  ): Promise<number> {
    await cleanupExpiredEphemeralClients(outboundConns, transports, {
      clientInstancePool: this.clientInstancePool,
      clientTemplateTracker: this.clientTemplateTracker,
      sessionToRenderedHash: this.sessionToRenderedHash,
      ephemeralClients: this.ephemeralClients,
      persistentSessions: this.persistentSessions,
    });

    // Get all instances from the pool
    const allInstances = this.clientInstancePool.getAllInstances();
    const instancesToCleanup: Array<{ templateName: string; instanceId: string; instance: PooledClientInstance }> = [];

    for (const instance of allInstances) {
      if (instance.status === 'idle') {
        instancesToCleanup.push({
          templateName: instance.templateName,
          instanceId: instance.id,
          instance,
        });
      }
    }

    let cleanedUp = 0;

    for (const { templateName, instanceId, instance } of instancesToCleanup) {
      try {
        // Remove the instance from the pool
        await this.clientInstancePool.removeInstance(
          instance.instanceKey ?? `${templateName}:${instance.renderedHash}`,
        );

        // Clean up tracking
        this.clientTemplateTracker.cleanupInstance(templateName, instanceId);

        cleanedUp++;
        logger.info(`Cleaned up idle client instance: ${templateName}:${instanceId}`);
      } catch (error) {
        logger.warn(`Failed to cleanup idle client instance ${templateName}:${instanceId}:`, error);
      }
    }

    if (cleanedUp > 0) {
      logger.info(`Cleaned up ${cleanedUp} idle client instances`);
    }

    return cleanedUp;
  }

  /**
   * Rebuild the template index
   */
  public rebuildTemplateIndex(serverConfigData?: TemplateRebuildOptions): void {
    if (serverConfigData?.mcpTemplates) {
      this.templateIndex.buildIndex(serverConfigData.mcpTemplates);
      logger.info('Template index rebuilt');
    }
  }

  /**
   * Get enhanced filtering statistics
   */
  public getFilteringStats(): {
    tracker: ReturnType<ClientTemplateTracker['getStats']> | null;
    index: ReturnType<TemplateIndex['getStats']> | null;
    enabled: boolean;
  } {
    const tracker = this.clientTemplateTracker.getStats();
    const index = this.templateIndex.getStats();

    return {
      tracker,
      index,
      enabled: true,
    };
  }

  /**
   * Get detailed client template tracking information
   */
  public getClientTemplateInfo(): ReturnType<ClientTemplateTracker['getDetailedInfo']> {
    return this.clientTemplateTracker.getDetailedInfo();
  }

  /**
   * Get the client instance pool
   */
  public getClientInstancePool(): ClientInstancePool {
    return this.clientInstancePool;
  }

  /**
   * Get failed template server creation attempts
   */
  public getFailedTemplates(): Array<{
    templateName: string;
    sessionId: string;
    error: string;
    timestamp: Date;
  }> {
    return [...this.failedTemplates];
  }

  /**
   * Get the rendered hash for a specific session and template
   * Used by resolveOutboundConnection to determine the correct outbound key
   */
  public getRenderedHashForSession(sessionId: string, templateName: string): string | undefined {
    return this.sessionToRenderedHash.get(sessionId)?.get(templateName);
  }

  /**
   * Get all rendered hashes for a specific session
   * Used by filterConnectionsForSession to determine which connections to include
   * Returns Map<templateName, renderedHash>
   */
  public getAllRenderedHashesForSession(sessionId: string): Map<string, string> | undefined {
    return this.sessionToRenderedHash.get(sessionId);
  }

  /**
   * Clean up resources (for shutdown)
   */
  public async shutdown(): Promise<void> {
    // Clean up cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.ephemeralClients.clear();
    this.persistentSessions.clear();
    this.sessionToRenderedHash.clear();

    await this.clientInstancePool.shutdown();
  }

  public cleanup(): void {
    this.shutdown().catch((error) => {
      logger.warn('Failed to clean up template server manager:', error);
    });
  }
}
