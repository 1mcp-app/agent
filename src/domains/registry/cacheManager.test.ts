import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CacheManager } from './cacheManager.js';

describe('CacheManager', () => {
  let cache: CacheManager;

  beforeEach(() => {
    // Use fast intervals for testing
    cache = new CacheManager({
      defaultTtl: 1, // 1 second
      maxSize: 3,
      cleanupInterval: 100, // 100ms
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('basic operations', () => {
    it('should store and retrieve values', async () => {
      await cache.set('key1', 'value1');
      const result = await cache.get<string>('key1');
      expect(result).toBe('value1');
    });

    it('should return null for non-existent keys', async () => {
      const result = await cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should handle different data types', async () => {
      const obj = { foo: 'bar', num: 42 };
      await cache.set('object', obj);
      const result = await cache.get<typeof obj>('object');
      expect(result).toEqual(obj);
    });
  });

  describe('TTL functionality', () => {
    it('should expire entries after TTL', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value1', 0.1); // 100ms TTL

      // Should be available immediately
      expect(await cache.get('key1')).toBe('value1');

      // Wait for expiration
      vi.advanceTimersByTime(150);

      // Should be expired
      expect(await cache.get('key1')).toBeNull();

      vi.useRealTimers();
    });

    it('should use default TTL when not specified', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value1');

      // Should be available immediately
      expect(await cache.get('key1')).toBe('value1');

      // Wait for default TTL (1 second)
      vi.advanceTimersByTime(1100);

      // Should be expired
      expect(await cache.get('key1')).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('size management', () => {
    it('should evict oldest entries when max size is reached', async () => {
      // Fill cache to max size
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');

      // All should be present
      expect(await cache.get('key1')).toBe('value1');
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');

      // Adding one more should evict oldest
      await cache.set('key4', 'value4');

      // key1 should be evicted (oldest)
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBe('value2');
      expect(await cache.get('key3')).toBe('value3');
      expect(await cache.get('key4')).toBe('value4');
    });
  });

  describe('invalidation', () => {
    beforeEach(async () => {
      await cache.set('user:1', { id: 1, name: 'John' });
      await cache.set('user:2', { id: 2, name: 'Jane' });
      await cache.set('post:1', { id: 1, title: 'Test Post' });
    });

    it('should invalidate entries matching pattern', async () => {
      await cache.invalidate('user:.*');

      // User entries should be gone
      expect(await cache.get('user:1')).toBeNull();
      expect(await cache.get('user:2')).toBeNull();

      // Post entry should remain
      expect(await cache.get('post:1')).not.toBeNull();
    });

    it('should clear all entries', async () => {
      await cache.clear();

      expect(await cache.get('user:1')).toBeNull();
      expect(await cache.get('user:2')).toBeNull();
      expect(await cache.get('post:1')).toBeNull();
    });
  });

  describe('key generation', () => {
    it('should generate consistent keys for same input', () => {
      const key1 = cache.generateKey('/servers', { limit: 10, offset: 0 });
      const key2 = cache.generateKey('/servers', { limit: 10, offset: 0 });
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different parameters', () => {
      const key1 = cache.generateKey('/servers', { limit: 10 });
      const key2 = cache.generateKey('/servers', { limit: 20 });
      expect(key1).not.toBe(key2);
    });

    it('should sort parameters for consistent keys', () => {
      const key1 = cache.generateKey('/servers', { limit: 10, offset: 0 });
      const key2 = cache.generateKey('/servers', { offset: 0, limit: 10 });
      expect(key1).toBe(key2);
    });

    it('should handle empty parameters', () => {
      const key = cache.generateKey('/servers');
      expect(key).toBe('/servers');
    });
  });

  describe('statistics', () => {
    it('should provide cache statistics', async () => {
      vi.useFakeTimers();

      // Create a cache without cleanup for this test
      const testCache = new CacheManager({
        defaultTtl: 1,
        maxSize: 3,
        cleanupInterval: 60000, // Long interval to prevent cleanup during test
      });

      try {
        await testCache.set('key1', 'value1');
        await testCache.set('key2', 'value2', 0.1); // Short TTL

        const stats = testCache.getStats();
        expect(stats.totalEntries).toBe(2);
        expect(stats.maxSize).toBe(3);

        // Wait for one to expire (but not be cleaned up)
        vi.advanceTimersByTime(150);

        const updatedStats = testCache.getStats();
        expect(updatedStats.validEntries).toBe(1);
        expect(updatedStats.expiredEntries).toBe(1);
      } finally {
        testCache.destroy();
      }

      vi.useRealTimers();
    });
  });

  describe('cleanup', () => {
    it('should automatically clean up expired entries', async () => {
      vi.useFakeTimers();

      await cache.set('key1', 'value1', 0.1); // 100ms TTL
      await cache.set('key2', 'value2', 10); // Long TTL

      // Wait for cleanup cycle and expiration
      vi.advanceTimersByTime(250);

      // Expired entry should be cleaned up
      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).toBe('value2');

      const stats = cache.getStats();
      expect(stats.totalEntries).toBe(1);

      vi.useRealTimers();
    });
  });
});
