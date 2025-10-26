import logger from '@src/logger/logger.js';

import { CacheEntry, CacheOptions } from './types.js';

/**
 * In-memory cache manager with TTL support for MCP Registry responses
 */
export class CacheManager {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private options: CacheOptions;

  constructor(options: Partial<CacheOptions> = {}) {
    this.options = {
      defaultTtl: options.defaultTtl || 300, // 5 minutes default
      maxSize: options.maxSize || 1000,
      cleanupInterval: options.cleanupInterval || 60000, // 1 minute
    };

    this.startCleanupTimer();
  }

  /**
   * Get a cached value by key
   */
  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T | null;
  }

  /**
   * Set a value in the cache with optional TTL
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds || this.options.defaultTtl;
    const now = Date.now();

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + ttl * 1000,
      createdAt: now,
    };

    // Remove oldest entries if cache is full
    if (this.cache.size >= this.options.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
    logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  async invalidate(pattern: string): Promise<void> {
    const regex = new RegExp(pattern);
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));
    logger.debug(`Cache invalidated: ${keysToDelete.length} entries matching "${pattern}"`);
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    const size = this.cache.size;
    this.cache.clear();
    logger.debug(`Cache cleared: ${size} entries removed`);
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
    maxSize: number;
    hitRatio: number;
  } {
    const now = Date.now();
    let expiredCount = 0;
    let validCount = 0;

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      totalEntries: this.cache.size,
      validEntries: validCount,
      expiredEntries: expiredCount,
      maxSize: this.options.maxSize,
      hitRatio: this.getHitRatio(),
    };
  }

  /**
   * Generate a cache key for registry requests
   */
  generateKey(endpoint: string, params: Record<string, unknown> = {}): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}=${String(params[key] ?? '')}`)
      .join('&');

    return `${endpoint}${sortedParams ? `?${sortedParams}` : ''}`;
  }

  /**
   * Start the cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Stop the cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      logger.debug(`Cache cleanup: ${keysToDelete.length} expired entries removed`);
    }
  }

  /**
   * Evict oldest entries when cache is full
   */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);

    const toRemove = Math.ceil(this.options.maxSize * 0.1); // Remove 10% of entries
    for (let i = 0; i < toRemove && entries.length > 0; i++) {
      const [key] = entries[i];
      this.cache.delete(key);
    }

    logger.debug(`Cache eviction: ${toRemove} oldest entries removed`);
  }

  /**
   * Calculate hit ratio (placeholder for future hit/miss tracking)
   */
  private getHitRatio(): number {
    // TODO: Implement hit/miss tracking for more accurate statistics
    return 0;
  }
}
