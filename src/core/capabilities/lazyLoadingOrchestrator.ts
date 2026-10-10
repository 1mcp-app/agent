import { EventEmitter } from 'events';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ConnectionResolver, TemplateHashProvider } from '@src/core/server/connectionResolver.js';
import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf, errorIf } from '@src/logger/logger.js';
import type { Tool } from '@src/sdk/contracts/index.js';

import { AsyncLoadingOrchestrator } from './asyncLoadingOrchestrator.js';
import { AsyncLoadingOrchestratorEvent } from './asyncLoadingOrchestratorEvent.js';
import { AggregatedCapabilities, CapabilityAggregator } from './capabilityAggregator.js';
import type { ToolDispatchDecision } from './capabilityCatalog.js';
import { type CapabilityVisibility, getCapabilityVisibleServerNames } from './capabilityVisibility.js';
import { MetaToolProvider } from './metaToolProvider.js';
import type { RuntimeCapabilitySnapshot } from './runtimeCapabilityCatalog.js';
import { SchemaCache, SchemaCacheConfig } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

/** Minimum delay before retrying a registry build that some backend failed to enumerate. */
const FAILED_SOURCE_RETRY_MS = 30_000;

/**
 * Lazy loading statistics for monitoring
 */
export interface LazyLoadingStats {
  enabled: boolean;
  registeredToolCount: number;
  loadedToolCount: number;
  cachedToolCount: number;
  cacheHitRate: number;
  tokenSavings: {
    currentTokens: number;
    fullLoadTokens: number;
    savedTokens: number;
    savingsPercentage: number;
  };
}

/**
 * LazyLoadingOrchestrator coordinates lazy loading of tool schemas.
 *
 * Uses composition pattern to combine:
 * - ToolRegistry for lightweight tool metadata
 * - SchemaCache for on-demand schema loading
 * - MetaToolProvider for meta-tool exposure
 * - CapabilityAggregator for full capabilities
 *
 * @example
 * ```typescript
 * const orchestrator = new LazyLoadingOrchestrator(
 *   outboundConnections,
 *   agentConfig
 * );
 * await orchestrator.initialize();
 * const capabilities = await orchestrator.getCapabilities();
 * ```
 */
export class LazyLoadingOrchestrator extends EventEmitter {
  private outboundConnections: OutboundConnections;
  private config: AgentConfigManager;
  private toolRegistry: ToolRegistry;
  private registrySnapshot?: RuntimeCapabilitySnapshot;
  private registryBuiltAt = 0;
  private registryRefresh?: Promise<void>;
  private schemaCache: SchemaCache;
  private metaToolProvider?: MetaToolProvider;
  private capabilityAggregator: CapabilityAggregator;
  private isInitialized: boolean = false;
  private recoveryRefreshInFlight?: Promise<AggregatedCapabilities>;
  private asyncOrchestrator?: AsyncLoadingOrchestrator;
  private connectionResolver: ConnectionResolver;

  constructor(
    outboundConnections: OutboundConnections,
    config: AgentConfigManager,
    asyncOrchestrator?: AsyncLoadingOrchestrator,
    templateHashProvider?: TemplateHashProvider,
  ) {
    super();
    this.outboundConnections = outboundConnections;
    this.config = config;
    this.asyncOrchestrator = asyncOrchestrator;
    this.connectionResolver = new ConnectionResolver(outboundConnections, templateHashProvider);

    // Get lazy loading config
    const lazyConfig = config.get('lazyLoading');

    // Initialize schema cache
    const cacheConfig: SchemaCacheConfig = {
      maxEntries: lazyConfig.cache.maxEntries,
      ttlMs: lazyConfig.cache.ttlMs,
    };
    this.schemaCache = new SchemaCache(cacheConfig);

    // Initialize tool registry (empty initially)
    this.toolRegistry = ToolRegistry.empty();

    // Initialize capability aggregator (for resources/prompts and full mode)
    this.capabilityAggregator = new CapabilityAggregator(outboundConnections);

    // Initialize meta-tool provider if lazy loading is enabled
    if (lazyConfig.enabled) {
      this.metaToolProvider = new MetaToolProvider(
        () => this.getCurrentToolRegistry(),
        this.schemaCache,
        outboundConnections,
        this.loadSchemaFromServer.bind(this),
        undefined,
        templateHashProvider,
        async () => {
          await this.refreshCapabilitiesForRecovery();
        },
      );
    }

    // Refresh the ToolRegistry only after a completed Capability Snapshot is published.
    if (asyncOrchestrator) {
      asyncOrchestrator.on(AsyncLoadingOrchestratorEvent.CapabilitySnapshotPublished, async () => {
        try {
          debugIf('lazyLoadingOrchestrator.completed.capability.snapshot.published.refreshing.tool.registry.45a92b60');
          await this.refreshCapabilities();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errorIf(() => ({
            message: 'lazyLoadingOrchestrator.failed.to.refresh.tool.registry.after.capability.publication.e9fa75b7',
            meta: { error: errorMessage },
          }));
        }
      });
    }

    this.setMaxListeners(50);
  }

