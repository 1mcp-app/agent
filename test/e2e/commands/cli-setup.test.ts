import { CliTestRunner, CommandTestEnvironment } from '@test/e2e/utils/index.js';

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('cli-setup command E2E', () => {
  let environment: CommandTestEnvironment;
  let runner: CliTestRunner;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'cli-setup-command',
      createConfigFile: true,
    });
    await environment.setup();
    runner = new CliTestRunner(environment);
  });

  afterEach(async () => {
    await environment.cleanup();
  });

  it('writes global setup by default', async () => {
    const homeDir = path.join(environment.getTempDir(), 'home');
    const result = await runner.runCommand('cli-setup', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), '--codex'],
      envOverrides: { HOME: homeDir, USERPROFILE: homeDir },
    });

    runner.assertSuccess(result);
    expect(result.stdout).toContain('Updated 1MCP CLI setup files:');

    const codexManagedDoc = await readFile(path.join(homeDir, '.codex', '1MCP.md'), 'utf8');
    const codexHooks = await readFile(path.join(homeDir, '.codex', 'hooks.json'), 'utf8');
    const agents = await readFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8');

    expect(codexManagedDoc).toContain(
      'If this session already received the current 1MCP instructions content from hooks',
    );
    expect(codexHooks).toContain('"command": "1mcp instructions"');
    expect(agents).toBe('@1MCP.md\n');
  });

  it('writes repo-scoped setup and preserves surrounding content', async () => {
    const claudePath = path.join(environment.getTempDir(), 'CLAUDE.md');
    await writeFile(claudePath, '# Existing Notes\n\nKeep this section.\n', 'utf8');

    const result = await runner.runCommand('cli-setup', '', {
      cwd: environment.getTempDir(),
      args: ['--config-dir', environment.getConfigDir(), '--scope', 'repo', '--claude'],
    });

    runner.assertSuccess(result);

    const claudeManagedDoc = await readFile(path.join(environment.getTempDir(), '.claude', '1MCP.md'), 'utf8');
    const claude = await readFile(claudePath, 'utf8');

    expect(claudeManagedDoc).toContain('Otherwise, run `1mcp instructions` before using any 1MCP-managed MCP servers.');
    expect(claude).toContain('# Existing Notes');
    expect(claude).toContain('Keep this section.');
    expect(claude).not.toContain('<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->');
    expect(claude.endsWith('@.claude/1MCP.md\n')).toBe(true);
  });
});
