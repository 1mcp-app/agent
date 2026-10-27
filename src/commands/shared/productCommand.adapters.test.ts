import { beginProductCommand } from '@src/productTelemetry/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupAdminCommands } from '../admin/index.js';
import { setupAppCommands } from '../app/index.js';
import { setupMcpCommands } from '../mcp/index.js';
import { listCommand } from '../mcp/list.js';
import { setupPresetCommands } from '../preset/index.js';
import { setupTargetCommands } from '../target/index.js';
import { targetCurrentCommand } from '../target/target.js';
import { setupTelemetryCommands } from '../telemetry/index.js';

const usage = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@src/productTelemetry/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/productTelemetry/index.js')>()),
  beginProductCommand: vi.fn(() => usage),
  localInstallationStore: vi.fn(() => ({ status: async () => ({ enabled: false }) })),
}));
vi.mock('../mcp/list.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mcp/list.js')>()),
  listCommand: vi.fn(async () => {}),
}));
vi.mock('../preset/list.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../preset/list.js')>()),
  listCommand: vi.fn(async () => {}),
}));
vi.mock('../app/list.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app/list.js')>()),
  listCommand: vi.fn(async () => {}),
}));
vi.mock('../target/target.js', () => ({ targetCurrentCommand: vi.fn(async () => {}) }));
vi.mock('../admin/admin.js', () => ({ adminStatusCommand: vi.fn(async () => {}) }));

afterEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});
describe('actual registered command adapters', () => {
  it.each([
    { setup: setupMcpCommands, args: ['mcp', 'list'], family: 'mcp' },
    { setup: setupPresetCommands, args: ['preset', 'list'], family: 'preset' },
    { setup: setupAppCommands, args: ['app', 'list'], family: 'config' },
    { setup: setupTargetCommands, args: ['target', 'current'], family: 'config' },
    { setup: setupAdminCommands, args: ['admin', 'status', '--context', 'local'], family: 'auth' },
  ])('counts $args exactly once as $family', async ({ setup, args, family }) => {
    await setup(yargs().exitProcess(false)).parseAsync(args);
    expect(beginProductCommand).toHaveBeenCalledExactlyOnceWith(family);
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('success');
  });
  it('preserves a direct handler rejection and coarse failure', async () => {
    vi.mocked(listCommand).mockRejectedValueOnce(new Error('private-backend'));
    await expect(setupMcpCommands(yargs().exitProcess(false)).parseAsync(['mcp', 'list'])).rejects.toThrow(
      'private-backend',
    );
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('recognizes normal-return failure from a runtime-backed adapter', async () => {
    vi.mocked(targetCurrentCommand).mockImplementationOnce(async () => {
      process.exitCode = 4;
    });
    await setupTargetCommands(yargs().exitProcess(false)).parseAsync(['target', 'current']);
    expect(usage.finish).toHaveBeenCalledExactlyOnceWith('failure');
  });
  it('does not collect help, invalid input, unknown subcommands or telemetry status', async () => {
    for (const args of [
      ['mcp', '--help'],
      ['mcp', 'remove'],
      ['mcp', 'not-a-command'],
    ]) {
      const parser = setupMcpCommands(yargs().strict().exitProcess(false));
      await parser.parseAsync(args, {}, () => {}).catch(() => {});
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await setupTelemetryCommands(yargs().exitProcess(false)).parseAsync(['telemetry', 'status']);
    expect(beginProductCommand).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
