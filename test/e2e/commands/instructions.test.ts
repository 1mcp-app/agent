import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('instructions command startup docs E2E', () => {
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

  it('creates AGENTS.md and CLAUDE.md in the repo root', async () => {
    const result = await runner.runCommand('instructions', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), '--write-startup-docs'],
    });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('Updated 1MCP startup docs:');

    const agents = await readFile(path.join(environment.getTempDir(), 'AGENTS.md'), 'utf8');
    const claude = await readFile(path.join(environment.getTempDir(), 'CLAUDE.md'), 'utf8');

    expect(agents).toContain('# 1MCP Agent Bootstrap');
    expect(agents).toContain('Run `1mcp instructions` at the beginning of the session.');
    expect(claude).toContain('# 1MCP Agent Bootstrap');
  });

  it('preserves user content and updates only the managed block', async () => {
    const claudePath = path.join(environment.getTempDir(), 'CLAUDE.md');
    await writeFile(
      claudePath,
      '# Existing Notes\n\nKeep this content.\n\n<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->\nold\n<!-- END 1MCP MANAGED STARTUP DOCS -->\n',
      'utf8',
    );

    const result = await runner.runCommand('instructions', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), '--write-startup-docs', '--targets', 'claude'],
    });

    runner.assertSuccess(result);

    const claude = await readFile(claudePath, 'utf8');
    expect(claude).toContain('# Existing Notes');
    expect(claude).toContain('Keep this content.');
    expect(claude).toContain('Run `1mcp inspect <server>` before selecting a tool.');
    expect(claude).not.toContain('\nold\n');
    expect(claude.match(/BEGIN 1MCP MANAGED STARTUP DOCS/g)).toHaveLength(1);
  });
});
