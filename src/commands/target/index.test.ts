import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupTargetCommands } from './index.js';

const runCliCommandMock = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/shared/commandRunner.js', () => ({
  runCliCommand: runCliCommandMock,
}));

describe('setupTargetCommands', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers the top-level target add command through yargs and runCliCommand', async () => {
    await setupTargetCommands(yargs([]).exitProcess(false).help(false).version(false)).parseAsync([
      'target',
      'add',
      'prod',
      'https://prod.example.com',
      '--use',
      '--display-name',
      'Production',
    ]);

    expect(runCliCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'prod',
        url: 'https://prod.example.com',
        use: true,
        displayName: 'Production',
      }),
      expect.any(Function),
    );
  });
});
