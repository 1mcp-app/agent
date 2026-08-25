import { describe, expect, it, vi } from 'vitest';

import { resolveAsyncLoadingOptions } from './asyncLoadingOptions.js';

describe('resolveAsyncLoadingOptions', () => {
  it('uses snapshot notification defaults without deprecation warnings', () => {
    const warn = vi.fn();

    const result = resolveAsyncLoadingOptions({}, undefined, warn);

    expect(result).toMatchObject({
      enabled: false,
      notifyOnServerReady: true,
      waitForMinimumServers: 0,
      initialLoadTimeoutMs: 30000,
      batchDelayMs: 1000,
      loadingPolicy: {
        maxConcurrentLoads: 5,
        maxRetries: 3,
        retryDelayMs: 2000,
        enableBackgroundRetry: true,
        backgroundRetryIntervalMs: 60000,
        backgroundRetryMaxServersPerCycle: 3,
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, Number.NaN])('rejects an invalid notification batch delay of %s', (batchDelay) => {
    expect(() => resolveAsyncLoadingOptions({ 'async-batch-delay': batchDelay }, undefined, vi.fn())).toThrow(
      'Async notification batch delay must be a non-negative integer',
    );
  });

  it('treats deprecated CLI or environment thresholds as warning-only no-ops', () => {
    const warn = vi.fn();

    const result = resolveAsyncLoadingOptions({ 'async-min-servers': 12, 'async-timeout': 1 }, undefined, warn);

    expect(result.waitForMinimumServers).toBe(0);
    expect(result.initialLoadTimeoutMs).toBe(30000);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.join('\n')).toContain('ONE_MCP_ASYNC_MIN_SERVERS');
    expect(warn.mock.calls.join('\n')).toContain('ONE_MCP_ASYNC_TIMEOUT');
  });

  it('warns for deprecated TOML thresholds without consuming their values', () => {
    const warn = vi.fn();

    const result = resolveAsyncLoadingOptions({}, { minServers: 4, timeout: 9000 }, warn);

    expect(result.waitForMinimumServers).toBe(0);
    expect(result.initialLoadTimeoutMs).toBe(30000);
    expect(warn.mock.calls.join('\n')).toContain('asyncLoading.minServers');
    expect(warn.mock.calls.join('\n')).toContain('asyncLoading.timeout');
  });

  it('supports the deprecated notification alias with a warning', () => {
    const warn = vi.fn();

    const result = resolveAsyncLoadingOptions({ 'async-notify-on-ready': false }, undefined, warn);

    expect(result.notifyOnServerReady).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('gives the canonical snapshot flag precedence over the deprecated alias', () => {
    const warn = vi.fn();

    const result = resolveAsyncLoadingOptions(
      {
        'async-notify-on-snapshot': false,
        'async-notify-on-ready': true,
      },
      undefined,
      warn,
    );

    expect(result.notifyOnServerReady).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('resolves CLI or environment values before config.toml values', () => {
    const result = resolveAsyncLoadingOptions(
      {
        'async-max-concurrent-loads': 7,
        'async-max-retries': 0,
        'async-retry-delay': 0,
        'async-background-retry': false,
        'async-background-retry-interval': 1200,
        'async-background-retry-max-servers': 4,
      },
      {
        maxConcurrentLoads: 2,
        maxRetries: 8,
        retryDelay: 9000,
        backgroundRetry: { enabled: true, interval: 8000, maxServersPerCycle: 9 },
      },
      vi.fn(),
    );

    expect(result.loadingPolicy).toEqual({
      maxConcurrentLoads: 7,
      maxRetries: 0,
      retryDelayMs: 0,
      enableBackgroundRetry: false,
      backgroundRetryIntervalMs: 1200,
      backgroundRetryMaxServersPerCycle: 4,
    });
  });

  it('uses config.toml policy values before defaults', () => {
    const result = resolveAsyncLoadingOptions(
      {},
      {
        maxConcurrentLoads: 8,
        maxRetries: 1,
        retryDelay: 250,
        backgroundRetry: { enabled: false, interval: 5000, maxServersPerCycle: 6 },
      },
      vi.fn(),
    );

    expect(result.loadingPolicy).toEqual({
      maxConcurrentLoads: 8,
      maxRetries: 1,
      retryDelayMs: 250,
      enableBackgroundRetry: false,
      backgroundRetryIntervalMs: 5000,
      backgroundRetryMaxServersPerCycle: 6,
    });
  });

  it.each([
    ['async-max-concurrent-loads', 0, 'maximum concurrent loads'],
    ['async-max-concurrent-loads', 1.5, 'maximum concurrent loads'],
    ['async-max-retries', -1, 'maximum retries'],
    ['async-max-retries', 1.5, 'maximum retries'],
    ['async-retry-delay', -1, 'retry delay'],
    ['async-retry-delay', Number.NaN, 'retry delay'],
    ['async-background-retry-interval', 999, 'background retry interval'],
    ['async-background-retry-interval', 1000.5, 'background retry interval'],
    ['async-background-retry-max-servers', 0, 'maximum servers per cycle'],
    ['async-background-retry-max-servers', 2.5, 'maximum servers per cycle'],
  ] as const)('rejects invalid --%s=%s', (key, value, message) => {
    expect(() => resolveAsyncLoadingOptions({ [key]: value }, undefined, vi.fn())).toThrow(message);
  });
});
