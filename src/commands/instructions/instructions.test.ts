import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instructionsCommand } from './instructions.js';

const mockedGetInspectResult = vi.hoisted(() => vi.fn());
const mockedStdoutWrite = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/inspect/inspect.js', () => ({
  getInspectResult: mockedGetInspectResult,
}));

describe('instructions command', () => {
  beforeEach(() => {
    mockedGetInspectResult.mockReset();
    mockedStdoutWrite.mockReset();

    vi.stubGlobal('process', {
      ...process,
      stdout: {
        ...process.stdout,
        write: mockedStdoutWrite,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the layered CLI playbook and tagged server instructions', async () => {
    mockedGetInspectResult
      .mockResolvedValueOnce({
        kind: 'servers',
        servers: [
          {
            server: 'serena',
            type: 'template',
            status: 'connected',
            available: true,
            toolCount: 1,
            hasInstructions: true,
          },
          {
            server: 'runner',
            type: 'external',
            status: 'disconnected',
            available: false,
            toolCount: 0,
            hasInstructions: false,
          },
        ],
      })
      .mockResolvedValueOnce({
        kind: 'server',
        server: 'serena',
        type: 'template',
        status: 'connected',
        available: true,
        instructions: '# Serena Instructions\nUse Serena first.',
        tools: [
          {
            tool: 'find_symbol',
            qualifiedName: 'serena_1mcp_find_symbol',
            requiredArgs: 1,
            optionalArgs: 0,
          },
        ],
        totalTools: 1,
        hasMore: false,
      });

    await instructionsCommand({ 'config-dir': '.tmp-test/instructions-command' } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('1MCP CLI Instructions'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('=== SERVER SUMMARY ==='));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('=== SERVER DETAILS ==='));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('<server_instructions name="serena">'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('# Serena Instructions'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('<note>(unavailable: server is not currently connected)</note>'),
    );
    expect(mockedGetInspectResult).toHaveBeenCalledTimes(2);
  });
});
