import { MCPServerParams } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FilterCache, getFilterCache, resetFilterCache } from './filterCache.js';

describe('FilterCache', () => {
  let cache: FilterCache;
  const sampleTemplates: Array<[string, MCPServerParams]> = [
    ['template1', { command: 'echo', args: ['template1'], tags: ['web', 'production'] }],
    ['template2', { command: 'echo', args: ['template2'], tags: ['database', 'production'] }],
    ['template3', { command: 'echo', args: ['template3'], tags: ['web', 'testing'] }],
  ];

  beforeEach(() => {
    cache = new FilterCache({
      maxSize: 10,
      ttlMs: 1000, // 1 second for testing
      enableStats: true,
    });
  });

  afterEach(() => {
    resetFilterCache();
  });

  describe('getOrParseExpression', () => {
    it('should parse and cache expression', () => {
      const expression = 'web AND production';

      const result1 = cache.getOrParseExpression(expression);
      expect(result1).toBeDefined();
      expect(result1?.type).toBe('and');

      // Second call should hit cache
      const result2 = cache.getOrParseExpression(expression);
      expect(result2).toEqual(result1);

      const stats = cache.getStats();
      expect(stats.expressions.hits).toBe(1);
      expect(stats.expressions.misses).toBe(1);
    });

    it('should handle parse errors gracefully', () => {
      const invalidExpression = 'invalid syntax (((';

      const result = cache.getOrParseExpression(invalidExpression);
      expect(result).toBeNull();

      const stats = cache.getStats();
      expect(stats.expressions.hits).toBe(0);
      // Note: misses might not be incremented for parse errors depending on implementation
    });

    it('should handle empty expression', () => {
      const result = cache.getOrParseExpression('');
      expect(result).toBeNull();
    });
  });

  describe('getCachedResults and setCachedResults', () => {
    it('should cache and retrieve filter results', () => {
      const cacheKey = 'test-key-1';
      const results = [sampleTemplates[0], sampleTemplates[2]]; // web templates

      cache.setCachedResults(cacheKey, results);
      const retrieved = cache.getCachedResults(cacheKey);

      expect(retrieved).toEqual(results);
      expect(retrieved).toHaveLength(2);

      const stats = cache.getStats();
      expect(stats.results.hits).toBe(1);
      expect(stats.results.misses).toBe(0);
    });

    it('should return null for non-existent cache key', () => {
      const result = cache.getCachedResults('non-existent-key');
      expect(result).toBeNull();

      const stats = cache.getStats();
      expect(stats.results.hits).toBe(0);
      expect(stats.results.misses).toBe(1);
    });

    it('should handle empty results', () => {
      const cacheKey = 'test-key-empty';
      const results: Array<[string, MCPServerParams]> = [];

      cache.setCachedResults(cacheKey, results);
      const retrieved = cache.getCachedResults(cacheKey);

      expect(retrieved).toEqual([]);
      expect(retrieved).toHaveLength(0);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate consistent cache keys', () => {
      const key1 = cache.generateCacheKey(sampleTemplates, {
        tags: ['web'],
        mode: 'simple-or',
      });

      const key2 = cache.generateCacheKey(sampleTemplates, {
        tags: ['web'],
        mode: 'simple-or',
      });

      expect(key1).toBe(key2);

      // Different options should generate different keys
      const key3 = cache.generateCacheKey(sampleTemplates, {
        tags: ['database'],
        mode: 'simple-or',
      });

      expect(key1).not.toBe(key3);
    });

    it('should handle template order differences', () => {
      const orderedTemplates = [...sampleTemplates];
      const shuffledTemplates = [sampleTemplates[2], sampleTemplates[0], sampleTemplates[1]];

      const key1 = cache.generateCacheKey(orderedTemplates, { tags: ['web'] });
      const key2 = cache.generateCacheKey(shuffledTemplates, { tags: ['web'] });

      expect(key1).toBe(key2);
    });

    it('should handle tag order differences', () => {
      const key1 = cache.generateCacheKey(sampleTemplates, {
        tags: ['web', 'production'],
      });

      const key2 = cache.generateCacheKey(sampleTemplates, {
        tags: ['production', 'web'],
      });

      expect(key1).toBe(key2);
    });
  });

  describe('TTL and expiration', () => {
    it('should expire entries after TTL', async () => {
      const cacheKey = 'test-ttl-key';
      const results = [sampleTemplates[0]];

      cache.setCachedResults(cacheKey, results);

      // Should be available immediately
      expect(cache.getCachedResults(cacheKey)).toEqual(results);

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should be expired now
      const expiredResult = cache.getCachedResults(cacheKey);
      expect(expiredResult).toBeNull();
    });

    it('should clear expired entries', async () => {
      // Set some entries
      cache.setCachedResults('key1', [sampleTemplates[0]]);
      cache.setCachedResults('key2', [sampleTemplates[1]]);
      cache.getOrParseExpression('web AND production');

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Clear expired entries
      cache.clearExpired();

      const stats = cache.getStats();
      expect(stats.expressions.size).toBe(0);
      expect(stats.results.size).toBe(0);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when at capacity', () => {
      const smallCache = new FilterCache({ maxSize: 2, ttlMs: 5000 });

      // Fill cache to capacity
      smallCache.setCachedResults('key1', [sampleTemplates[0]]);
      smallCache.setCachedResults('key2', [sampleTemplates[1]]);

      expect(smallCache.getStats().results.size).toBe(2);

      // Add one more (should evict key1)
      smallCache.setCachedResults('key3', [sampleTemplates[2]]);

      expect(smallCache.getStats().results.size).toBe(2);
      expect(smallCache.getStats().evictions).toBe(1);

      // key1 should be evicted, key2 and key3 should remain
      expect(smallCache.getCachedResults('key1')).toBeNull();
      expect(smallCache.getCachedResults('key2')).toEqual([sampleTemplates[1]]);
      expect(smallCache.getCachedResults('key3')).toEqual([sampleTemplates[2]]);
    });

    it('should update LRU order on access', () => {
      const smallCache = new FilterCache({ maxSize: 2, ttlMs: 5000 });

      // Fill cache
      smallCache.setCachedResults('key1', [sampleTemplates[0]]);
      smallCache.setCachedResults('key2', [sampleTemplates[1]]);

      // Access key1 to make it most recently used
      smallCache.getCachedResults('key1');

      // Add key3 (should evict key2, not key1)
      smallCache.setCachedResults('key3', [sampleTemplates[2]]);

      expect(smallCache.getCachedResults('key1')).toEqual([sampleTemplates[0]]);
      expect(smallCache.getCachedResults('key2')).toBeNull();
      expect(smallCache.getCachedResults('key3')).toEqual([sampleTemplates[2]]);
    });
  });

  describe('Statistics', () => {
    it('should track statistics accurately', () => {
      // Exercise cache operations
      cache.getOrParseExpression('web AND production');
      cache.getOrParseExpression('web AND production'); // Hit
      cache.getOrParseExpression('database OR testing'); // Miss

      const cacheKey = cache.generateCacheKey(sampleTemplates, { tags: ['web'] });
      cache.setCachedResults(cacheKey, [sampleTemplates[0]]);
      cache.getCachedResults(cacheKey); // Hit
      cache.getCachedResults('non-existent'); // Miss

      const stats = cache.getStats();

      expect(stats.expressions.hits).toBe(1);
      expect(stats.expressions.misses).toBe(2);
      expect(stats.expressions.size).toBe(2);

      expect(stats.results.hits).toBe(1);
      expect(stats.results.misses).toBe(1);
      expect(stats.results.size).toBe(1);

      expect(stats.totalRequests).toBe(5);
    });
  });

  describe('warmup', () => {
    it('should warm up cache with expressions', () => {
      const expressions = ['web AND production', 'database OR testing', 'cache AND redis'];

      cache.warmup(expressions);

      expect(cache.getStats().expressions.size).toBe(3);

      // Should get hits for warmed expressions
      cache.getOrParseExpression('web AND production');
      cache.getOrParseExpression('database OR testing');
      cache.getOrParseExpression('cache AND redis');

      const stats = cache.getStats();
      expect(stats.expressions.hits).toBe(3);
      // Warmup might count as misses depending on implementation
    });
  });

  describe('clear', () => {
    it('should clear all cache entries and reset stats', () => {
      // Add some data
      cache.getOrParseExpression('web AND production');
      cache.setCachedResults('key1', [sampleTemplates[0]]);

      const statsBefore = cache.getStats();
      expect(statsBefore.expressions.size).toBeGreaterThan(0);
      expect(statsBefore.results.size).toBeGreaterThan(0);

      cache.clear();

      const stats = cache.getStats();
      expect(stats.expressions.size).toBe(0);
      expect(stats.results.size).toBe(0);
      expect(stats.expressions.hits).toBe(0);
      expect(stats.expressions.misses).toBe(0);
      expect(stats.results.hits).toBe(0);
      expect(stats.results.misses).toBe(0);
      expect(stats.evictions).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('getDetailedInfo', () => {
    it('should provide detailed debugging information', () => {
      cache.getOrParseExpression('web AND production');
      cache.setCachedResults('key1', [sampleTemplates[0]]);

      // Access to update access counts
      cache.getOrParseExpression('web AND production');
      cache.getCachedResults('key1');

      const info = cache.getDetailedInfo();

      expect(info.config.maxSize).toBe(10);
      expect(info.config.ttlMs).toBe(1000);
      expect(info.config.enableStats).toBe(true);

      expect(info.expressions).toHaveLength(1);
      expect(info.expressions[0].expression).toBe('web AND production');
      expect(info.expressions[0].accessCount).toBe(2);

      expect(info.results).toHaveLength(1);
      expect(info.results[0].cacheKey).toBe('key1');
      expect(info.results[0].resultCount).toBe(1);
      expect(info.results[0].accessCount).toBe(2);
    });
  });
});

describe('Global Filter Cache', () => {
  afterEach(() => {
    resetFilterCache();
  });

  it('should provide singleton instance', () => {
    const cache1 = getFilterCache();
    const cache2 = getFilterCache();

    expect(cache1).toBe(cache2);
  });

  it('should reset global cache', () => {
    const cache1 = getFilterCache();
    cache1.getOrParseExpression('test expression');

    resetFilterCache();
    const cache2 = getFilterCache();

    expect(cache1).not.toBe(cache2);
    expect(cache2.getStats().expressions.size).toBe(0);
  });
});
