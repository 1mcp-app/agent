import { EventEmitter } from 'events';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { AsyncLoadingOrchestrator } from './asyncLoadingOrchestrator.js';
import { AggregatedCapabilities, CapabilityAggregator } from './capabilityAggregator.js';
import { MetaToolProvider } from './metaToolProvider.js';
import { SchemaCache, SchemaCacheConfig } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

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
  private schemaCache: SchemaCache;
  private metaToolProvider?: MetaToolProvider;
  private capabilityAggregator: CapabilityAggregator;
  private isInitialized: boolean = false;
  private asyncOrchestrator?: AsyncLoadingOrchestrator;

  constructor(
    outboundConnections: OutboundConnections,
    config: AgentConfigManager,
    asyncOrchestrator?: AsyncLoadingOrchestrator,
  ) {
    super();
    this.outboundConnections = outboundConnections;
    this.config = config;
    this.asyncOrchestrator = asyncOrchestrator;

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
        () => this.toolRegistry,
        this.schemaCache,
        outboundConnections,
        this.loadSchemaFromServer.bind(this),
      );
    }

    // Listen to server-capabilities-updated events from async orchestrator
    if (asyncOrchestrator) {
      asyncOrchestrator.on('server-capabilities-updated', async (serverName: string) => {
        debugIf(() => ({ message: `Server ${serverName} capabilities updated, refreshing tool registry` }));
        await this.refreshCapabilities();
      });
    }

    this.setMaxListeners(50);
  }

  /**
   * Initialize the orchestrator
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      debugIf('LazyLoadingOrchestrator already initialized');
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

      logger.info(`LazyLoadingOrchestrator initialized with ${this.toolRegistry.size()} tools`);
    } else {
      logger.info('LazyLoadingOrchestrator initialized in full mode (disabled)');
    }

    this.isInitialized = true;
  }

  /**
   * Build tool registry from aggregated capabilities
   */
  private async buildToolRegistry(): Promise<void> {
    // Build tools map for registry by fetching tools directly from each connection
    const toolsMap = new Map<string, Tool[]>();
    const serverTags = new Map<string, string[]>();

    for (const [serverName, connection] of this.outboundConnections.entries()) {
      if (!connection.client || connection.status !== ClientStatus.Connected) {
        continue;
      }

      try {
        // Get tools directly from this server's client
        const toolsResult = await connection.client.listTools();
        const serverTools = toolsResult.tools || [];

        if (serverTools.length > 0) {
          toolsMap.set(serverName, serverTools);
        }

        // Get tags from transport
        const tags = connection.transport.tags || [];
        serverTags.set(serverName, tags);

        debugIf(() => ({
          message: `Registered ${serverTools.length} tools from ${serverName}`,
          meta: { server: serverName, toolCount: serverTools.length },
        }));
      } catch (error) {
        logger.warn(`Failed to list tools from ${serverName}: ${error}`);
        // Continue with other servers
      }
    }

    this.toolRegistry = ToolRegistry.fromToolsMap(toolsMap, serverTags);
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
        const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
        return regex.test(tool.server);
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
      debugIf('No tools matched preload patterns');
      return;
    }

    debugIf(() => ({ message: `Preloading ${toolsToPreload.length} tools` }));

    // Preload schemas
    await this.schemaCache.preload(toolsToPreload, async (server, toolName) => {
      return this.loadSchemaFromServer(server, toolName);
    });

    logger.info(`Preloaded ${toolsToPreload.length} tool schemas`);
  }

  /**
   * Load tool schema from upstream server
   */
  private async loadSchemaFromServer(server: string, toolName: string): Promise<Tool> {
    const connection = this.outboundConnections.get(server);
    if (!connection || !connection.client) {
      throw new Error(`Server not connected: ${server}`);
    }

    // Get the tool from server's listTools
    const toolsResult = await connection.client.listTools();
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
      debugIf('No tools to preload');
      return;
    }

    debugIf(() => ({ message: `Preloading ${tools.length} specific tools` }));

    // Preload schemas
    await this.schemaCache.preload(tools, async (server, toolName) => {
      return this.loadSchemaFromServer(server, toolName);
    });

    logger.info(`Preloaded ${tools.length} tool schemas`);
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
      tools: metaTools,
      resources: baseCapabilities.resources,
      prompts: baseCapabilities.prompts,
      readyServers: baseCapabilities.readyServers,
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
   */
  public async callMetaTool(name: string, args: unknown): Promise<unknown> {
    if (!this.metaToolProvider) {
      throw new Error('Meta-tool provider not initialized');
    }

    return this.metaToolProvider.callMetaTool(name, args);
  }

  /**
   * Check if a tool call is a meta-tool
   */
  public isMetaTool(name: string): boolean {
    return name === 'tool_list' || name === 'tool_schema' || name === 'tool_invoke';
  }

  /**
   * Get the tool registry
   */
  public getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
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

    // Check cache utilization
    const utilizationRate = (cacheSize / lazyConfig.cache.maxEntries) * 100;
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
    const stats = this.getStatistics();
    const health = this.getHealthStatus();

    const message =
      `LazyLoading stats: ` +
      `enabled=${stats.enabled}, ` +
      `tools=${stats.registeredToolCount}, cached=${stats.cachedToolCount}, ` +
      `tokenSavings=${stats.tokenSavings.savingsPercentage.toFixed(1)}%, ` +
      `cacheHitRate=${stats.cacheHitRate.toFixed(1)}%, ` +
      `coalesced=${health.stats.coalescedRequests}, ` +
      `health=${health.healthy ? 'OK' : 'WARN'}` +
      (health.issues.length > 0 ? ` [${health.issues.join(', ')}]` : '');

    if (forceLog) {
      logger.info(message);
    } else {
      debugIf(message);
    }
  }
}
