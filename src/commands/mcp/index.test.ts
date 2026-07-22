import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupMcpCommands } from './index.js';

const { enableCommandMock, disableCommandMock, restartCommandMock } = vi.hoisted(() => ({
  enableCommandMock: vi.fn(),
  disableCommandMock: vi.fn(),
  restartCommandMock: vi.fn(),
}));

vi.mock('./enable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enable.js')>();
  return {
    ...actual,
    enableCommand: enableCommandMock,
    disableCommand: disableCommandMock,
  };
});

vi.mock('./restart.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./restart.js')>();
  return { ...actual, restartCommand: restartCommandMock };
});

describe('setupMcpCommands', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers runtime-backed enable and disable options', async () => {
    const parser = setupMcpCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync([
      'mcp',
      'enable',
      'filesystem',
      '--context',
      'prod',
      '--json',
      '--idempotency-key',
      'idem_enable',
      '--wait-ms',
      '25',
      '--dry-run',
      '--confirm-non-loopback',
      '--no-login-prompt',
    ]);
    await parser.parseAsync(['mcp', 'disable', 'filesystem', '--url', 'https://runtime.example.com', '--json']);

    expect(enableCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filesystem',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_enable',
        waitMs: 25,
        dryRun: true,
        confirmNonLoopback: true,
        loginPrompt: false,
      }),
    );
    expect(disableCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filesystem',
        url: 'https://runtime.example.com',
        json: true,
      }),
    );
  });

  it('registers runtime-backed restart selectors', async () => {
    const parser = setupMcpCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync([
      'mcp',
      'restart',
      'filesystem',
      '--context',
      'prod',
      '--instance',
      'abcdef012345',
      '--json',
    ]);

    expect(restartCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filesystem',
        context: 'prod',
        instance: 'abcdef012345',
        json: true,
      }),
    );
  });
});
