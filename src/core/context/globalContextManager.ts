import { EventEmitter } from 'events';

import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

/**
 * Global Context Manager for MCP server template processing
 *
 * This singleton manages context data that's extracted from HTTP headers
 * and makes it available to the MCP server configuration loading process.
 * It supports context updates and provides events for context changes.
 */
export class GlobalContextManager extends EventEmitter {
  private static instance: GlobalContextManager;
  private currentContext?: ContextData;
  private isInitialized = false;

  private constructor() {
    super();
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): GlobalContextManager {
    if (!GlobalContextManager.instance) {
      GlobalContextManager.instance = new GlobalContextManager();
    }
    return GlobalContextManager.instance;
  }

  /**
   * Initialize the context manager with optional initial context
   */
  public initialize(initialContext?: ContextData): void {
    if (this.isInitialized) {
      logger.warn('GlobalContextManager is already initialized');
      return;
    }

    this.currentContext = initialContext;
    this.isInitialized = true;

    if (initialContext) {
      logger.info(
        `GlobalContextManager initialized with context: ${initialContext.project.name} (${initialContext.sessionId})`,
      );
    } else {
      logger.info('GlobalContextManager initialized without context');
    }
  }

  /**
   * Get the current context
   */
  public getContext(): ContextData | undefined {
    return this.currentContext;
  }

  /**
   * Check if context is available
   */
  public hasContext(): boolean {
    return this.isInitialized && !!this.currentContext;
  }

  /**
   * Update the context and emit change event
   */
  public updateContext(context: ContextData): void {
    const oldContext = this.currentContext;
    const oldSessionId = oldContext?.sessionId;
    const newSessionId = context.sessionId;

    // Check if context actually changed
    const contextChanged = !oldContext || !this.deepEqual(oldContext, context);

    this.currentContext = context;

    if (!this.isInitialized) {
      this.isInitialized = true;
    }

    // Only emit context change event if context actually changed
    if (contextChanged) {
      const eventData = {
        oldContext,
        newContext: context,
        sessionIdChanged: oldSessionId !== newSessionId || (!oldContext && !!context),
        timestamp: Date.now(),
      };

      // Emit events with individual listener error handling to prevent crashes from listener errors
      this.emitSafely('context-changed', eventData);

      this.emitSafely('context-updated', {
        oldContext: eventData.oldContext,
        newContext: eventData.newContext,
        timestamp: eventData.timestamp,
      });

      // Emit session changed event if session ID actually changed
      if (eventData.sessionIdChanged) {
        this.emitSafely('session-changed', {
          oldSessionId,
          newSessionId,
          timestamp: eventData.timestamp,
        });
      }

      logger.info(`Context updated: ${context.project.name} (${context.sessionId})`);
    }
  }

  /**
   * Emit event with error handling for individual listeners
   * Manually handles listeners to provide error isolation while preserving once behavior
   */
  private emitSafely(event: string, ...args: unknown[]): void {
    // Get raw listeners (includes once wrapper functions)
    const rawListeners = this.rawListeners(event);

    // Remove all listeners temporarily to prevent automatic once behavior during our manual iteration
    this.removeAllListeners(event);

    for (const rawListener of rawListeners) {
      try {
        // Determine if this is a once listener wrapper
        const listenerObj = rawListener as { _listener?: Function; once?: boolean };
        const isOnceListener = typeof rawListener === 'function' && listenerObj._listener !== undefined;

        // Get the actual listener function
        const actualListener: Function = isOnceListener ? listenerObj._listener! : (rawListener as Function);

        // Call the actual listener
        (actualListener as (...args: unknown[]) => void)(...args);
      } catch (error) {
        logger.error(`Error in ${event} listener:`, error);
        // Continue with other listeners even if one fails
      }
    }

    // Re-add non-once listeners back to the event
    for (const rawListener of rawListeners) {
      const listenerObj = rawListener as { _listener?: Function; once?: boolean };
      const isOnceListener = typeof rawListener === 'function' && listenerObj._listener !== undefined;

      if (!isOnceListener) {
        this.on(event, rawListener as (...args: unknown[]) => void);
      }
    }
  }

  /**
   * Deep comparison of two contexts
   */
  private deepEqual(obj1: unknown, obj2: unknown): boolean {
    if (obj1 === obj2) return true;
    if (obj1 == null || obj2 == null) return false;
    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') {
      return obj1 === obj2;
    }

    const keys1 = Object.keys(obj1 as Record<string, unknown>);
    const keys2 = Object.keys(obj2 as Record<string, unknown>);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual((obj1 as Record<string, unknown>)[key], (obj2 as Record<string, unknown>)[key])) return false;
    }

    return true;
  }

  /**
   * Clear the current context
   */
  public clearContext(): void {
    const oldContext = this.currentContext;
    this.currentContext = undefined;
    this.isInitialized = false;

    if (oldContext) {
      this.emit('context-cleared', {
        oldContext,
        timestamp: Date.now(),
      });

      logger.info('Context cleared');
    }
  }

  /**
   * Reset the manager to initial state
   */
  public reset(): void {
    this.clearContext();
    this.removeAllListeners();
  }
}

// Export singleton instance getter
export const getGlobalContextManager = (): GlobalContextManager => {
  return GlobalContextManager.getInstance();
};

/**
 * Initialize the global context manager if it hasn't been initialized
 */
export function ensureGlobalContextManagerInitialized(initialContext?: ContextData): GlobalContextManager {
  const manager = GlobalContextManager.getInstance();

  if (!manager.hasContext()) {
    manager.initialize(initialContext);
  }

  return manager;
}

// Create the singleton factory instance
