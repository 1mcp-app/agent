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
    expect(result.stdout).toContain('skill codex:');
    expect(result.stdout).toContain('(installed)');
    const skill = path.join(homeDir, '.agents/skills/1mcp-preparation-setup');
    expect(await readFile(path.join(skill, 'SKILL.md'), 'utf8')).toContain('name: 1mcp-preparation-setup');
    expect(await readFile(path.join(skill, 'references/serena.md'), 'utf8')).toContain('# Serena');

    const codexManagedDoc = await readFile(path.join(homeDir, '.codex', '1MCP.md'), 'utf8');
    const codexHooks = await readFile(path.join(homeDir, '.codex', 'hooks.json'), 'utf8');
    const agents = await readFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8');

    expect(codexManagedDoc).toContain('Before using 1MCP-managed tools');
    const usage = path.join(homeDir, '.agents/skills/1mcp-cli');
    expect(codexManagedDoc).toContain(path.join(usage, 'SKILL.md').replace(/\\/g, '/'));
    expect(codexManagedDoc.length).toBeLessThan(1500);
    expect(await readFile(path.join(usage, 'references/preparation.md'), 'utf8')).toContain(
      '1mcp project prepare inspect <backend>',
    );
    const hooks = JSON.parse(codexHooks).hooks;
    expect(hooks.SessionStart).toEqual([
      { hooks: [{ type: 'command', command: '1mcp bootstrap --client codex --event SessionStart', timeout: 10 }] },
    ]);
    expect(hooks.SubagentStart).toEqual([
      { hooks: [{ type: 'command', command: '1mcp bootstrap --client codex --event SubagentStart', timeout: 10 }] },
    ]);
    expect(hooks.SessionEnd).toEqual([
      { hooks: [{ type: 'command', command: '1mcp bootstrap --client codex --event SessionEnd', timeout: 3 }] },
    ]);
    expect(hooks.Stop).toBeUndefined();
    expect(hooks.SubagentStop).toBeUndefined();
    expect(agents).toBe(`@${path.join(homeDir, '.codex', '1MCP.md').replace(/\\/g, '/')}\n`);
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

    expect(claudeManagedDoc).toContain('without --compact');
    const usage = path.join(environment.getTempDir(), '.claude/skills/1mcp-cli');
    expect(claudeManagedDoc).toContain(path.join(usage, 'SKILL.md').replace(/\\/g, '/'));
    expect(claudeManagedDoc.length).toBeLessThan(1500);
    expect(await readFile(path.join(usage, 'references/preparation.md'), 'utf8')).toContain(
      '1mcp project prepare start <backend>',
    );
    expect(claude).toContain('# Existing Notes');
    expect(claude).toContain('Keep this section.');
    expect(claude).not.toContain('<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->');
    expect(claude.endsWith('@.claude/1MCP.md\n')).toBe(true);
    const skill = path.join(environment.getTempDir(), '.claude/skills/1mcp-preparation-setup');
    expect(await readFile(path.join(skill, 'SKILL.md'), 'utf8')).toContain('name: 1mcp-preparation-setup');
  });
});
