export interface AsyncLoadingCliOptions {
  'enable-async-loading'?: boolean;
  'async-min-servers'?: number;
  'async-timeout'?: number;
  'async-batch-notifications'?: boolean;
  'async-batch-delay'?: number;
  'async-notify-on-snapshot'?: boolean;
  'async-notify-on-ready'?: boolean;
}

export interface AsyncLoadingAppOptions {
  enabled?: boolean;
  minServers?: number;
  timeout?: number;
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
}

const DEPRECATED_INPUTS = {
  minServers:
    '`--async-min-servers`, `ONE_MCP_ASYNC_MIN_SERVERS`, and `asyncLoading.minServers` are deprecated compatibility no-ops',
  timeout: '`--async-timeout`, `ONE_MCP_ASYNC_TIMEOUT`, and `asyncLoading.timeout` are deprecated compatibility no-ops',
} as const;

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

  return {
    enabled: cliOptions['enable-async-loading'] ?? appOptions?.enabled ?? false,
    // The canonical spelling wins when both it and the compatibility alias are explicit.
    notifyOnServerReady: cliOptions['async-notify-on-snapshot'] ?? cliOptions['async-notify-on-ready'] ?? true,
    // Retained internal fields are deliberately fixed: neither is a readiness gate.
    waitForMinimumServers: 0,
    initialLoadTimeoutMs: 30000,
    batchNotifications: cliOptions['async-batch-notifications'] ?? appOptions?.batchNotifications ?? true,
    batchDelayMs: cliOptions['async-batch-delay'] ?? appOptions?.batchDelay ?? 100,
  };
}
