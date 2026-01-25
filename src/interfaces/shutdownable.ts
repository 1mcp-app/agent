/**
 * Interface for graceful shutdown support
 *
 * Classes that manage resources (timers, connections, file handles, etc.)
 * should implement this interface to ensure proper cleanup during process shutdown.
 */
export interface Shutdownable {
  /**
   * Perform graceful shutdown of the resource.
   * This method should:
   * - Clear any intervals/timeouts
   * - Close any open connections or file handles
   * - Remove any event listeners
   *
   * This method may be called synchronously during process exit.
   * Avoid asynchronous operations that might not complete before process termination.
   */
  shutdown(): Promise<void> | void;
}
