import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

vi.mock('@src/productTelemetry/commandScope.js', () => ({ runProductCommand: vi.fn() }));

describe('bootstrap telemetry environment controls', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED', 'false');
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY', undefined);
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY_CI', undefined);
    vi.stubEnv('DO_NOT_TRACK', undefined);
    vi.stubEnv('CI', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  async function parseBootstrap(extra: string[] = []) {
    const { setupBootstrapCommand } = await import('./index.js');
    const parser = setupBootstrapCommand(yargs([]).env('ONE_MCP').exitProcess(false));
    return parser.parseAsync(['bootstrap', '--client=codex', '--event=SessionStart', ...extra]);
  }

  it('honors the process environment off-switch without inheriting runtime selectors', async () => {
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY', 'false');
    vi.stubEnv('ONE_MCP_CONTEXT', 'must-not-inherit');
    vi.stubEnv('ONE_MCP_PROJECT', '/must-not-inherit');
    const argv = await parseBootstrap();
    const { getProductCollectionPolicy, productCollectionEnabled } =
      await import('@src/config/productTelemetryBootstrap.js');
    expect(argv.context).toBeUndefined();
    expect(argv.project).toBeUndefined();
    expect(getProductCollectionPolicy().processEnabled).toBe(false);
    expect(productCollectionEnabled()).toBe(false);
  });

  it('honors explicit CI opt-in but never overrides a process disable', async () => {
    vi.stubEnv('CI', 'true');
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY_CI', 'true');
    await parseBootstrap();
    const { productCollectionEnabled } = await import('@src/config/productTelemetryBootstrap.js');
    expect(productCollectionEnabled()).toBe(true);
    await parseBootstrap(['--product-telemetry=false']);
    expect(productCollectionEnabled()).toBe(false);
  });

  it('retains default collection when no process preference is supplied', async () => {
    await parseBootstrap();
    const { getProductCollectionPolicy, productCollectionEnabled } =
      await import('@src/config/productTelemetryBootstrap.js');
    expect(getProductCollectionPolicy().processEnabled).toBeUndefined();
    expect(productCollectionEnabled()).toBe(true);
  });

  it('rejects an invalid telemetry environment value', async () => {
    vi.stubEnv('ONE_MCP_PRODUCT_TELEMETRY', 'maybe');
    await expect(parseBootstrap()).rejects.toThrow('boolean');
  });
});
