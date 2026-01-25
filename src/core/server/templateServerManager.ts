import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ClientTemplateTracker, TemplateFilteringService, TemplateIndex } from '@src/core/filtering/index.js';
import { ClientInstancePool, type PooledClientInstance } from '@src/core/server/clientInstancePool.js';
import type { AuthProviderTransport } from '@src/core/types/client.js';
import type { OutboundConnections } from '@src/core/types/client.js';
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

/**
 * Manages template-based server instances and client pools
 */

export class TemplateServerManager {
  private clientInstancePool: ClientInstancePool;
  private templateSessionMap?: Map<string, string>; // Maps template name to session ID for tracking
  private cleanupTimer?: ReturnType<typeof setInterval>; // Timer for idle instance cleanup

  // Maps sessionId -> (templateName -> renderedHash) for routing shareable servers
  private sessionToRenderedHash = new Map<string, Map<string, string>>();

  // Enhanced filtering components
  private clientTemplateTracker = new ClientTemplateTracker();
  private templateIndex = new TemplateIndex();

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
  ): Promise<void> {
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
        // Determine the key format based on shareable setting
        const isShareable = templateConfig.template?.shareable !== false; // Default true
        const renderedHash = instance.renderedHash; // From the pooled instance

        // Use rendered hash-based key for shareable servers, session-scoped for per-client
        const outboundKey = isShareable ? `${templateName}:${renderedHash}` : `${templateName}:${sessionId}`;

        outboundConns.set(outboundKey, {
          name: templateName, // Keep clean name for tool namespacing (serena_1mcp_*)
          transport: instance.transport as AuthProviderTransport,
          client: instance.client,
          status: ClientStatus.Connected, // Template servers should be connected
          capabilities: undefined, // Will be populated by setupCapabilities
        });

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

        debugIf(() => ({
          message: `TemplateServerManager.createTemplateBasedServers: Tracked client-template relationship`,
          meta: {
            sessionId,
            templateName,
            outboundKey,
            instanceId: instance.id,
            referenceCount: instance.referenceCount,
            shareable: isShareable,
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
        logger.error(`Failed to create client instance from template ${templateName}:`, error);
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
    // Enhanced cleanup using client template tracker
    const instancesToCleanup = this.clientTemplateTracker.removeClient(sessionId);
    logger.info(`Removing client from ${instancesToCleanup.length} template instances`, {
      sessionId,
      instancesToCleanup,
    });

    // Remove client from client instance pool
    for (const instanceKey of instancesToCleanup) {
      const [templateName, ...instanceParts] = instanceKey.split(':');
      const instanceId = instanceParts.join(':');

      try {
        // Get the rendered hash for this session's template instance
        const sessionHashes = this.sessionToRenderedHash.get(sessionId);
        const renderedHash = sessionHashes?.get(templateName);

        // Determine if this was a shareable or per-client instance
        // We can tell by checking if the outbound key pattern matches rendered hash or sessionId
        let outboundKey: string;
        let isShareable = false;

        if (renderedHash) {
          const hashKey = `${templateName}:${renderedHash}`;
          const sessionKey = `${templateName}:${sessionId}`;

          // Check which key exists in outboundConns
          if (outboundConns.has(hashKey)) {
            outboundKey = hashKey;
            isShareable = true;
          } else if (outboundConns.has(sessionKey)) {
            outboundKey = sessionKey;
            isShareable = false;
          } else {
            // Fallback: neither key found, try session key
            outboundKey = sessionKey;
            isShareable = false;
          }
        } else {
          // No rendered hash found, assume per-client
          outboundKey = `${templateName}:${sessionId}`;
          isShareable = false;
        }

        // Remove the client from the instance pool
        this.clientInstancePool.removeClientFromInstance(instanceKey, sessionId);

        // Clean up session-to-renderedHash mapping
        if (sessionHashes) {
          sessionHashes.delete(templateName);
          if (sessionHashes.size === 0) {
            this.sessionToRenderedHash.delete(sessionId);
          }
        }

        debugIf(() => ({
          message: `TemplateServerManager.cleanupTemplateServers: Successfully removed client from client instance`,
          meta: {
            sessionId,
            templateName,
            instanceId,
            instanceKey,
            outboundKey,
            isShareable,
            renderedHash: renderedHash?.substring(0, 8),
          },
        }));

        // Check if this instance has no more clients
        const remainingClients = this.clientTemplateTracker.getClientCount(templateName, instanceId);

        // For shareable servers, only remove the outbound connection if no more clients
        // For per-client servers, always remove the connection
        if (isShareable && remainingClients === 0) {
          // No more clients for this shareable instance, safe to remove the shared connection
          const removed = outboundConns.delete(outboundKey);
          if (removed) {
            logger.debug(`Removed shareable template server from outbound connections: ${outboundKey}`);
          }
        } else if (!isShareable) {
          // Per-client: always remove the session-scoped connection
          const removed = outboundConns.delete(outboundKey);
          if (removed) {
            logger.debug(`Removed template server from outbound connections: ${outboundKey}`);
          }
        } else {
          debugIf(() => ({
            message: `Shareable template server still has clients, keeping connection`,
            meta: { outboundKey, remainingClients },
          }));
        }

        // Clean up transport entry if the instance is being removed
        if (remainingClients === 0 && instanceId) {
          delete transports[instanceId];
          logger.debug(`Removed transport for instance: ${instanceId}`);
        }

        if (remainingClients === 0) {
          // No more clients, instance becomes idle
          // The client instance will be closed after idle timeout by the cleanup timer
          logger.debug(`Client instance ${instanceId} has no more clients, marking as idle for cleanup after timeout`, {
            templateName,
            instanceId,
            idleTimeout: 5 * 60 * 1000, // 5 minutes default
          });
        } else {
          debugIf(() => ({
            message: `Client instance ${instanceId} still has ${remainingClients} clients, keeping connection open`,
            meta: { instanceId, remainingClients },
          }));
        }
      } catch (error) {
        logger.warn(`Failed to cleanup client instance ${instanceKey}:`, {
          error: error instanceof Error ? error.message : 'Unknown error',
          sessionId,
          templateName,
          instanceId,
        });
      }
    }

    logger.info(`Cleaned up template client instances for session ${sessionId}`, {
      instancesCleaned: instancesToCleanup.length,
    });
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
  public async cleanupIdleInstances(): Promise<number> {
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
        await this.clientInstancePool.removeInstance(`${templateName}:${instance.renderedHash}`);

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
  public cleanup(): void {
    // Clean up cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear session-to-rendered-hash mapping
    this.sessionToRenderedHash.clear();

    // Clear template session map
    this.templateSessionMap?.clear();

    // Clean up the client instance pool
    this.clientInstancePool?.cleanupIdleInstances();

    // Register process exit handler for graceful shutdown
    if (typeof process !== 'undefined') {
      process.on('exit', () => this.cleanup());
    }
  }
}
