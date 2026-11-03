import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() =>
  vi.fn(function (): unknown {
    throw new Error('must not initialize installation');
  }),
);
// Controlled adapter fixture: production/ordinary test suppression remains unchanged.
vi.mock('@src/config/runtimeBootstrap.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('@src/config/runtimeBootstrap.js')>();
  return {
    ...original,
    getRuntimeParentEnvironment: () => ({
      ...original.getRuntimeParentEnvironment(),
      ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'false',
    }),
  };
});
vi.mock('./installationStore.js', () => ({ InstallationStore: store }));
beforeEach(() => {
  vi.resetModules();
  store.mockClear();
});
describe('real producer initialization gate', () => {
  it('never opens state or constructs delivery when test suppressed', async () => {
    const { configureProductTelemetryBootstrap } = await import('@src/config/productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({
      'product-telemetry-test-suppressed': true,
      'product-telemetry': true,
      'product-telemetry-ci': true,
    });
    const timers = vi.spyOn(globalThis, 'setInterval');
    const { beginProductCommand, beginProductStartup, observeProductConfiguration } = await import('./index.js');
    beginProductStartup('serve').finish('success');
    observeProductConfiguration('servers', 12);
    beginProductCommand('inspect').finish('success');
    expect(timers).not.toHaveBeenCalled();
    timers.mockRestore();
    expect(store).not.toHaveBeenCalled();
  });
  it('process disable is inert before opening installation state', async () => {
    const { configureProductTelemetryBootstrap } = await import('@src/config/productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({ 'product-telemetry': false });
    const { beginProductCommand } = await import('./index.js');
    beginProductCommand('inspect').finish('failure');
    expect(store).not.toHaveBeenCalled();
  });
});

it('does not change a command when local producer construction fails', async () => {
  const { configureProductTelemetryBootstrap } = await import('@src/config/productTelemetryBootstrap.js');
  configureProductTelemetryBootstrap({
    'product-telemetry-test-suppressed': false,
    'product-telemetry': true,
    'product-telemetry-ci': true,
  });
  const { beginProductCommand } = await import('./index.js');
  expect(() => beginProductCommand('inspect').finish('success')).not.toThrow();
});

it('arbitrates startup readiness and cancellation once and releases signal listeners', async () => {
  vi.useFakeTimers();
  const ticket = { epoch: 'epoch', generation: 0, installationId: 'identity' };
  const append = vi.fn().mockResolvedValue(true);
  store.mockImplementationOnce(function () {
    return { admit: async () => ticket, append, isCurrent: async () => true, attemptSend: async () => {} };
  });
  const { configureProductTelemetryBootstrap } = await import('@src/config/productTelemetryBootstrap.js');
  configureProductTelemetryBootstrap({ 'product-telemetry-test-suppressed': false, 'product-telemetry-ci': true });
  const { beginProductStartup } = await import('./index.js');
  const onSignal = vi.fn();
  process.once('SIGINT', onSignal);
  const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
  const baseline = process.listenerCount('SIGINT');
  try {
    const cancelled = beginProductStartup('proxy');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.listenerCount('SIGINT')).toBe(baseline + 1);
    process.emit('SIGINT');
    cancelled.finish('success');
    await vi.advanceTimersByTimeAsync(0);
    expect(onSignal).toHaveBeenCalledOnce();
    expect(process.listenerCount('SIGINT')).toBe(baseline - 1);
    expect(kill).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0][1].counters).toEqual([
      {
        kind: 'command',
        name: 'proxy',
        outcome: 'failure',
        transport: 'none',
        client: 'none',
        bucket: 'none',
        count: 1,
      },
    ]);
    const ready = beginProductStartup('serve');
    ready.finish('success');
    ready.finish('failure');
    await vi.advanceTimersByTimeAsync(0);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1][1].counters[0]).toMatchObject({ name: 'serve', outcome: 'success', count: 1 });
    expect(process.listenerCount('SIGINT')).toBe(baseline - 1);
    expect(kill).not.toHaveBeenCalled();
  } finally {
    process.removeListener('SIGINT', onSignal);
    kill.mockRestore();
    vi.useRealTimers();
  }
});