  /**
   * Initialize the orchestrator
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      debugIf('lazyLoadingOrchestrator.lazyloadingorchestrator.already.initialized.f99932cd');
      return;
    }

    const lazyConfig = this.config.get('lazyLoading');

    // Update capabilities first
    await this.capabilityAggregator.updateCapabilities();

    if (lazyConfig.enabled) {
      // Build tool registry from aggregated capabilities
      await this.buildToolRegistry();

      // Preload tools based on configuration
      if (lazyConfig.preload.patterns.length > 0 || lazyConfig.preload.keywords.length > 0) {
        await this.preloadTools();
      }

      logger.info('lazyLoadingOrchestrator.lazyloadingorchestrator.initialized.with.tools.241342ee');
    } else {
      logger.info('lazyLoadingOrchestrator.lazyloadingorchestrator.initialized.in.full.mode.disabled.b540cc45');
    }

    this.isInitialized = true;
  }

  /**
   * Build tool registry from aggregated capabilities
   */
  private async buildToolRegistry(): Promise<void> {
    const snapshot = this.capabilityAggregator.getCatalogSnapshot();
    this.registrySnapshot = snapshot;
    this.registryBuiltAt = Date.now();
    this.toolRegistry = ToolRegistry.fromGeneration(
      this.capabilityAggregator.getCatalogGeneration(),
      new Map(Array.from(snapshot?.connections ?? [], ([key, connection]) => [key, connection.tags])),
      snapshot?.connections,
      snapshot?.isCurrent,
      this.capabilityAggregator.getCurrentCapabilities().capabilityMeta?.tools,
    );
  }

  /**
   * Get a tool registry that reflects the current backends.
   *
   * The registry is built from one Capability Snapshot. That snapshot stops being current
   * when a backend reconnects or its catalog scope expires, and it misses servers that
   * connected later or failed to enumerate tools. Rebuild it on demand in those cases
   * instead of serving an empty or partial registry until the next loading cycle.
   */
  public async getCurrentToolRegistry(): Promise<ToolRegistry> {
    if (!this.isEnabled() || !this.toolRegistryNeedsRefresh()) return this.toolRegistry;
    this.registryRefresh ??= this.refreshCapabilities()
      .then(() => undefined)
      .catch((error: unknown) => {
        errorIf(() => ({
          message: 'lazyLoadingOrchestrator.failed.to.rebuild.stale.tool.registry.e3259fed',
          meta: { error: error },
        }));
        throw error;
      })
      .finally(() => {
        this.registryRefresh = undefined;
      });
    await this.registryRefresh;
    return this.toolRegistry;
  }

  private toolRegistryNeedsRefresh(): boolean {
    const snapshot = this.registrySnapshot;
    if (!snapshot?.isCurrent()) return true;
    for (const [key, connection] of this.outboundConnections) {
      if (connection.status === ClientStatus.Connected && !snapshot.connections.has(key)) return true;
    }
    if (!snapshot.hasFailedSources('tools')) return false;
    return Date.now() - this.registryBuiltAt >= FAILED_SOURCE_RETRY_MS;
  }

