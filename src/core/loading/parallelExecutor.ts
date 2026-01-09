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
  /** Emitted when a batch of items completes processing */
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
 * concurrency limit. Items are processed in batches, and events are emitted for
 * observability during execution.
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
   * @throws Never throws - individual item failures are caught and logged, other items continue processing
   * @remarks Errors from individual items do not prevent other items from processing.
   *          Failed items emit ItemComplete events with Error objects and are logged,
   *          then excluded from the returned results Map. Use event listeners to track failures.
   */
  async execute(items: T[], handler: (item: T) => Promise<R>, options: ParallelExecutorOptions): Promise<Map<T, R>> {
    const results = new Map<T, R>();

    // Process items in batches based on maxConcurrent
    for (let i = 0; i < items.length; i += options.maxConcurrent) {
      const batch = items.slice(i, i + options.maxConcurrent);

      // Start all items in this batch
      const batchPromises = batch.map(async (item) => {
        this.emit(ParallelExecutorEvent.ItemStart, item);

        try {
          const result = await handler(item);
          results.set(item, result);
          this.emit(ParallelExecutorEvent.ItemComplete, item, result);
          return result;
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          // Still emit the completion event, but don't set in results Map
          // This allows other items to continue processing
          this.emit(ParallelExecutorEvent.ItemComplete, item, errorObj);
          throw errorObj; // Re-throw for Promise.allSettled handling
        }
      });

      // Wait for this batch to complete before starting next batch
      const batchResults = await Promise.allSettled(batchPromises);

      // Log and track failed items from this batch
      const failedItems: Array<{ item: T; result: PromiseRejectedResult }> = [];
      batchResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          failedItems.push({ item: batch[index], result });
        }
      });

      if (failedItems.length > 0) {
        for (const { item, result } of failedItems) {
          const error = result.reason as unknown;
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(`Failed to process item in parallel execution: ${item}`, {
            error: errorMessage,
            itemType: typeof item,
          });
        }
      }

      // Emit batch complete event
      this.emit(ParallelExecutorEvent.BatchComplete, batch);
    }

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
