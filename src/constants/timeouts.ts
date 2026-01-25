/**
 * Centralized timeout constants for the application
 */

/**
 * Timeout values used throughout the application.
 * Using `as const` makes these immutable at runtime while allowing TypeScript inference.
 */
export const TIMEOUTS = {
  /** SSE heartbeat interval (30 seconds) */
  SSE_HEARTBEAT: 30000,
  /** Idle timeout for client instances (5 minutes) */
  IDLE_TIMEOUT: 5 * 60 * 1000,
  /** Cleanup interval for idle instances (1 minute) */
  CLEANUP_INTERVAL: 60 * 1000,
  /** File storage cleanup interval (5 minutes) */
  FILE_STORAGE_CLEANUP: 5 * 60 * 1000,
} as const;

/** Type representing timeout values from the TIMEOUTS object */
export type TimeoutValue = (typeof TIMEOUTS)[keyof typeof TIMEOUTS];
