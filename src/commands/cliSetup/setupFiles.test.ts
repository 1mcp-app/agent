import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatCliSetupOutput,
  renderManagedDocContent,
  renderStartupDocManagedBlock,
  resolveCliSetupScope,
  upsertStartupDocManagedBlock,
  writeCliSetupFiles,
} from './setupFiles.js';

const loggerState = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: loggerState,
}));

describe('cli setup file writers', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    loggerState.warn.mockReset();
    await Promise.all(tempRoots.map((tempRoot) => rm(tempRoot, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it('parses scope values', () => {
    expect(resolveCliSetupScope()).toBe('global');
    expect(resolveCliSetupScope('repo')).toBe('repo');
    expect(() => resolveCliSetupScope('workspace')).toThrow('Invalid cli-setup scope: workspace');
  });

  it('renders managed doc content with conditional instructions guidance', () => {
    const content = renderManagedDocContent();

    expect(content).toContain('If this session already received the current 1MCP instructions content from hooks');
    expect(content).toContain('Otherwise, run `1mcp instructions` before using any 1MCP-managed MCP servers.');
    expect(content).toContain('Run `1mcp inspect <server>` before selecting a tool.');
  });

  it('upserts a reference-only startup block', () => {
    const block = renderStartupDocManagedBlock('/tmp/.claude/CLAUDE.md', '/tmp/.claude/1MCP.md');
    const updated = upsertStartupDocManagedBlock('# Existing\n', block);

    expect(block).toBe('@1MCP.md\n');
    expect(updated).toContain('# Existing');
    expect(updated).not.toContain('<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->');
    expect(updated).toBe('# Existing\n@1MCP.md\n');
  });

  it('renders an absolute startup reference for global codex', () => {
    const block = renderStartupDocManagedBlock('/tmp/.codex/AGENTS.md', '/tmp/.codex/1MCP.md');

    expect(block).toBe('@/tmp/.codex/1MCP.md\n');
  });

  it('replaces legacy relative codex startup reference with absolute path', () => {
    const block = renderStartupDocManagedBlock('/tmp/.codex/AGENTS.md', '/tmp/.codex/1MCP.md');
    const updated = upsertStartupDocManagedBlock('# Existing\n@1MCP.md\n', block);

    expect(updated).toBe('# Existing\n@/tmp/.codex/1MCP.md\n');
  });

  it('writes repo-scoped hooks, startup docs, and managed doc idempotently', async () => {
    const repoRoot = path.join(process.cwd(), '.tmp-test', `cli-setup-unit-${Date.now()}`);
    tempRoots.push(repoRoot);
    await mkdir(repoRoot, { recursive: true });

    const first = await writeCliSetupFiles({
      repoRoot,
      scope: 'repo',
      targets: ['codex', 'claude'],
    });
    const second = await writeCliSetupFiles({
      repoRoot,
      scope: 'repo',
      targets: ['codex', 'claude'],
    });

    expect(first.every((result) => result.changed)).toBe(true);
    expect(second.every((result) => !result.changed)).toBe(true);

    const codexManagedDoc = await readFile(path.join(repoRoot, '.codex', '1MCP.md'), 'utf8');
    const claudeManagedDoc = await readFile(path.join(repoRoot, '.claude', '1MCP.md'), 'utf8');
    const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const claude = await readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
    const codexHooks = JSON.parse(await readFile(path.join(repoRoot, '.codex', 'hooks.json'), 'utf8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    const claudeSettings = JSON.parse(await readFile(path.join(repoRoot, '.claude', 'settings.json'), 'utf8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };

    expect(codexManagedDoc).toContain('do not run `1mcp instructions` again');
    expect(claudeManagedDoc).toContain('do not run `1mcp instructions` again');
    expect(agents).not.toContain('<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->');
    expect(claude).not.toContain('<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->');
    expect(agents).toBe('@.codex/1MCP.md\n');
    expect(claude).toBe('@.claude/1MCP.md\n');
    expect(
      codexHooks.hooks.SessionStart.flatMap((entry) => entry.hooks).filter(
        (hook) => hook.command === '1mcp instructions',
      ),
    ).toHaveLength(1);
    expect(
      claudeSettings.hooks.SessionStart.flatMap((entry) => entry.hooks).filter(
        (hook) => hook.command === '1mcp instructions',
      ),
    ).toHaveLength(1);
  });

  it('preserves unrelated existing config while deduplicating managed hooks', async () => {
    const repoRoot = path.join(process.cwd(), '.tmp-test', `cli-setup-merge-${Date.now()}`);
    tempRoots.push(repoRoot);
    await mkdir(path.join(repoRoot, '.codex'), { recursive: true });
    await mkdir(path.join(repoRoot, '.claude'), { recursive: true });
    await writeFile(
      path.join(repoRoot, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: 'startup|resume',
                hooks: [
                  { type: 'command', command: '1mcp instructions' },
                  { type: 'command', command: 'echo hello' },
                ],
              },
              {
                matcher: 'startup|resume',
                hooks: [{ type: 'command', command: '1mcp instructions' }],
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    await writeFile(
      path.join(repoRoot, '.claude', 'settings.json'),
      JSON.stringify(
        {
          enabledPlugins: { 'typescript-lsp@claude-plugins-official': true },
          hooks: {
            SessionStart: [
              {
                hooks: [
                  { type: 'command', command: '1mcp instructions' },
                  { type: 'command', command: 'echo keep-me' },
                ],
              },
              {
                hooks: [{ type: 'command', command: '1mcp instructions' }],
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    await writeCliSetupFiles({
      repoRoot,
      scope: 'repo',
      targets: ['codex', 'claude'],
    });

    const codexHooks = JSON.parse(await readFile(path.join(repoRoot, '.codex', 'hooks.json'), 'utf8')) as {
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };
    const claudeSettings = JSON.parse(await readFile(path.join(repoRoot, '.claude', 'settings.json'), 'utf8')) as {
      enabledPlugins: Record<string, boolean>;
      hooks: { SessionStart: Array<{ hooks: Array<{ command: string }> }> };
    };

    expect(
      codexHooks.hooks.SessionStart.flatMap((entry) => entry.hooks).filter(
        (hook) => hook.command === '1mcp instructions',
      ),
    ).toHaveLength(1);
    expect(
      codexHooks.hooks.SessionStart.flatMap((entry) => entry.hooks).some((hook) => hook.command === 'echo hello'),
    ).toBe(true);
    expect(claudeSettings.enabledPlugins['typescript-lsp@claude-plugins-official']).toBe(true);
    expect(
      claudeSettings.hooks.SessionStart.flatMap((entry) => entry.hooks).filter(
        (hook) => hook.command === '1mcp instructions',
      ),
    ).toHaveLength(1);
    expect(
      claudeSettings.hooks.SessionStart.flatMap((entry) => entry.hooks).some((hook) => hook.command === 'echo keep-me'),
    ).toBe(true);
  });

  it('writes global scope files under the mocked home directory', async () => {
    const homeDir = path.join(process.cwd(), '.tmp-test', `cli-setup-home-${Date.now()}`);
    tempRoots.push(homeDir);
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);

    const results = await writeCliSetupFiles({
      repoRoot: path.join(process.cwd(), '.tmp-test', 'unused-repo-root'),
      scope: 'global',
      targets: ['codex'],
    });

    expect(results.some((result) => result.path === path.join(homeDir, '.codex', 'hooks.json'))).toBe(true);

    const agents = await readFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8');
    expect(agents).toBe(`@${path.join(homeDir, '.codex', '1MCP.md').replace(/\\/g, '/')}\n`);
  });

  it('skips rewriting commented JSON5 config files and warns', async () => {
    const repoRoot = path.join(process.cwd(), '.tmp-test', `cli-setup-comments-${Date.now()}`);
    tempRoots.push(repoRoot);
    await mkdir(path.join(repoRoot, '.claude'), { recursive: true });
    const settingsPath = path.join(repoRoot, '.claude', 'settings.json');
    const original = `{
  // keep this note
  "hooks": {
    "SessionStart": []
  }
}
`;
    await writeFile(settingsPath, original, 'utf8');

    const results = await writeCliSetupFiles({
      repoRoot,
      scope: 'repo',
      targets: ['claude'],
    });

    expect(results.find((result) => result.path === settingsPath)?.changed).toBe(false);
    expect(await readFile(settingsPath, 'utf8')).toBe(original);
    expect(loggerState.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping managed update'));
  });

  it('formats a concise summary', () => {
    const output = formatCliSetupOutput([
      {
        path: '/tmp/.codex/hooks.json',
        changed: true,
        kind: 'hook',
        target: 'codex',
        scope: 'global',
      },
      {
        path: '/tmp/.claude/CLAUDE.md',
        changed: false,
        kind: 'startup-doc',
        target: 'claude',
        scope: 'repo',
      },
    ]);

    expect(output).toContain('Updated 1MCP CLI setup files:');
    expect(output).toContain('[global] hook codex: /tmp/.codex/hooks.json');
    expect(output).toContain('[repo] startup-doc claude: /tmp/.claude/CLAUDE.md (unchanged)');
  });
});
