import { MCPServerParams } from '@src/core/types/index.js';
import { TagExpression, TagQueryParser } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Cache entry with TTL support
 */
interface CacheEntry<T> {
  value: T;
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxSize: number;
  ttlMs: number;
  enableStats: boolean;
}

/**
 * Filter cache statistics
 */
export interface CacheStats {
  expressions: {
    hits: number;
    misses: number;
    size: number;
  };
  results: {
    hits: number;
    misses: number;
    size: number;
  };
  evictions: number;
  totalRequests: number;
}

/**
 * Multi-level cache for template filtering
 * - Level 1: Parsed expressions (avoid reparsing)
 * - Level 2: Filter results (avoid recomputation)
 */
export class FilterCache {
  private expressionCache = new Map<string, CacheEntry<TagExpression>>();
  private resultCache = new Map<string, CacheEntry<Array<[string, MCPServerParams]>>>();
  private config: CacheConfig;
  private stats: CacheStats;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 1000,
      ttlMs: 5 * 60 * 1000, // 5 minutes
      enableStats: true,
      ...config,
    };

    this.stats = {
      expressions: { hits: 0, misses: 0, size: 0 },
      results: { hits: 0, misses: 0, size: 0 },
      evictions: 0,
      totalRequests: 0,
    };
  }

  /**
   * Get or create a parsed tag expression
   */
  public getOrParseExpression(expression: string): TagExpression | null {
    this.stats.totalRequests++;

    // Check cache first
    const cached = this.expressionCache.get(expression);
    if (cached && this.isValid(cached)) {
      cached.lastAccessed = new Date();
      cached.accessCount++;
      this.stats.expressions.hits++;

      debugIf(() => ({
        message: `FilterCache.getOrParseExpression: Cache hit for expression: ${expression}`,
        meta: {
          expression,
          accessCount: cached.accessCount,
        },
      }));

      return cached.value;
    }

    // Parse and cache
    try {
      const parsed = TagQueryParser.parseAdvanced(expression);
      this.setExpression(expression, parsed);
      this.stats.expressions.misses++;

      debugIf(() => ({
        message: `FilterCache.getOrParseExpression: Parsed and cached expression: ${expression}`,
        meta: { expression },
      }));

      return parsed;
    } catch (error) {
      logger.warn(`FilterCache.getOrParseExpression: Failed to parse expression: ${expression}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        expression,
      });
      return null;
    }
  }

  /**
   * Get cached filter results
   */
  public getCachedResults(cacheKey: string): Array<[string, MCPServerParams]> | null {
    this.stats.totalRequests++;

    const cached = this.resultCache.get(cacheKey);
    if (cached && this.isValid(cached)) {
      cached.lastAccessed = new Date();
      cached.accessCount++;
      this.stats.results.hits++;

      debugIf(() => ({
        message: `FilterCache.getCachedResults: Cache hit for key: ${cacheKey}`,
        meta: {
          cacheKey,
          resultCount: cached.value.length,
          accessCount: cached.accessCount,
        },
      }));

      return cached.value;
    }

    this.stats.results.misses++;
    return null;
  }

  /**
   * Cache filter results
   */
  public setCachedResults(cacheKey: string, results: Array<[string, MCPServerParams]>): void {
    const entry: CacheEntry<Array<[string, MCPServerParams]>> = {
      value: results,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 1,
    };

    this.resultCache.set(cacheKey, entry);

    // Ensure capacity after adding the new entry
    this.ensureCapacity();

    this.stats.results.size = this.resultCache.size;

    debugIf(() => ({
      message: `FilterCache.setCachedResults: Cached results for key: ${cacheKey}`,
      meta: {
        cacheKey,
        resultCount: results.length,
        cacheSize: this.resultCache.size,
      },
    }));
  }

  /**
   * Generate cache key for filter results
   */
  public generateCacheKey(
    templates: Array<[string, MCPServerParams]>,
    filterOptions: {
      presetName?: string;
      tags?: string[];
      tagExpression?: string;
      tagQuery?: TagQuery;
      mode?: string;
    },
  ): string {
    // Create a deterministic key based on template hashes and filter options
    const templateHashes = templates
      .map(([name, config]) => {
        // Simple hash based on template name and tags
        const tags = (config.tags || []).sort().join(',');
        return `${name}:${tags}`;
      })
      .sort()
      .join('|');

    const filterHash = JSON.stringify({
      presetName: filterOptions.presetName,
      tags: filterOptions.tags?.sort(),
      tagExpression: filterOptions.tagExpression,
      // Note: tagQuery is complex, so we use expression if available
      mode: filterOptions.mode,
    });

    // Create a simple hash (in production, might use crypto)
    return `${this.simpleHash(templateHashes)}_${this.simpleHash(filterHash)}`;
  }

  /**
   * Check if a cache entry is still valid (not expired)
   */
  private isValid<T>(entry: CacheEntry<T>): boolean {
    const now = new Date();
    const age = now.getTime() - entry.createdAt.getTime();
    return age <= this.config.ttlMs;
  }

  /**
   * Ensure cache doesn't exceed max size (LRU eviction)
   */
  private ensureCapacity(): void {
    while (this.resultCache.size > this.config.maxSize) {
      // Find least recently used entry
      let lruKey: string | null = null;
      let lruTime: Date | null = null; // Initialize to null
      let lruAccessCount = Infinity;

      // Find the entry with the earliest lastAccessed time
      // If multiple entries have the same time, choose the one with lower access count
      for (const [key, entry] of this.resultCache) {
        const isLessRecent = lruTime === null || entry.lastAccessed < lruTime;
        const isSameTime = lruTime !== null && entry.lastAccessed.getTime() === lruTime.getTime();
        const isLessUsed = isSameTime && entry.accessCount < lruAccessCount;

        if (isLessRecent || (isSameTime && isLessUsed)) {
          lruTime = entry.lastAccessed;
          lruKey = key;
          lruAccessCount = entry.accessCount;
        }
      }

      if (lruKey) {
        this.resultCache.delete(lruKey);
        this.stats.evictions++;
      } else {
        // No entry found to evict, break to avoid infinite loop
        break;
      }
    }
  }

  /**
   * Set parsed expression in cache
   */
  private setExpression(expression: string, parsed: TagExpression): void {
    const entry: CacheEntry<TagExpression> = {
      value: parsed,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 1,
    };

    this.expressionCache.set(expression, entry);

    // Ensure capacity for expression cache too
    this.ensureExpressionCapacity();

    this.stats.expressions.size = this.expressionCache.size;
  }

  /**
   * Ensure expression cache doesn't exceed max size (LRU eviction)
   */
  private ensureExpressionCapacity(): void {
    while (this.expressionCache.size > this.config.maxSize) {
      // Find least recently used entry
      let lruKey: string | null = null;
      let lruTime: Date | null = null;
      let lruAccessCount = Infinity;

      for (const [key, entry] of this.expressionCache) {
        const isLessRecent = lruTime === null || entry.lastAccessed < lruTime;
        const isSameTime = lruTime !== null && entry.lastAccessed.getTime() === lruTime.getTime();
        const isLessUsed = isSameTime && entry.accessCount < lruAccessCount;

        if (isLessRecent || (isSameTime && isLessUsed)) {
          lruTime = entry.lastAccessed;
          lruKey = key;
          lruAccessCount = entry.accessCount;
        }
      }

      if (lruKey) {
        this.expressionCache.delete(lruKey);
        this.stats.evictions++;
      } else {
        // No entry found to evict, break to avoid infinite loop
        break;
      }
    }
  }

  /**
   * Simple hash function for cache key generation
   * In production, might use crypto.createHash()
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clear expired entries
   */
  public clearExpired(): void {
    const now = new Date();
    let expiredCount = 0;

    // Clear expired expressions
    for (const [key, entry] of this.expressionCache) {
      const age = now.getTime() - entry.createdAt.getTime();
      if (age > this.config.ttlMs) {
        this.expressionCache.delete(key);
        expiredCount++;
      }
    }

    // Clear expired results
    for (const [key, entry] of this.resultCache) {
      const age = now.getTime() - entry.createdAt.getTime();
      if (age > this.config.ttlMs) {
        this.resultCache.delete(key);
        expiredCount++;
      }
    }

    this.stats.expressions.size = this.expressionCache.size;
    this.stats.results.size = this.resultCache.size;

    if (expiredCount > 0) {
      debugIf(() => ({
        message: `FilterCache.clearExpired: Cleared ${expiredCount} expired entries`,
        meta: {
          expiredCount,
          expressionCacheSize: this.expressionCache.size,
          resultCacheSize: this.resultCache.size,
        },
      }));
    }
  }

  /**
   * Get cache statistics
   */
  public getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get detailed cache information for debugging
   */
  public getDetailedInfo(): {
    config: CacheConfig;
    expressions: Array<{
      expression: string;
      accessCount: number;
      age: number;
      lastAccessed: Date;
    }>;
    results: Array<{
      cacheKey: string;
      resultCount: number;
      accessCount: number;
      age: number;
      lastAccessed: Date;
    }>;
  } {
    const now = new Date();

    const expressions = Array.from(this.expressionCache.entries()).map(([expression, entry]) => ({
      expression,
      accessCount: entry.accessCount,
      age: now.getTime() - entry.createdAt.getTime(),
      lastAccessed: entry.lastAccessed,
    }));

    const results = Array.from(this.resultCache.entries()).map(([cacheKey, entry]) => ({
      cacheKey,
      resultCount: entry.value.length,
      accessCount: entry.accessCount,
      age: now.getTime() - entry.createdAt.getTime(),
      lastAccessed: entry.lastAccessed,
    }));

    return {
      config: this.config,
      expressions,
      results,
    };
  }

  /**
   * Clear all cache entries
   */
  public clear(): void {
    this.expressionCache.clear();
    this.resultCache.clear();
    this.stats = {
      expressions: { hits: 0, misses: 0, size: 0 },
      results: { hits: 0, misses: 0, size: 0 },
      evictions: 0,
      totalRequests: 0,
    };

    debugIf('FilterCache.clear: Cleared all cache entries');
  }

  /**
   * Warm up cache with common expressions
   */
  public warmup(expressions: string[]): void {
    debugIf(() => ({
      message: `FilterCache.warmup: Warming up cache with ${expressions.length} expressions`,
      meta: { expressionCount: expressions.length },
    }));

    for (const expression of expressions) {
      this.getOrParseExpression(expression);
    }

    debugIf(`FilterCache.warmup: Warmup completed, ${this.expressionCache.size} expressions cached`);
  }
}

/**
 * Global filter cache instance (singleton pattern)
 */
let globalFilterCache: FilterCache | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function getFilterCache(): FilterCache {
  if (!globalFilterCache) {
    globalFilterCache = new FilterCache({
      maxSize: 1000,
      ttlMs: 5 * 60 * 1000, // 5 minutes
      enableStats: true,
    });

    // Set up periodic cleanup with proper cleanup tracking
    cleanupInterval = setInterval(() => {
      globalFilterCache?.clearExpired();
    }, 60 * 1000); // Every minute

    // Ensure cleanup on process exit
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => {
        if (cleanupInterval) {
          clearInterval(cleanupInterval);
          cleanupInterval = null;
        }
      });
    }
  }
  return globalFilterCache;
}

export function resetFilterCache(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  globalFilterCache = null;
}
