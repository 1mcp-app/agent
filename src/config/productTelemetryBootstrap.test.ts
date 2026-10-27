import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Product Usage Telemetry test suppression', () => {
  beforeEach(() => vi.resetModules());

  it('never opens installation state or starts a producer when explicitly suppressed', async () => {
    const { configureProductTelemetryBootstrap, initializeProductTelemetry } =
      await import('./productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({ 'product-telemetry-test-suppressed': true });
    const initialize = vi.fn(() => ({ identity: 'operator', queue: ['retained'], preference: true }));
    expect(initializeProductTelemetry(initialize)).toBeUndefined();
    expect(initialize).not.toHaveBeenCalled();
  });

  it('cannot be re-enabled by later bootstrap options or frozen config', async () => {
    const { configureProductTelemetryBootstrap, initializeProductTelemetry, getProductTelemetryBootstrap } =
      await import('./productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({ 'product-telemetry-test-suppressed': true });
    configureProductTelemetryBootstrap({ 'product-telemetry-test-suppressed': false });
    expect(getProductTelemetryBootstrap()).toEqual({ testSuppressed: true });
    expect(
      initializeProductTelemetry(() => {
        throw new Error('must not initialize');
      }),
    ).toBeUndefined();
  });

  it('allows a controlled initializer after an explicitly unsuppressed bootstrap', async () => {
    const { configureProductTelemetryBootstrap, initializeProductTelemetry } =
      await import('./productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({});
    expect(initializeProductTelemetry(() => 'controlled fixture')).toBe('controlled fixture');
  });

  it('fails closed before bootstrap has supplied the typed decision', async () => {
    const { initializeProductTelemetry } = await import('./productTelemetryBootstrap.js');
    expect(
      initializeProductTelemetry(() => {
        throw new Error('premature initialization');
      }),
    ).toBeUndefined();
  });
});
