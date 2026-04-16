import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatStartupDocsOutput,
  renderStartupDocManagedBlock,
  resolveStartupDocTargets,
  STARTUP_DOC_BLOCK_END,
  STARTUP_DOC_BLOCK_START,
  upsertStartupDocManagedBlock,
  writeStartupDocs,
} from './startupDocs.js';

describe('startupDocs', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('renders a stable 1MCP-first bootstrap block', () => {
    const block = renderStartupDocManagedBlock();

    expect(block).toContain(STARTUP_DOC_BLOCK_START);
    expect(block).toContain('# 1MCP Agent Bootstrap');
    expect(block).toContain('Run `1mcp instructions` at the beginning of the session.');
    expect(block).toContain('Run `1mcp inspect <server>` before selecting a tool.');
    expect(block).toContain("Run `1mcp run <server>/<tool> --args '<json>'` only after inspecting the tool schema.");
    expect(block).toContain(STARTUP_DOC_BLOCK_END);
  });

  it('upserts the managed block without removing surrounding user content', () => {
    const existing = [
      '# Team Notes',
      '',
      'Local guidance.',
      '',
      '<!-- BEGIN 1MCP MANAGED STARTUP DOCS -->',
      'stale',
      '<!-- END 1MCP MANAGED STARTUP DOCS -->',
      '',
      'Footer',
    ].join('\n');

    const updated = upsertStartupDocManagedBlock(existing, renderStartupDocManagedBlock());

    expect(updated).toContain('# Team Notes');
    expect(updated).toContain('Footer');
    expect(updated).not.toContain('\nstale\n');
    expect(updated.match(new RegExp(STARTUP_DOC_BLOCK_START, 'g'))).toHaveLength(1);
  });

  it('writes both startup docs and stays idempotent on rerun', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), '1mcp-startup-docs-'));
    tempDirs.push(repoRoot);

    const first = await writeStartupDocs({ repoRoot, targets: resolveStartupDocTargets() });
    const second = await writeStartupDocs({ repoRoot, targets: resolveStartupDocTargets() });

    expect(first.every((result) => result.changed)).toBe(true);
    expect(second.every((result) => !result.changed)).toBe(true);

    const agents = await readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8');
    const claude = await readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8');

    expect(agents).toContain('# 1MCP Agent Bootstrap');
    expect(claude).toContain('# 1MCP Agent Bootstrap');
  });

  it('prepends the managed block to an existing file and preserves custom content', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), '1mcp-startup-docs-'));
    tempDirs.push(repoRoot);

    const claudePath = path.join(repoRoot, 'CLAUDE.md');
    await writeFile(claudePath, '# Existing Claude Notes\n\nKeep this section.\n', 'utf8');

    await writeStartupDocs({ repoRoot, targets: ['claude'] });

    const claude = await readFile(claudePath, 'utf8');
    expect(claude).toContain('# Existing Claude Notes');
    expect(claude.indexOf(STARTUP_DOC_BLOCK_START)).toBeLessThan(claude.indexOf('# Existing Claude Notes'));
  });

  it('parses and validates startup doc targets', () => {
    expect(resolveStartupDocTargets()).toEqual(['agents', 'claude']);
    expect(resolveStartupDocTargets('claude,agents')).toEqual(['claude', 'agents']);
    expect(() => resolveStartupDocTargets('unknown')).toThrow('Invalid startup doc target(s): unknown');
  });

  it('formats a concise write summary', () => {
    const output = formatStartupDocsOutput([
      { path: '/repo/AGENTS.md', target: 'agents', changed: true },
      { path: '/repo/CLAUDE.md', target: 'claude', changed: false },
    ]);

    expect(output).toContain('Updated 1MCP startup docs:');
    expect(output).toContain('- /repo/AGENTS.md');
    expect(output).toContain('- /repo/CLAUDE.md (unchanged)');
  });
});
