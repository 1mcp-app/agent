import { EventEmitter } from 'events';

import logger from '@src/logger/logger.js';

/**
 * Events emitted by ParallelExecutor during execution
 */
export const enum ParallelExecutorEvent {
  /** Emitted when an item begins processing */
  ItemStart = 'item-start',
  /** Emitted when an item completes processing (success or failure) */
  ItemComplete = 'item-complete',
  /** Emitted when an original concurrency group completes processing */
  BatchComplete = 'batch-complete',
}

/**
 * Type-safe event handler map for ParallelExecutor
 */
export interface ParallelExecutorEvents<T, R> {
  [ParallelExecutorEvent.ItemStart]: (item: T) => void;
  [ParallelExecutorEvent.ItemComplete]: (item: T, result: R | Error) => void;
  [ParallelExecutorEvent.BatchComplete]: (batch: T[]) => void;
}

/**
 * Options for parallel execution
 */
export interface ParallelExecutorOptions {
  /** Maximum number of items to process concurrently */
  readonly maxConcurrent: number;
}

/**
 * Result type for execution - can be either a success result or an Error
 */
export type ExecutionResult<R> = R | Error;

/**
 * ParallelExecutor - Executes items in parallel with concurrency control
 *
 * This utility processes multiple items concurrently while respecting a maximum
 * concurrency limit. Workers claim the next item as soon as they become free,
 * and events are emitted for observability during execution.
 *
 * @example
 * ```typescript
 * const executor = new ParallelExecutor<string, number>();
 *
 * executor.on(ParallelExecutorEvent.ItemStart, (item) => {
 *   console.log(`Processing: ${item}`);
 * });
 *
 * const results = await executor.execute(
 *   ['a', 'b', 'c'],
 *   async (item) => {
 *     return item.length; // Some async operation
 *   },
 *   { maxConcurrent: 2 }
 * );
 *
 * // Results: Map {'a' => 1, 'b' => 1, 'c' => 1}
 * ```
 */
export class ParallelExecutor<T, R> extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Allow many listeners for observability
  }

  /**
   * Execute items in parallel with concurrency control
   *
   * @param items - Array of items to process
   * @param handler - Async function that processes each item
   * @param options - Execution options including max concurrency
   * @returns Map of items to their successful results only. Failed items are not included
   *          but can be tracked via ItemComplete events (which emit Error objects)
   * @throws RangeError if maxConcurrent is not a positive integer
   * @remarks Errors from individual handlers do not prevent other items from processing.
   *          Failed items emit ItemComplete events with Error objects and are logged,
   *          then excluded from the returned results Map. Use event listeners to track failures.
   */
  async execute(items: T[], handler: (item: T) => Promise<R>, options: ParallelExecutorOptions): Promise<Map<T, R>> {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent <= 0) {
      throw new RangeError('maxConcurrent must be a positive integer');
    }

    const results = new Map<T, R>();
    let nextIndex = 0;
    let nextBatchToEmit = 0;
    const batches = Array.from({ length: Math.ceil(items.length / options.maxConcurrent) }, (_, index) =>
      items.slice(index * options.maxConcurrent, (index + 1) * options.maxConcurrent),
    );
    const remainingInBatch = batches.map((batch) => batch.length);

    const markItemComplete = (index: number): void => {
      const batchIndex = Math.floor(index / options.maxConcurrent);
      remainingInBatch[batchIndex]--;

      while (nextBatchToEmit < batches.length && remainingInBatch[nextBatchToEmit] === 0) {
        this.emit(ParallelExecutorEvent.BatchComplete, batches[nextBatchToEmit]);
        nextBatchToEmit++;
      }
    };

    const runWorker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const itemIndex = nextIndex++;
        const item = items[itemIndex];
        this.emit(ParallelExecutorEvent.ItemStart, item);

        try {
          const result = await handler(item);
          results.set(item, result);
          this.emit(ParallelExecutorEvent.ItemComplete, item, result);
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          this.emit(ParallelExecutorEvent.ItemComplete, item, errorObj);
          logger.error(`Failed to process item in parallel execution: ${item}`, {
            error: errorObj.message,
            itemType: typeof item,
          });
        } finally {
          markItemComplete(itemIndex);
        }
      }
    };

    const workerCount = Math.min(options.maxConcurrent, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

    return results;
  }

  /**
   * Type-safe event listener registration
   */
  on<K extends keyof ParallelExecutorEvents<T, R>>(event: K, listener: ParallelExecutorEvents<T, R>[K]): this {
    return super.on(event, listener);
  }

  /**
   * Type-safe one-time event listener registration
   */
  once<K extends keyof ParallelExecutorEvents<T, R>>(event: K, listener: ParallelExecutorEvents<T, R>[K]): this {
    return super.once(event, listener);
  }

  /**
   * Type-safe event listener removal
   */
  off<K extends keyof ParallelExecutorEvents<T, R>>(event: K, listener: ParallelExecutorEvents<T, R>[K]): this {
    return super.off(event, listener);
  }

  /**
   * Type-safe event emission
   */
  emit<K extends keyof ParallelExecutorEvents<T, R>>(
    event: K,
    ...args: Parameters<ParallelExecutorEvents<T, R>[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