  /**
   * Preload tools based on configuration patterns
   */
  private async preloadTools(): Promise<void> {
    const lazyConfig = this.config.get('lazyLoading');
    const preload = lazyConfig.preload;

    if (preload.patterns.length === 0 && preload.keywords.length === 0) {
      return;
    }

    // Find tools to preload
    const toolsToPreload: Array<{ server: string; toolName: string }> = [];
    const allTools = this.toolRegistry.listTools({}).tools;

    for (const tool of allTools) {
      // Check server pattern match
      const serverMatch = preload.patterns.some((pattern) => {
        try {
          // Escape special regex chars and convert glob patterns: * -> .*, ? -> .
          const escaped = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.');
          const regex = new RegExp(`^${escaped}$`);
          return regex.test(tool.server);
        } catch (error) {
          errorIf(() => ({
            message: 'lazyLoadingOrchestrator.invalid.pattern.in.preload.configuration.0be109eb',
            meta: { error: error },
          }));
          return false;
        }
      });

      // Check keyword match
      const keywordMatch = preload.keywords.some((keyword) => tool.name.toLowerCase().includes(keyword.toLowerCase()));

      if (serverMatch || keywordMatch) {
        toolsToPreload.push({
          server: tool.server,
          toolName: tool.name,
        });
      }
    }

    if (toolsToPreload.length === 0) {
      debugIf('lazyLoadingOrchestrator.no.tools.matched.preload.patterns.b01649c3');
      return;
    }

    debugIf(() => ({ message: 'lazyLoadingOrchestrator.preloading.tools.d9e5a23c' }));

    // Preload schemas
    await this.schemaCache.preload(toolsToPreload, async (server, toolName, signal) => {
      return this.loadSchemaFromServer(server, toolName, signal);
    });

    logger.info('lazyLoadingOrchestrator.preloaded.tool.schemas.83afb0f7');
  }

  /**
   * Load tool schema from upstream server
   */
  private async loadSchemaFromServer(server: string, toolName: string, signal?: AbortSignal): Promise<Tool> {
    // Use ConnectionResolver to find the connection (handles template servers with hash-suffixed keys)
    const result = this.connectionResolver.findByServerName(server);
    if (!result || result.connection.status !== ClientStatus.Connected) {
      throw new Error(`Server not connected: ${server}`);
    }

    // Get the tool from server's listTools
    const toolsResult = await requestLegacyAdapter<{ tools: Tool[] }>(
      result.connection.adapter,
      'tools/list',
      undefined,
      { timeoutMs: result.connection.requestTimeoutMs, signal },
    );
    const tool = toolsResult.tools.find((t) => t.name === toolName);

    if (!tool) {
      throw new Error(`Tool not found: ${server}:${toolName}`);
    }

    return tool;
  }

  /**
   * Preload a specific list of tools (for internal management tool)
   */
  public async preloadToolsList(tools: Array<{ server: string; toolName: string }>): Promise<void> {
    if (tools.length === 0) {
      debugIf('lazyLoadingOrchestrator.no.tools.to.preload.0f255fe3');
      return;
    }

    debugIf(() => ({ message: 'lazyLoadingOrchestrator.preloading.specific.tools.5316dabc' }));

    // Preload schemas
    await this.schemaCache.preload(tools, async (server, toolName, signal) => {
      return this.loadSchemaFromServer(server, toolName, signal);
    });

    logger.info('lazyLoadingOrchestrator.preloaded.tool.schemas.83afb0f7');
  }

  /**
   * Get aggregated capabilities based on lazy loading configuration
   */
  public async getCapabilities(): Promise<AggregatedCapabilities> {
    const lazyConfig = this.config.get('lazyLoading');
    const baseCapabilities = this.capabilityAggregator.getCurrentCapabilities();

    if (!lazyConfig.enabled) {
      // Disabled: return all capabilities normally
      return baseCapabilities;
    }

    // Meta-tool mode: only 3 meta-tools + all resources/prompts
    const metaTools = this.metaToolProvider?.getMetaTools() || [];

    return {
      capabilityMeta: baseCapabilities.capabilityMeta,
      tools: metaTools,
      resources: baseCapabilities.resources,
      resourceTemplates: baseCapabilities.resourceTemplates,
      prompts: baseCapabilities.prompts,
      readyServers: baseCapabilities.readyServers,
      timestamp: new Date(),
    };
  }

