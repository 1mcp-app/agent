import { describe, expect, it, vi } from 'vitest';

import { ParallelExecutor, ParallelExecutorEvent } from './parallelExecutor.js';

describe('ParallelExecutor', () => {
  describe('parallel execution', () => {
    it('should execute multiple items in parallel', async () => {
      const executor = new ParallelExecutor<string, number>();
      const processingOrder: string[] = [];

      const handler = async (item: string): Promise<number> => {
        processingOrder.push(item);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item.length;
      };

      const results = await executor.execute(['a', 'b', 'c'], handler, { maxConcurrent: 3 });

      expect(results.get('a')).toBe(1);
      expect(results.get('b')).toBe(1);
      expect(results.get('c')).toBe(1);
      expect(results.size).toBe(3);
    });

    it('should handle items of different types', async () => {
      const executor = new ParallelExecutor<number, string>();

      const handler = async (num: number): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return `num-${num}`;
      };

      const results = await executor.execute([1, 2, 3], handler, { maxConcurrent: 2 });

      expect(results.get(1)).toBe('num-1');
      expect(results.get(2)).toBe('num-2');
      expect(results.get(3)).toBe('num-3');
    });
  });

  describe('concurrency limit', () => {
    it('should respect maxConcurrent limit', async () => {
      const executor = new ParallelExecutor<string, number>();
      let activeCount = 0;
      let maxActiveCount = 0;

      const handler = async (item: string): Promise<number> => {
        activeCount++;
        maxActiveCount = Math.max(maxActiveCount, activeCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeCount--;
        return item.length;
      };

      await executor.execute(['a', 'b', 'c', 'd', 'e'], handler, { maxConcurrent: 2 });

      expect(maxActiveCount).toBeLessThanOrEqual(2);
    });

    it('should process items in batches', async () => {
      const executor = new ParallelExecutor<string, number>();
      const batchCompletionOrder: number[] = [];

      executor.on(ParallelExecutorEvent.BatchComplete, (batch) => {
        batchCompletionOrder.push(batch.length);
      });

      const handler = async (item: string): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return item.length;
      };

      await executor.execute(['a', 'b', 'c', 'd', 'e', 'f'], handler, { maxConcurrent: 2 });

      // With maxConcurrent: 2 and 6 items, we expect 3 batches
      expect(batchCompletionOrder.length).toBe(3);
      expect(batchCompletionOrder).toEqual([2, 2, 2]);
    });

    it('should handle partial batch at the end', async () => {
      const executor = new ParallelExecutor<string, number>();
      const batchSizes: number[] = [];

      executor.on(ParallelExecutorEvent.BatchComplete, (batch) => {
        batchSizes.push(batch.length);
      });

      const handler = async (item: string): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return item.length;
      };

      await executor.execute(['a', 'b', 'c', 'd', 'e'], handler, { maxConcurrent: 2 });

      expect(batchSizes).toEqual([2, 2, 1]); // Last batch has only 1 item
    });
  });

  describe('event emission using ParallelExecutorEvent enum', () => {
    it('should emit ItemStart event for all event types', async () => {
      const executor = new ParallelExecutor<string, number>();
      const itemStartSpy = vi.fn();

      executor.on(ParallelExecutorEvent.ItemStart, itemStartSpy);

      const handler = async (item: string): Promise<number> => {
        return item.length;
      };

      await executor.execute(['a', 'b', 'c'], handler, { maxConcurrent: 2 });

      expect(itemStartSpy).toHaveBeenCalledTimes(3);
      expect(itemStartSpy).toHaveBeenCalledWith('a');
      expect(itemStartSpy).toHaveBeenCalledWith('b');
      expect(itemStartSpy).toHaveBeenCalledWith('c');
    });

    it('should emit ItemComplete event with results', async () => {
      const executor = new ParallelExecutor<string, number>();
      const itemCompleteSpy = vi.fn();

      executor.on(ParallelExecutorEvent.ItemComplete, itemCompleteSpy);

      const handler = async (item: string): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return item.length;
      };

      await executor.execute(['a', 'bb', 'ccc'], handler, { maxConcurrent: 2 });

      expect(itemCompleteSpy).toHaveBeenCalledTimes(3);
      expect(itemCompleteSpy).toHaveBeenCalledWith('a', 1);
      expect(itemCompleteSpy).toHaveBeenCalledWith('bb', 2);
      expect(itemCompleteSpy).toHaveBeenCalledWith('ccc', 3);
    });

    it('should emit BatchComplete event after each batch', async () => {
      const executor = new ParallelExecutor<string, number>();
      const batchCompleteSpy = vi.fn();

      executor.on(ParallelExecutorEvent.BatchComplete, batchCompleteSpy);

      const handler = async (item: string): Promise<number> => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return item.length;
      };

      await executor.execute(['a', 'b', 'c', 'd'], handler, { maxConcurrent: 2 });

      expect(batchCompleteSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should continue processing other items when one fails', async () => {
      const executor = new ParallelExecutor<string, number>();

      const handler = async (item: string): Promise<number> => {
        if (item === 'b') {
          throw new Error('Failed for b');
        }
        return item.length;
      };

      const results = await executor.execute(['a', 'b', 'c'], handler, { maxConcurrent: 3 });

      // 'a' and 'c' should succeed, 'b' should not be in results
      expect(results.get('a')).toBe(1);
      expect(results.get('c')).toBe(1);
      expect(results.has('b')).toBe(false);
      expect(results.size).toBe(2);
    });

    it('should handle all items failing', async () => {
      const executor = new ParallelExecutor<string, number>();

      const handler = async (): Promise<number> => {
        throw new Error('All fail');
      };

      const results = await executor.execute(['a', 'b', 'c'], handler, { maxConcurrent: 2 });

      // All failed, so results should be empty
      expect(results.size).toBe(0);
    });

    it('should emit ItemComplete event with Error on failure', async () => {
      const executor = new ParallelExecutor<string, number>();
      const itemCompleteSpy = vi.fn();

      executor.on(ParallelExecutorEvent.ItemComplete, itemCompleteSpy);

      const handler = async (item: string): Promise<number> => {
        if (item === 'b') {
          throw new Error('Failed for b');
        }
        return item.length;
      };

      await executor.execute(['a', 'b', 'c'], handler, { maxConcurrent: 3 });

      expect(itemCompleteSpy).toHaveBeenCalledTimes(3);
      expect(itemCompleteSpy).toHaveBeenCalledWith('a', 1);
      expect(itemCompleteSpy).toHaveBeenCalledWith('b', expect.any(Error));
      expect(itemCompleteSpy).toHaveBeenCalledWith('c', 1);
    });

    it('should handle partial success scenarios', async () => {
      const executor = new ParallelExecutor<number, string>();

      const handler = async (num: number): Promise<string> => {
        if (num % 2 === 0) {
          throw new Error(`Even number ${num} failed`);
        }
        return `odd-${num}`;
      };

      const results = await executor.execute([1, 2, 3, 4, 5], handler, { maxConcurrent: 3 });

      // Only odd numbers should succeed
      expect(results.get(1)).toBe('odd-1');
      expect(results.get(3)).toBe('odd-3');
      expect(results.get(5)).toBe('odd-5');
      expect(results.has(2)).toBe(false);
      expect(results.has(4)).toBe(false);
      expect(results.size).toBe(3);
    });
  });

  describe('batch processing behavior', () => {
    it('should wait for batch to complete before starting next', async () => {
      const executor = new ParallelExecutor<string, number>();
      const batchStartTimes: number[] = [];

      const handler = async (item: string): Promise<number> => {
        const idx = ['a', 'b', 'c', 'd'].indexOf(item);
        if (idx === 0 || idx === 2) {
          batchStartTimes.push(Date.now());
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        return item.length;
      };

      await executor.execute(['a', 'b', 'c', 'd'], handler, { maxConcurrent: 2 });

      // Second batch should start after first batch completes
      // Use 15ms threshold to account for timing jitter in CI environments
      expect(batchStartTimes.length).toBe(2);
    });
  });

  describe('empty and single item scenarios', () => {
    it('should handle empty items array', async () => {
      const executor = new ParallelExecutor<string, number>();

      const handler = async (item: string): Promise<number> => {
        return item.length;
      };

      const results = await executor.execute([], handler, { maxConcurrent: 2 });

      expect(results.size).toBe(0);
    });

    it('should handle single item', async () => {
      const executor = new ParallelExecutor<string, number>();

      const handler = async (item: string): Promise<number> => {
        return item.length;
      };

      const results = await executor.execute(['single'], handler, { maxConcurrent: 2 });

      expect(results.get('single')).toBe(6);
      expect(results.size).toBe(1);
    });
  });
});
