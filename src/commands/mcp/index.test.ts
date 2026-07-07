import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupMcpCommands } from './index.js';

const { enableCommandMock, disableCommandMock } = vi.hoisted(() => ({
  enableCommandMock: vi.fn(),
  disableCommandMock: vi.fn(),
}));

vi.mock('./enable.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./enable.js')>();
  return {
    ...actual,
    enableCommand: enableCommandMock,
    disableCommand: disableCommandMock,
  };
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
    ]);
    await parser.parseAsync(['mcp', 'disable', 'filesystem', '--url', 'https://runtime.example.com', '--json']);

    expect(enableCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'filesystem',
        context: 'prod',
        json: true,
        idempotencyKey: 'idem_enable',
        waitMs: 25,
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
});