  /**
   * Get aggregated capabilities for a filtered set of servers
   *
   * @param visibility - Request-scoped capability visibility
   * @returns Aggregated capabilities filtered to only include specified servers
   */
  public async getCapabilitiesForVisibility(visibility: CapabilityVisibility): Promise<AggregatedCapabilities> {
    // Get the base capabilities
    const lazyConfig = this.config.get('lazyLoading');
    const baseCapabilities = this.capabilityAggregator.getCurrentCapabilities();

    if (!lazyConfig.enabled) {
      // Disabled: return all capabilities normally (filtering not applied)
      return baseCapabilities;
    }

    // Meta-tools are always included (they're gateway tools)
    // The filter will be applied when tools are listed via meta-tools
    const metaTools = this.metaToolProvider?.getMetaTools() || [];
    const visibleServerNames = getCapabilityVisibleServerNames(visibility);

    const entries = this.capabilityAggregator
      .getCatalogGeneration()
      .entries.filter(
        (entry) => entry.route.origin === 'internal' || visibility.serverCandidates.has(entry.route.connectionKey),
      );
    const filteredResources = entries
      .filter((entry) => entry.route.kind === 'resources')
      .map((entry) => entry.publicObject);
    const filteredPrompts = entries
      .filter((entry) => entry.route.kind === 'prompts')
      .map((entry) => entry.publicObject);
    const filteredTemplates = entries
      .filter((entry) => entry.route.kind === 'resourceTemplates')
      .map((entry) => entry.publicObject);

    // Filter ready servers
    const filteredReadyServers = baseCapabilities.readyServers.filter((serverName) =>
      visibleServerNames.has(serverName),
    );

    return {
      capabilityMeta: baseCapabilities.capabilityMeta,
      tools: metaTools,
      resources: filteredResources as unknown as AggregatedCapabilities['resources'],
      resourceTemplates: filteredTemplates as unknown as AggregatedCapabilities['resourceTemplates'],
      prompts: filteredPrompts as unknown as AggregatedCapabilities['prompts'],
      readyServers: filteredReadyServers,
      timestamp: new Date(),
    };
  }

  /**
   * Handle listChanged notifications based on lazy loading state
   */
  public shouldNotifyListChanged(): boolean {
    const lazyConfig = this.config.get('lazyLoading');

    if (lazyConfig.enabled) {
      // No listChanged in meta-tool mode (static tool list)
      return false;
    }

    // Standard MCP behavior when disabled
    return true;
  }

  /**
   * Refresh capabilities from all servers
   */
  public refreshCapabilitiesForRecovery(): Promise<AggregatedCapabilities> {
    if (this.recoveryRefreshInFlight) return this.recoveryRefreshInFlight;
    this.recoveryRefreshInFlight = this.refreshCapabilities().finally(() => {
      this.recoveryRefreshInFlight = undefined;
    });
    return this.recoveryRefreshInFlight;
  }

  public async refreshCapabilities(): Promise<AggregatedCapabilities> {
    await this.capabilityAggregator.updateCapabilities();

    if (this.config.get('lazyLoading').enabled) {
      await this.buildToolRegistry();
    }

    return this.getCapabilities();
  }

  /**
   * Get lazy loading statistics
   */
  public getStatistics(): LazyLoadingStats {
    const lazyConfig = this.config.get('lazyLoading');
    const cacheStats = this.schemaCache.getStats();
    const registeredCount = this.toolRegistry.size();

    // Calculate token savings
    const currentTokens = this.calculateCurrentTokens();
    const fullLoadTokens = this.calculateFullLoadTokens();
    const savedTokens = fullLoadTokens - currentTokens;
    const savingsPercentage = fullLoadTokens > 0 ? (savedTokens / fullLoadTokens) * 100 : 0;

    return {
      enabled: lazyConfig.enabled,
      registeredToolCount: registeredCount,
      loadedToolCount: this.schemaCache.size(),
      cachedToolCount: this.schemaCache.size(),
      cacheHitRate: cacheStats.hitRate,
      tokenSavings: {
        currentTokens,
        fullLoadTokens,
        savedTokens,
        savingsPercentage,
      },
    };
  }

  /**
   * Calculate current token usage
   */
  private calculateCurrentTokens(): number {
    const lazyConfig = this.config.get('lazyLoading');

    if (!lazyConfig.enabled) {
      return this.calculateFullLoadTokens();
    }

    // Meta-tools: ~300 tokens
    const metaToolTokens = 300;

    // Tools in registry: names + descriptions only (~10 tokens per tool)
    const registryTokens = this.toolRegistry.size() * 10;

    // Resources and prompts: loaded fully
    const capabilities = this.capabilityAggregator.getCurrentCapabilities();
    const resourcesTokens = capabilities.resources.length * 50; // ~50 tokens per resource
    const promptsTokens = capabilities.prompts.length * 50; // ~50 tokens per prompt

    return metaToolTokens + registryTokens + resourcesTokens + promptsTokens;
  }

  /**
   * Calculate full load token usage
   */
  private calculateFullLoadTokens(): number {
    const capabilities = this.capabilityAggregator.getCurrentCapabilities();

    // Tools with schemas: ~300 tokens per tool (complex schemas)
    const toolTokens = capabilities.tools.length * 300;

    // Resources: ~50 tokens per resource
    const resourcesTokens = capabilities.resources.length * 50;

    // Prompts: ~50 tokens per prompt
    const promptsTokens = capabilities.prompts.length * 50;

    return toolTokens + resourcesTokens + promptsTokens;
  }

