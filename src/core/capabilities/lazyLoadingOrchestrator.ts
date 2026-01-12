import { EventEmitter } from 'events';

import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { OutboundConnections } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { AggregatedCapabilities, CapabilityAggregator } from './capabilityAggregator.js';
import { MetaToolProvider } from './metaToolProvider.js';
import { SchemaCache, SchemaCacheConfig } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

/**
 * Lazy loading statistics for monitoring
 */
export interface LazyLoadingStats {
  enabled: boolean;
  mode: 'metatool' | 'hybrid' | 'full';
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

  constructor(outboundConnections: OutboundConnections, config: AgentConfigManager) {
    super();
    this.outboundConnections = outboundConnections;
    this.config = config;

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

    // Initialize meta-tool provider if enabled
    if (lazyConfig.enabled && lazyConfig.metaTools.enabled) {
      this.metaToolProvider = new MetaToolProvider(this.toolRegistry, this.schemaCache, outboundConnections);
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

    if (lazyConfig.enabled && lazyConfig.mode !== 'full') {
      // Build tool registry from aggregated capabilities
      await this.buildToolRegistry();

      // Preload tools based on configuration
      if (lazyConfig.preload.patterns.length > 0 || lazyConfig.preload.keywords.length > 0) {
        await this.preloadTools();
      }

      logger.info(
        `LazyLoadingOrchestrator initialized in ${lazyConfig.mode} mode with ${this.toolRegistry.size()} tools`,
      );
    } else {
      logger.info('LazyLoadingOrchestrator initialized in full mode (disabled)');
    }

    this.isInitialized = true;
  }

  /**
   * Build tool registry from aggregated capabilities
   */
  private async buildToolRegistry(): Promise<void> {
    const capabilities = this.capabilityAggregator.getCurrentCapabilities();

    // Build tools map for registry (exclude 1mcp internal tools)
    const toolsMap = new Map<string, Tool[]>();
    const serverTags = new Map<string, string[]>();

    for (const [serverName, connection] of this.outboundConnections.entries()) {
      if (!connection.client) {
        continue;
      }

      // Get tags from transport
      const tags = connection.transport.tags || [];
      serverTags.set(serverName, tags);

      // Get tools from capabilities
      // We need to track which tools belong to which server
      // For now, use all tools except internal 1mcp tools
      const serverTools = capabilities.tools.filter((_tool) => {
        // Check if tool is from this server
        // This is a simplification - in production, we'd track tool-to-server mapping
        return true; // For now, include all external tools
      });

      if (serverTools.length > 0) {
        toolsMap.set(serverName, serverTools);
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
   * Get aggregated capabilities based on lazy loading mode
   */
  public async getCapabilities(): Promise<AggregatedCapabilities> {
    const lazyConfig = this.config.get('lazyLoading');
    const baseCapabilities = this.capabilityAggregator.getCurrentCapabilities();

    if (!lazyConfig.enabled || lazyConfig.mode === 'full') {
      // Full mode: return all capabilities normally
      return baseCapabilities;
    }

    if (lazyConfig.mode === 'metatool') {
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

    // Hybrid mode: meta-tools + direct-exposed tools + resources/prompts
    const metaTools = this.metaToolProvider?.getMetaTools() || [];
    const directTools = this.getDirectExposedTools(lazyConfig.directExpose);

    return {
      tools: [...metaTools, ...directTools],
      resources: baseCapabilities.resources,
      prompts: baseCapabilities.prompts,
      readyServers: baseCapabilities.readyServers,
      timestamp: new Date(),
    };
  }

  /**
   * Get tools that should be directly exposed (not lazy-loaded)
   */
  private getDirectExposedTools(patterns: string[]): Tool[] {
    if (patterns.length === 0) {
      return [];
    }

    const allCapabilities = this.capabilityAggregator.getCurrentCapabilities();
    const directTools: Tool[] = [];

    for (const pattern of patterns) {
      const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);

      for (const tool of allCapabilities.tools) {
        if (regex.test(tool.name)) {
          directTools.push(tool);
        }
      }
    }

    return directTools;
  }

  /**
   * Handle listChanged notifications based on mode
   */
  public shouldNotifyListChanged(): boolean {
    const lazyConfig = this.config.get('lazyLoading');

    switch (lazyConfig.mode) {
      case 'metatool':
        // No listChanged in meta-tool mode (static tool list)
        return false;
      case 'hybrid':
        // Notify only if directly-exposed tools changed
        return this.directToolsChanged();
      case 'full':
      default:
        // Standard MCP behavior
        return true;
    }
  }

  /**
   * Check if directly-exposed tools have changed
   */
  private directToolsChanged(): boolean {
    const lazyConfig = this.config.get('lazyLoading');
    if (lazyConfig.directExpose.length === 0) {
      return false;
    }

    // Compare current direct tools with previous snapshot
    // This is a simplified check - production would track actual changes
    return false;
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
      mode: lazyConfig.mode,
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

    if (!lazyConfig.enabled || lazyConfig.mode === 'full') {
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
    return name === 'mcp_list_available_tools' || name === 'mcp_describe_tool' || name === 'mcp_call_tool';
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
   * Get the current mode
   */
  public getMode(): 'metatool' | 'hybrid' | 'full' {
    return this.config.get('lazyLoading').mode;
  }
}
