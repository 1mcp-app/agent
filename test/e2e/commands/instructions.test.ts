import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('instructions command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'instructions-command',
      createConfigFile: true,
    });
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  it('rejects removed setup flags', async () => {
    const result = await runner.runCommand('instructions', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), '--write-startup-docs'],
      expectError: true,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Unknown arguments: write-startup-docs');
  });
});
