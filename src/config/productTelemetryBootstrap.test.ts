import { beforeEach, describe, expect, it, vi } from 'vitest';

const parentEnvironment = vi.hoisted(() => ({ ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED: 'true', CI: undefined }));
vi.mock('./runtimeBootstrap.js', () => ({ getRuntimeParentEnvironment: () => parentEnvironment }));

describe('Product Usage Telemetry test suppression', () => {
  beforeEach(() => {
    vi.resetModules();
    parentEnvironment.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED = 'true';
  });

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

  it.each([undefined, false])(
    'keeps direct runtime bootstrap suppressed when the typed flag is %s',
    async (typedFlag) => {
      const { configureProductTelemetryBootstrap, initializeProductTelemetry, productCollectionEnabled } =
        await import('./productTelemetryBootstrap.js');
      configureProductTelemetryBootstrap({
        'product-telemetry-test-suppressed': typedFlag,
        'product-telemetry': true,
        'product-telemetry-ci': true,
      });
      const initialize = vi.fn();
      expect(initializeProductTelemetry(initialize)).toBeUndefined();
      expect(initialize).not.toHaveBeenCalled();
      expect(productCollectionEnabled()).toBe(false);
    },
  );

  it.each(['1', 'yes', 'TRUE'])('honors launcher suppression encoded as %s over typed false', async (encoding) => {
    parentEnvironment.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED = encoding;
    const { configureProductTelemetryBootstrap, initializeProductTelemetry } =
      await import('./productTelemetryBootstrap.js');
    configureProductTelemetryBootstrap({ 'product-telemetry-test-suppressed': false, 'product-telemetry-ci': true });
    const initialize = vi.fn();
    initializeProductTelemetry(initialize);
    expect(initialize).not.toHaveBeenCalled();
  });

  it('allows a controlled initializer after an explicitly unsuppressed bootstrap', async () => {
    const { configureProductTelemetryBootstrap, initializeProductTelemetry } =
      await import('./productTelemetryBootstrap.js');
    parentEnvironment.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED = 'false';
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
