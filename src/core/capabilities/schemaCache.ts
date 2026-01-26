import { Tool } from '@modelcontextprotocol/sdk/types.js';

import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Statistics for schema cache operations
 */
export interface SchemaCacheStats {
  hits: number;
  misses: number;
  coalesced: number;
  evictions: number;
  get hitRate(): number;
}

/**
 * Configuration for SchemaCache
 */
export interface SchemaCacheConfig {
  maxEntries: number;
  ttlMs?: number;
}

/**
 * Cache entry with optional expiration
 */
interface CacheEntry {
  tool: Tool;
  timestamp: number;
}

/**
 * SchemaCache provides LRU caching for tool schemas with optional TTL and request coalescing.
 *
 * This cache reduces redundant upstream server calls by storing loaded tool schemas
 * and coalescing parallel requests for the same tool.
 *
 * @example
 * ```typescript
 * const cache = new SchemaCache({ maxEntries: 1000, ttlMs: 3600000 });
 *
 * // Load tool schema (with coalescing for parallel calls)
 * const tool = await cache.getOrLoad('filesystem', 'read_file', async () => {
 *   return await fetchSchemaFromServer('filesystem', 'read_file');
 * });
 * ```
 */
export class SchemaCache {
  private cache: Map<string, CacheEntry> = new Map();
  private inflightRequests: Map<string, Promise<Tool>> = new Map();
  private config: SchemaCacheConfig;
  private stats: SchemaCacheStats = {
    hits: 0,
    misses: 0,
    coalesced: 0,
    evictions: 0,
    get hitRate() {
      const total = this.hits + this.misses;
      return total > 0 ? (this.hits / total) * 100 : 0;
    },
  };

  constructor(config: SchemaCacheConfig) {
    this.config = config;
  }

  /**
   * Generate cache key from server and tool name
   */
  private getCacheKey(server: string, toolName: string): string {
    return `${server}:${toolName}`;
  }

  /**
   * Check if a cache entry has expired (TTL)
   */
  private isExpired(entry: CacheEntry): boolean {
    if (!this.config.ttlMs) {
      return false;
    }
    const now = Date.now();
    const age = now - entry.timestamp;
    return age > this.config.ttlMs;
  }

  /**
   * Evict oldest entry when cache is full (FIFO eviction by insertion time)
   * Note: This is not true LRU - for that we'd need to track access order
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
      debugIf(() => ({ message: `Evicted oldest cache entry: ${oldestKey}` }));
    }
  }

  /**
   * Get tool schema from cache or load it using the provided loader function
   * Implements request coalescing for parallel requests to the same tool
   *
   * @param server - Server name
   * @param toolName - Tool name
   * @param loader - Async function to load the tool schema from upstream server
   * @returns Promise resolving to the Tool schema
   */
  public async getOrLoad(
    server: string,
    toolName: string,
    loader: (server: string, toolName: string) => Promise<Tool>,
  ): Promise<Tool> {
    const cacheKey = this.getCacheKey(server, toolName);

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && !this.isExpired(cached)) {
      this.stats.hits++;
      debugIf(() => ({ message: `Cache hit: ${cacheKey}` }));
      return cached.tool;
    }

    // Remove expired entry if exists
    if (cached && this.isExpired(cached)) {
      this.cache.delete(cacheKey);
      debugIf(() => ({ message: `Cache entry expired: ${cacheKey}` }));
    }

