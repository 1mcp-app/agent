import { describe, expect, it } from 'vitest';

import {
  assembleInstructionDetail,
  renderManagedDocContent,
  renderStartupDocManagedBlock,
  shouldEagerlyInspectServer,
  upsertStartupDocManagedBlock,
} from './instructionsDistribution.js';

describe('instructionsDistribution', () => {
  it('eagerly inspects template servers even when unavailable', () => {
    expect(
      shouldEagerlyInspectServer({
        server: 'serena',
        type: 'template',
        available: false,
        status: 'unknown',
        toolCount: 0,
        hasInstructions: false,
      }),
    ).toBe(true);
  });

  it('eagerly inspects connected static servers and skips disconnected static servers', () => {
    expect(
      shouldEagerlyInspectServer({
        server: 'runner',
        type: 'external',
        available: true,
        status: 'connected',
        toolCount: 1,
        hasInstructions: false,
      }),
    ).toBe(true);

    expect(
      shouldEagerlyInspectServer({
        server: 'runner',
        type: 'external',
        available: false,
        status: 'disconnected',
        toolCount: 0,
        hasInstructions: true,
      }),
    ).toBe(false);
  });

  it('assembles detail from a successful inspect result without changing the public detail shape', () => {
    expect(
      assembleInstructionDetail({
        summary: {
          server: 'serena',
          type: 'template',
          status: 'unknown',
          available: false,
          toolCount: 0,
          hasInstructions: false,
        },
        inspected: {
          kind: 'server',
          server: 'serena',
          type: 'template',
          status: 'connected',
          available: true,
          instructions: '# Serena Instructions',
          tools: [
            {
              tool: 'find_symbol',
              qualifiedName: 'serena_1mcp_find_symbol',
              requiredArgs: 1,
              optionalArgs: 0,
            },
          ],
          totalTools: 1,
        },
      }),
    ).toEqual({
      server: 'serena',
      type: 'template',
      status: 'connected',
      available: true,
      toolCount: 1,
      hasInstructions: true,
      instructions: '# Serena Instructions',
      note: undefined,
    });
  });

  it('uses cached instructions for disconnected servers instead of requiring detail inspection', () => {
    expect(
      assembleInstructionDetail({
        summary: {
          server: 'runner',
          type: 'external',
          status: 'disconnected',
          available: false,
          toolCount: 0,
          hasInstructions: true,
        },
        cachedInstructions: '# Cached Runner Instructions',
      }),
    ).toEqual({
      server: 'runner',
      type: 'external',
      status: 'disconnected',
      available: false,
      toolCount: 0,
      hasInstructions: true,
      instructions: '# Cached Runner Instructions',
      note: '(unavailable: server is not currently connected)',
    });
  });

  it('renders template initialization failure notes', () => {
    expect(
      assembleInstructionDetail({
        summary: {
          server: 'serena',
          type: 'template',
          status: 'unknown',
          available: false,
          toolCount: 0,
          hasInstructions: false,
        },
        inspectFailed: true,
      }).note,
    ).toBe('(unavailable: template server could not be initialized with the current context)');
  });

  it('renders managed doc content for startup bootstrapping', () => {
    const content = renderManagedDocContent();

    expect(content).toContain('If this session already received the current 1MCP instructions content from hooks');
    expect(content).toContain('Otherwise, run `1mcp instructions` before using any 1MCP-managed MCP servers.');
    expect(content).toContain('Run `1mcp inspect <server>` before selecting a tool.');
  });

  it('renders global Codex startup references as absolute managed-doc references', () => {
    expect(renderStartupDocManagedBlock('/tmp/.codex/AGENTS.md', '/tmp/.codex/1MCP.md')).toBe('@/tmp/.codex/1MCP.md\n');
  });

  it('renders Claude startup references relative to the startup doc', () => {
    expect(renderStartupDocManagedBlock('/tmp/.claude/CLAUDE.md', '/tmp/.claude/1MCP.md')).toBe('@1MCP.md\n');
  });

  it('replaces legacy relative Codex references when the canonical reference is absolute', () => {
    const block = renderStartupDocManagedBlock('/tmp/.codex/AGENTS.md', '/tmp/.codex/1MCP.md');

    expect(upsertStartupDocManagedBlock('# Existing\n@1MCP.md\n', block)).toBe('# Existing\n@/tmp/.codex/1MCP.md\n');
  });
});