  /**
   * Call a meta-tool if in meta-tool mode
   * @param name - Meta-tool name
   * @param args - Meta-tool arguments
   * @param visibility - Request-scoped Filter Selection and Server Candidate Set
   * @param toolRegistry - Registry built from the caller's own snapshot; defaults to the shared registry
   */
  public async callMetaTool(
    name: string,
    args: unknown,
    visibility?: CapabilityVisibility,
    signal?: AbortSignal,
    toolRegistry?: ToolRegistry,
    beforeDispatch?: () => Promise<ToolDispatchDecision>,
  ): Promise<unknown> {
    if (!this.metaToolProvider) {
      throw new Error('Meta-tool provider not initialized');
    }

    return this.metaToolProvider.callMetaTool(name, args, visibility, signal, toolRegistry, beforeDispatch);
  }

  /**
   * Check if a tool call is a meta-tool
   */
  public isMetaTool(name: string): boolean {
    return name === 'tool_list' || name === 'tool_schema' || name === 'tool_invoke';
  }

  /**
   * Get the tool registry as last built. A stale registry starts a background rebuild;
   * callers that can wait should use getCurrentToolRegistry().
   */
  public getToolRegistry(): ToolRegistry {
    if (this.isEnabled() && this.toolRegistryNeedsRefresh()) {
      // The synchronous accessor starts a background refresh; awaited request access propagates failures.
      void this.getCurrentToolRegistry().catch(() => undefined);
    }
    return this.toolRegistry;
  }

  /**
   * Get the capability aggregator
   */
  public getCapabilityAggregator(): CapabilityAggregator {
    return this.capabilityAggregator;
  }

  /**
   * Get the schema cache
   */
  public getSchemaCache(): SchemaCache {
    return this.schemaCache;
  }

  /**
   * Check if lazy loading is enabled
   */
  public isEnabled(): boolean {
    return this.config.get('lazyLoading').enabled;
  }

  /**
   * Health check for lazy loading subsystem
   * @returns Health status with details
   */
  public getHealthStatus(): {
    healthy: boolean;
    enabled: boolean;
    cache: {
      size: number;
      maxEntries: number;
      utilizationRate: number;
    };
    stats: {
      hitRate: number;
      coalescedRequests: number;
      evictions: number;
    };
    issues: string[];
  } {
    const lazyConfig = this.config.get('lazyLoading');
    const cacheStats = this.schemaCache.getStats();
    const cacheSize = this.schemaCache.size();
    const issues: string[] = [];

    // Check cache utilization (guard against division by zero)
    const maxEntries = lazyConfig.cache.maxEntries;
    const utilizationRate = maxEntries > 0 ? (cacheSize / maxEntries) * 100 : 0;
    if (utilizationRate > 90) {
      issues.push(`Cache utilization high: ${utilizationRate.toFixed(1)}%`);
    }

    // Check hit rate
    const totalRequests = cacheStats.hits + cacheStats.misses;
    const hitRate = totalRequests > 0 ? cacheStats.hitRate : 0;

    // Only warn about low hit rate if we've had enough requests
    if (totalRequests > 100 && hitRate < 50) {
      issues.push(`Low cache hit rate: ${hitRate.toFixed(1)}%`);
    }

    // Check eviction rate
    if (cacheStats.evictions > 100) {
      issues.push(`High eviction count: ${cacheStats.evictions}`);
    }

    return {
      healthy: issues.length === 0,
      enabled: lazyConfig.enabled,
      cache: {
        size: cacheSize,
        maxEntries: lazyConfig.cache.maxEntries,
        utilizationRate,
      },
      stats: {
        hitRate,
        coalescedRequests: cacheStats.coalesced,
        evictions: cacheStats.evictions,
      },
      issues,
    };
  }

  /**
   * Log periodic lazy loading statistics (for monitoring and observability)
   * @param forceLog - Force logging even if debug mode is off
   */
  public logStatistics(forceLog = false): void {
    if (forceLog) {
      logger.info('lazyLoadingOrchestrator.logstatistics.diagnostic.f3e28cfb');
    } else {
      debugIf('lazyLoadingOrchestrator.logstatistics.diagnostic.f3e28cfb');
    }
  }
}
