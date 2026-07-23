import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as configUtils from './utils/mcpServerConfig.js';
import { statusCommand, type StatusCommandDependencies } from './status.js';

const { printerMock } = vi.hoisted(() => {
  const printer = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ['blank', 'title', 'subtitle', 'keyValue', 'raw', 'info', 'warn', 'error', 'success', 'table']) {
    printer[method] = vi.fn(() => printer);
  }
  return { printerMock: printer };
});

vi.mock('@src/utils/ui/printer.js', () => ({ default: printerMock }));

vi.mock('./utils/mcpServerConfig.js', () => ({
  getAllServerTargets: vi.fn(),
  getEffectiveServerTargetConfig: vi.fn(),
  getGlobalConfig: vi.fn(),
  getInheritedKeys: vi.fn(),
  initializeConfigContext: vi.fn(),
  resolveServerTarget: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('./utils/validation.js', () => ({ validateServerName: vi.fn() }));

describe('statusCommand runtime supervision', () => {
  let exit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    vi.mocked(configUtils.getGlobalConfig).mockReturnValue({});
    vi.mocked(configUtils.getInheritedKeys).mockReturnValue([]);
    vi.mocked(configUtils.getAllServerTargets).mockReturnValue({});
  });

  afterEach(() => {
    exit.mockRestore();
  });

  it('shows all supervision facts for a named backend, including a degraded 503 response', async () => {
    const config = { type: 'stdio' as const, command: 'node' };
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpServers',
      serverConfig: config,
    });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    const dependencies = runtimeDependencies({
      ok: false,
      status: 503,
      data: {
        backendId: 'worker',
        state: 'restarting',
        attempt: 3,
        limit: 5,
        nextRetryAt: '2026-07-23T01:02:03.000Z',
        lastExit: { code: 1, signal: 'SIGTERM', pid: 1234, at: '2026-07-23T01:01:00.000Z' },
        lastError: { message: 'connection failed' },
        currentPid: 5678,
      },
    });

    await statusCommand({ name: 'worker' }, dependencies);

    expect(dependencies.resolveTarget).toHaveBeenCalledWith(expect.objectContaining({ context: 'prod' }));
    expect(dependencies.createApiClient).toHaveBeenCalledWith('https://runtime.example.com');
    expect(dependencies.apiGet).toHaveBeenCalledWith('/health/mcp/worker');
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Runtime Status': 'restarting' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Restart Attempt': '3 / 5' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Next Retry': '2026-07-23T01:02:03.000Z' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({
      'Last Exit': 'code=1, signal=SIGTERM, pid=1234, at=2026-07-23T01:01:00.000Z',
    });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Last Error': 'connection failed' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Current PID': 5678 });
  });

  it('queries aggregate health once and adds runtime facts to configured server summaries', async () => {
    const config = { type: 'stdio' as const, command: 'node' };
    vi.mocked(configUtils.getAllServerTargets).mockReturnValue({ worker: config });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpServers',
      serverConfig: config,
    });
    const dependencies = runtimeDependencies({
      ok: true,
      status: 200,
      data: {
        backendSupervision: {
          worker: { state: 'connected', attempt: 0, limit: null, currentPid: 42 },
        },
      },
    });

    await statusCommand({}, dependencies);

    expect(dependencies.apiGet).toHaveBeenCalledTimes(1);
    expect(dependencies.apiGet).toHaveBeenCalledWith('/health/mcp');
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Runtime Status': 'connected' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Restart Attempt': '0 / unlimited' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Current PID': 42 });
  });

  it('shows each active instance returned for a template target', async () => {
    const config = { type: 'stdio' as const, command: 'node', template: { shareable: true } };
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpTemplates',
      serverConfig: config,
    });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    const instanceId = 'a'.repeat(64);
    const dependencies = runtimeDependencies({
      ok: false,
      status: 503,
      data: {
        state: 'crash-loop',
        instances: [
          {
            backendId: `template:worker:${instanceId}`,
            state: 'crash-loop',
            attempt: 5,
            limit: 5,
            lastError: 'failed',
          },
        ],
      },
    });

    await statusCommand({ name: 'worker', verbose: true }, dependencies);

    expect(printerMock.subtitle).toHaveBeenCalledWith(`Instance ${instanceId.slice(0, 12)}:`);
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Restart Attempt': '5 / 5' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Last Error': 'failed' });
  });

  it('aggregates instance-keyed template status in all-server mode', async () => {
    const config = { type: 'stdio' as const, command: 'node' };
    vi.mocked(configUtils.getAllServerTargets).mockReturnValue({ worker: config });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpTemplates',
      serverConfig: config,
    });
    const dependencies = runtimeDependencies({
      ok: false,
      status: 503,
      data: {
        backendSupervision: {
          'worker:one': { backendId: `template:worker:${'a'.repeat(64)}`, state: 'connected' },
          'worker:two': { backendId: `template:worker:${'b'.repeat(64)}`, state: 'crash-loop' },
        },
      },
    });

    await statusCommand({}, dependencies);

    expect(printerMock.keyValue).toHaveBeenCalledWith({ 'Runtime Status': 'crash-loop' });
    expect(printerMock.keyValue).toHaveBeenCalledWith({
      'Active Instances': 2,
      'Instance States': 'connected=1, crash-loop=1',
    });
    expect(printerMock.subtitle).not.toHaveBeenCalledWith(expect.stringMatching(/^Instance /));
  });

  it('summarizes a named template unless verbose output is requested', async () => {
    const config = { type: 'stdio' as const, command: 'node' };
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpTemplates',
      serverConfig: config,
    });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    const dependencies = runtimeDependencies({
      ok: true,
      status: 200,
      data: {
        state: 'connected',
        instances: [{ backendId: `template:worker:${'a'.repeat(64)}`, state: 'connected' }],
      },
    });

    await statusCommand({ name: 'worker' }, dependencies);

    expect(printerMock.keyValue).toHaveBeenCalledWith({
      'Active Instances': 1,
      'Instance States': 'connected=1',
    });
    expect(printerMock.subtitle).not.toHaveBeenCalledWith(expect.stringMatching(/^Instance /));
  });

  it('keeps legacy configuration status successful when runtime discovery is unavailable', async () => {
    const config = { type: 'stdio' as const, command: 'node' };
    vi.mocked(configUtils.resolveServerTarget).mockReturnValue({
      serverName: 'worker',
      source: 'mcpServers',
      serverConfig: config,
    });
    vi.mocked(configUtils.getEffectiveServerTargetConfig).mockReturnValue(config);
    const dependencies = runtimeDependencies({ ok: false, status: 0 });
    dependencies.resolveTarget.mockRejectedValueOnce(new Error('runtime unavailable'));

    await statusCommand({ name: 'worker' }, dependencies);

    expect(exit).not.toHaveBeenCalled();
    expect(printerMock.error).not.toHaveBeenCalled();
    expect(printerMock.keyValue).toHaveBeenCalledWith({
      'Runtime Status': '❓ Unknown (requires 1mcp to be running)',
    });
  });
});

function runtimeDependencies(response: { ok: boolean; status: number; data?: unknown }) {
  const apiGet = vi.fn(async () => response);
  return {
    runtimeTargetStore: {
      current: vi.fn(() => ({ name: 'prod' })),
    },
    resolveTarget: vi.fn(async () => ({ discoveredUrl: 'https://runtime.example.com/mcp' })),
    createApiClient: vi.fn(() => ({ get: apiGet })),
    apiGet,
  } satisfies StatusCommandDependencies & { apiGet: typeof apiGet };
}
