import { TestFixtures } from '@test/e2e/fixtures/TestFixtures.js';
import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Maintained example setup CLI', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment(TestFixtures.createTestScenario('known-install', 'basic'));
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  it.each(['codegraph', 'code-review-graph', 'serena'])(
    'creates and repeats the %s template without launching it',
    async (example) => {
      const args = ['--known', example, '--executable', process.execPath];
      const before = JSON.parse(await readFile(environment.getConfigPath(), 'utf8'));
      runner.assertSuccess(await runner.runMcpCommand('install', { args }));
      const first = await readFile(environment.getConfigPath(), 'utf8');
      const config = JSON.parse(first);
      expect(config.mcpServers).toEqual(before.mcpServers);
      expect(config.mcpTemplates[example].command).toBe(process.execPath);
      expect(config.mcpTemplates[example].cwd).toContain('{{');
      expect(config.mcpTemplates[example].preparation).toBeUndefined();
      const repeated = await runner.runMcpCommand('install', { args });
      runner.assertSuccess(repeated);
      runner.assertOutputContains(repeated, 'Unchanged');
      expect(await readFile(environment.getConfigPath(), 'utf8')).toBe(first);
    },
  );

  it('previews, creates a static target, and preserves secret references and explicit overrides', async () => {
    const checkout = await realpath(environment.getTempDir());
    const args = [
      '--known',
      'serena',
      '--executable',
      process.execPath,
      '--checkout',
      checkout,
      '--name',
      'native-example',
    ];
    const before = await readFile(environment.getConfigPath(), 'utf8');
    runner.assertSuccess(await runner.runMcpCommand('install', { args: [...args, '--dry-run'] }));
    expect(await readFile(environment.getConfigPath(), 'utf8')).toBe(before);
    runner.assertSuccess(await runner.runMcpCommand('install', { args }));
    const config = JSON.parse(await readFile(environment.getConfigPath(), 'utf8'));
    expect(config.mcpServers['native-example'].cwd).toBe(checkout);
    config.mcpServers['native-example'].env = { API_KEY: '${EXAMPLE_SECRET}' };
    config.mcpServers['native-example'].disabled = true;
    config.mcpServers['native-example'].requestTimeout = 54321;
    await writeFile(environment.getConfigPath(), JSON.stringify(config, null, 2));
    const customized = await readFile(environment.getConfigPath(), 'utf8');
    runner.assertSuccess(await runner.runMcpCommand('install', { args }));
    expect(await readFile(environment.getConfigPath(), 'utf8')).toBe(customized);
  });

  it('rejects unknown examples and missing executables before configuration mutation', async () => {
    const before = await readFile(environment.getConfigPath(), 'utf8');
    const unknown = await runner.runMcpCommand('install', { args: ['--known', 'unknown-example'] });
    expect(unknown.exitCode).not.toBe(0);
    const missing = await runner.runMcpCommand('install', {
      args: ['--known', 'codegraph', '--executable', join(environment.getTempDir(), 'missing-executable')],
    });
    expect(missing.exitCode).not.toBe(0);
    expect(await readFile(environment.getConfigPath(), 'utf8')).toBe(before);
  });

  it('does not convert a static target into a template even with force', async () => {
    const args = ['--known', 'codegraph', '--executable', process.execPath];
    runner.assertSuccess(
      await runner.runMcpCommand('install', {
        args: [...args, '--checkout', await realpath(environment.getTempDir())],
      }),
    );
    const before = await readFile(environment.getConfigPath(), 'utf8');
    const collision = await runner.runMcpCommand('install', { args: [...args, '--force'] });
    expect(collision.exitCode).not.toBe(0);
    expect(await readFile(environment.getConfigPath(), 'utf8')).toBe(before);
  });
});
