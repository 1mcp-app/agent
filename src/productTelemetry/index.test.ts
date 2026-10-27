import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() =>
  vi.fn(function () {
    throw new Error('must not initialize installation');
  }),
);
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
    const { beginProductCommand } = await import('./index.js');
    beginProductCommand('inspect').finish('success');
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
