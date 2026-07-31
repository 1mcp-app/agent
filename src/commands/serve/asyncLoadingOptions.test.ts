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
});
