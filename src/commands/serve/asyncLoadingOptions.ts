import { type BackendLoadingPolicy, DEFAULT_BACKEND_LOADING_POLICY } from '@src/core/loading/backendLoadingPolicy.js';

export interface AsyncLoadingCliOptions {
  'enable-async-loading'?: boolean;
  'async-min-servers'?: number;
  'async-timeout'?: number;
  'async-max-concurrent-loads'?: number;
  'async-max-retries'?: number;
  'async-retry-delay'?: number;
  'async-background-retry'?: boolean;
  'async-background-retry-interval'?: number;
  'async-background-retry-max-servers'?: number;
  'async-batch-notifications'?: boolean;
  'async-batch-delay'?: number;
  'async-notify-on-snapshot'?: boolean;
  'async-notify-on-ready'?: boolean;
}

export interface AsyncLoadingAppOptions {
  enabled?: boolean;
  minServers?: number;
  timeout?: number;
  maxConcurrentLoads?: number;
  maxRetries?: number;
  retryDelay?: number;
  backgroundRetry?: {
    enabled?: boolean;
    interval?: number;
    maxServersPerCycle?: number;
  };
  batchNotifications?: boolean;
  batchDelay?: number;
}

export interface ResolvedAsyncLoadingOptions {
  enabled: boolean;
  notifyOnServerReady: boolean;
  waitForMinimumServers: number;
  initialLoadTimeoutMs: number;
  batchNotifications: boolean;
  batchDelayMs: number;
  loadingPolicy: BackendLoadingPolicy;
}

const DEPRECATED_INPUTS = {
  minServers:
    '`--async-min-servers`, `ONE_MCP_ASYNC_MIN_SERVERS`, and `asyncLoading.minServers` are deprecated compatibility no-ops',
  timeout: '`--async-timeout`, `ONE_MCP_ASYNC_TIMEOUT`, and `asyncLoading.timeout` are deprecated compatibility no-ops',
} as const;

function requireInteger(name: string, value: number, minimum: number): number {
  if (!Number.isInteger(value) || value < minimum) {
    const requirement = minimum === 0 ? 'a non-negative integer' : `an integer of at least ${minimum}`;
    throw new Error(`${name} must be ${requirement}.`);
  }
  return value;
}

/**
 * Resolve async-loading controls without treating compatibility settings as
 * readiness gates. Yargs has already merged ONE_MCP_* values into cliOptions.
 */
export function resolveAsyncLoadingOptions(
  cliOptions: AsyncLoadingCliOptions,
  appOptions: AsyncLoadingAppOptions | undefined,
  warn: (message: string) => void,
): ResolvedAsyncLoadingOptions {
  if (cliOptions['async-min-servers'] !== undefined || appOptions?.minServers !== undefined) {
    warn(`DEPRECATION WARNING: ${DEPRECATED_INPUTS.minServers}; remove this setting before the next breaking release.`);
  }
  if (cliOptions['async-timeout'] !== undefined || appOptions?.timeout !== undefined) {
    warn(`DEPRECATION WARNING: ${DEPRECATED_INPUTS.timeout}; remove this setting before the next breaking release.`);
  }
  if (cliOptions['async-notify-on-ready'] !== undefined) {
    warn(
      'DEPRECATION WARNING: `--async-notify-on-ready` / `ONE_MCP_ASYNC_NOTIFY_ON_READY` is deprecated; use `--async-notify-on-snapshot` instead.',
    );
  }

  const batchDelayMs = cliOptions['async-batch-delay'] ?? appOptions?.batchDelay ?? 1000;
  if (!Number.isInteger(batchDelayMs) || batchDelayMs < 0) {
    throw new Error('Async notification batch delay must be a non-negative integer number of milliseconds.');
  }

  const maxConcurrentLoads = requireInteger(
    'Async maximum concurrent loads',
    cliOptions['async-max-concurrent-loads'] ??
      appOptions?.maxConcurrentLoads ??
      DEFAULT_BACKEND_LOADING_POLICY.maxConcurrentLoads,
    1,
  );
  const maxRetries = requireInteger(
    'Async maximum retries',
    cliOptions['async-max-retries'] ?? appOptions?.maxRetries ?? DEFAULT_BACKEND_LOADING_POLICY.maxRetries,
    0,
  );
  const retryDelayMs = requireInteger(
    'Async retry delay',
    cliOptions['async-retry-delay'] ?? appOptions?.retryDelay ?? DEFAULT_BACKEND_LOADING_POLICY.retryDelayMs,
    0,
  );
  const backgroundRetryIntervalMs = requireInteger(
    'Async background retry interval',
    cliOptions['async-background-retry-interval'] ??
      appOptions?.backgroundRetry?.interval ??
      DEFAULT_BACKEND_LOADING_POLICY.backgroundRetryIntervalMs,
    1000,
  );
  const backgroundRetryMaxServersPerCycle = requireInteger(
    'Async background retry maximum servers per cycle',
    cliOptions['async-background-retry-max-servers'] ??
      appOptions?.backgroundRetry?.maxServersPerCycle ??
      DEFAULT_BACKEND_LOADING_POLICY.backgroundRetryMaxServersPerCycle,
    1,
  );

  return {
    enabled: cliOptions['enable-async-loading'] ?? appOptions?.enabled ?? false,
    // The canonical spelling wins when both it and the compatibility alias are explicit.
    notifyOnServerReady: cliOptions['async-notify-on-snapshot'] ?? cliOptions['async-notify-on-ready'] ?? true,
    // Retained internal fields are deliberately fixed: neither is a readiness gate.
    waitForMinimumServers: 0,
    initialLoadTimeoutMs: 30000,
    batchNotifications: cliOptions['async-batch-notifications'] ?? appOptions?.batchNotifications ?? true,
    batchDelayMs,
    loadingPolicy: {
      maxConcurrentLoads,
      maxRetries,
      retryDelayMs,
      enableBackgroundRetry:
        cliOptions['async-background-retry'] ??
        appOptions?.backgroundRetry?.enabled ??
        DEFAULT_BACKEND_LOADING_POLICY.enableBackgroundRetry,
      backgroundRetryIntervalMs,
      backgroundRetryMaxServersPerCycle,
    },
  };
}
