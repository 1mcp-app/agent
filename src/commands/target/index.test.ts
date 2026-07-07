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
      '--ca-file',
      '/etc/ssl/prod-ca.pem',
      '--insecure-skip-verify',
    ]);

    expect(runCliCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'prod',
        url: 'https://prod.example.com',
        use: true,
        displayName: 'Production',
        caFile: '/etc/ssl/prod-ca.pem',
        insecureSkipVerify: true,
      }),
      expect.any(Function),
    );
  });

  it('registers target export, import, doctor, and insecure TLS acceptance options', async () => {
    const parser = setupTargetCommands(yargs([]).exitProcess(false).help(false).version(false));

    await parser.parseAsync(['target', 'export', '--output', 'targets.json']);
    await parser.parseAsync(['target', 'import', 'targets.json', '--dry-run', '--json']);
    await parser.parseAsync(['target', 'doctor', '--fix-secrets', '--prune-orphans']);
    await parser.parseAsync(['target', 'use', 'lab', '--accept-insecure-tls', '--json']);
    await parser.parseAsync(['target', 'verify', 'lab', '--accept-insecure-tls', '--json']);

    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ output: 'targets.json' }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ file: 'targets.json', dryRun: true, json: true }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ fixSecrets: true, pruneOrphans: true }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ name: 'lab', acceptInsecureTls: true, json: true }),
      expect.any(Function),
    );
    expect(runCliCommandMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ name: 'lab', acceptInsecureTls: true, json: true }),
      expect.any(Function),
    );
  });
});