    // Check for in-flight request (coalescing)
    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) {
      this.stats.coalesced++;
      debugIf(() => ({ message: `Coalesced request for: ${cacheKey}` }));
      return inflight;
    }

    // Create new request
    this.stats.misses++;
    const promise = loader(server, toolName)
      .then((tool) => {
        // Store in cache
        if (this.cache.size >= this.config.maxEntries) {
          this.evictOldest();
        }

        this.cache.set(cacheKey, {
          tool,
          timestamp: Date.now(),
        });

        debugIf(() => ({ message: `Loaded and cached: ${cacheKey}` }));
        return tool;
      })
      .finally(() => {
        // Clean up in-flight map
        this.inflightRequests.delete(cacheKey);
      });

    this.inflightRequests.set(cacheKey, promise);
    return promise;
  }

  /**
   * Check if a tool schema is currently cached (and not expired)
   */
  public has(server: string, toolName: string): boolean {
    const cacheKey = this.getCacheKey(server, toolName);
    const cached = this.cache.get(cacheKey);
    return cached !== undefined && !this.isExpired(cached);
  }

  /**
   * Get cached tool schema without loading (returns null if not cached)
   */
  public getIfCached(server: string, toolName: string): Tool | null {
    const cacheKey = this.getCacheKey(server, toolName);
    const cached = this.cache.get(cacheKey);

    if (!cached) {
      return null;
    }

    if (this.isExpired(cached)) {
      this.cache.delete(cacheKey);
      return null;
    }

    return cached.tool;
  }

  /**
   * Manually add a tool schema to the cache
   */
  public set(server: string, toolName: string, tool: Tool): void {
    const cacheKey = this.getCacheKey(server, toolName);

    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(cacheKey, {
      tool,
      timestamp: Date.now(),
    });

    debugIf(() => ({ message: `Manually cached: ${cacheKey}` }));
  }

  /**
   * Remove a tool schema from the cache
   */
  public delete(server: string, toolName: string): boolean {
    const cacheKey = this.getCacheKey(server, toolName);
    return this.cache.delete(cacheKey);
  }

  /**
   * Clear all cached schemas
   */
  public clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.inflightRequests.clear();
    logger.info(`Cleared ${size} tool schemas from cache`);
  }

  /**
   * Get current cache statistics
   */
  public getStats(): Readonly<SchemaCacheStats> {
    return { ...this.stats };
  }

  /**
   * Get current cache size
   */
  public size(): number {
    return this.cache.size;
  }

  /**
   * Get all cached tool identifiers
   */
  public getCachedTools(): Array<{ server: string; toolName: string }> {
    const now = Date.now();
    const tools: Array<{ server: string; toolName: string }> = [];

    for (const [cacheKey, entry] of this.cache.entries()) {
      // Skip expired entries
      if (this.config.ttlMs && now - entry.timestamp > this.config.ttlMs) {
        continue;
      }

      const [server, toolName] = cacheKey.split(':');
      tools.push({ server, toolName });
    }

    return tools;
  }

  /**
   * Reset statistics counters
   */
  public resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.coalesced = 0;
    this.stats.evictions = 0;
  }

  /**
   * Log current cache statistics (for monitoring and observability)
   * @param forceLog - Force logging even if debug mode is off
   */
  public logStats(forceLog = false): void {
    const stats = this.getStats();
    const message = `SchemaCache stats: size=${this.cache.size}/${this.config.maxEntries}, hits=${stats.hits}, misses=${stats.misses}, hitRate=${stats.hitRate.toFixed(1)}%, coalesced=${stats.coalesced}, evictions=${stats.evictions}`;

    if (forceLog) {
      logger.info(message);
    } else {
      debugIf(message);
    }
  }

  /**
   * Preload tool schemas in batch
   * @returns Object with loaded count and array of failures
   */
  public async preload(
    tools: Array<{ server: string; toolName: string }>,
    loader: (server: string, toolName: string) => Promise<Tool>,
  ): Promise<{ loaded: number; failed: Array<{ server: string; toolName: string; error: string }> }> {
    debugIf(() => ({ message: `Preloading ${tools.length} tool schemas` }));

    const failed: Array<{ server: string; toolName: string; error: string }> = [];

    // Load in parallel for efficiency
    await Promise.all(
      tools.map(({ server, toolName }) =>
        this.getOrLoad(server, toolName, loader).catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`Failed to preload tool schema ${server}:${toolName}: ${errorMessage}`);
          failed.push({ server, toolName, error: errorMessage });
        }),
      ),
    );

    const loaded = tools.length - failed.length;

    if (failed.length > 0) {
      logger.warn(`Preload completed with ${failed.length} failures out of ${tools.length} tools`, { failed });
    }

    logger.info(`Preloaded ${loaded} tool schemas, cache size: ${this.cache.size}`);

    return { loaded, failed };
  }
}
