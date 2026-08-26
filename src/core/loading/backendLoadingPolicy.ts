import { DEFAULT_MAX_CONCURRENT_LOADS } from '@src/constants/mcp.js';

/** Startup-captured policy for backend loading and recovery. */
export interface BackendLoadingPolicy {
  readonly maxConcurrentLoads: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly enableBackgroundRetry: boolean;
  readonly backgroundRetryIntervalMs: number;
  readonly backgroundRetryMaxServersPerCycle: number;
}

export const DEFAULT_BACKEND_LOADING_POLICY: BackendLoadingPolicy = {
  maxConcurrentLoads: DEFAULT_MAX_CONCURRENT_LOADS,
  maxRetries: 3,
  retryDelayMs: 2000,
  enableBackgroundRetry: true,
  backgroundRetryIntervalMs: 60000,
  backgroundRetryMaxServersPerCycle: 3,
};
