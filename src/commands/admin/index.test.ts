import { afterEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs';

import { setupAdminCommands } from './index.js';

const runCliCommandMock = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/shared/commandRunner.js', () => ({
  runCliCommand: runCliCommandMock,
}));

describe('setupAdminCommands', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers admin login, status, and logout through yargs and runCliCommand', async () => {
    const parser = setupAdminCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync([
      'admin',
      'login',
      '--context',
      'prod',
      '--username',
      'operator',
      '--password',
      'secret',
      '--json',
    ]);
    await parser.parseAsync(['admin', 'status', '--context', 'prod', '--json']);
    await parser.parseAsync(['admin', 'logout', '--context', 'prod', '--forget']);

    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: 'prod',
        username: 'operator',
        password: 'secret',
        json: true,
      }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ context: 'prod', json: true }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ context: 'prod', forget: true }),
      expect.any(Function),
    );
  });

  it('preserves --url as a parsed option so the command layer can reject credential URL mode', async () => {
    const parser = setupAdminCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync(['admin', 'status', '--url', 'https://prod.example.com']);

    expect(runCliCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://prod.example.com' }),
      expect.any(Function),
    );
  });
});
