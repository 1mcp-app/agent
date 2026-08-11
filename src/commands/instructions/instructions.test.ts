import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { instructionsCommand } from './instructions.js';

const mockedGetInspectResult = vi.hoisted(() => vi.fn());
const mockedStdoutWrite = vi.hoisted(() => vi.fn());
const mockedAttachReusableClientSurface = vi.hoisted(() => vi.fn());
const mockedApiGet = vi.hoisted(() => vi.fn());

vi.mock('@src/commands/inspect/inspect.js', () => ({
  getInspectResult: mockedGetInspectResult,
}));

vi.mock('@src/commands/shared/clientSurfaceAttachment.js', () => ({
  attachReusableClientSurface: mockedAttachReusableClientSurface,
  formatClientSurfaceAuthRequiredMessage: vi.fn(() => 'Authentication required'),
}));

vi.mock('@src/commands/shared/apiClient.js', () => ({
  ApiClient: vi.fn(function () {
    return { get: mockedApiGet };
  }),
}));

describe('instructions command', () => {
  beforeEach(() => {
    mockedGetInspectResult.mockReset();
    mockedStdoutWrite.mockReset();
    mockedAttachReusableClientSurface.mockReset();
    mockedApiGet.mockReset();
    mockedAttachReusableClientSurface.mockResolvedValue({
      status: 'success',
      protocol: 'mcp',
      value: { kind: 'legacy_runtime' },
    });

    vi.stubGlobal('process', {
      ...process,
      stdout: {
        ...process.stdout,
        write: mockedStdoutWrite,
      },
    });
  });

  it('writes the exact runtime-rendered CLI instructions without inspecting servers', async () => {
    const rendered = 'managed cli instructions\nwith exact spacing';
    mockedApiGet.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { rendered, templateIdentity: 'team', fallback: false },
    });
    useAttachmentCallbacks();

    await instructionsCommand({ context: 'prod', preset: 'coding' } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(`${rendered}\n`);
    expect(mockedGetInspectResult).not.toHaveBeenCalled();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/v1/instructions', { preset: 'coding' });
    expect(mockedAttachReusableClientSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSurface: 'instructions',
        version: 'instructions',
        alwaysTryRest: true,
        options: expect.objectContaining({ context: 'prod', preset: 'coding' }),
      }),
    );
  });

  it('falls back to the inspect formatter only when the runtime lacks the operation', async () => {
    mockedApiGet.mockResolvedValueOnce({ ok: false, status: 404, error: 'HTTP 404' });
    useAttachmentCallbacks();
    mockedGetInspectResult.mockResolvedValueOnce({ kind: 'servers', servers: [] });

    await instructionsCommand({ context: 'old-runtime' } as never);

    expect(mockedGetInspectResult).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ok: false, status: 0, error: 'connection refused' }, 'connection refused'],
    [{ ok: false, status: 500, error: 'runtime failure' }, 'runtime failure'],
    [{ ok: false, status: 401, error: 'unauthorized' }, 'Authentication required'],
  ])('propagates runtime attachment errors instead of using compatibility fallback', async (apiResponse, message) => {
    mockedApiGet.mockResolvedValueOnce(apiResponse);
    useAttachmentCallbacks();

    await expect(instructionsCommand({ context: 'prod' } as never)).rejects.toThrow(message);
    expect(mockedGetInspectResult).not.toHaveBeenCalled();
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
    expect(mockedGetInspectResult).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        'config-dir': '.tmp-test/instructions-command',
      }),
      { includeServerInstructions: true, clientSurface: 'instructions' },
    );
  });

  it('eagerly inspects unavailable template servers to load contextual instructions', async () => {
    mockedGetInspectResult
      .mockResolvedValueOnce({
        kind: 'servers',
        servers: [
          {
            server: 'serena',
            type: 'template',
            status: 'unknown',
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

    expect(mockedGetInspectResult).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        'config-dir': '.tmp-test/instructions-command',
        target: 'serena',
      }),
      { includeServerInstructions: true, clientSurface: 'instructions' },
    );
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('<server_instructions name="serena">'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('# Serena Instructions'));
  });

  it('falls back to a template-specific unavailable note when contextual initialization fails', async () => {
    mockedGetInspectResult
      .mockResolvedValueOnce({
        kind: 'servers',
        servers: [
          {
            server: 'serena',
            type: 'template',
            status: 'unknown',
            available: false,
            toolCount: 0,
            hasInstructions: false,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('Server unavailable'));

    await instructionsCommand({ 'config-dir': '.tmp-test/instructions-command' } as never);

    expect(mockedStdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining(
        '<note>(unavailable: template server could not be initialized with the current context)</note>',
      ),
    );
  });

  it('renders cached server instructions for disconnected servers from the all-servers payload', async () => {
    mockedGetInspectResult.mockResolvedValueOnce({
      kind: 'servers',
      servers: [
        {
          server: 'serena',
          type: 'external',
          status: 'disconnected',
          available: false,
          toolCount: 0,
          hasInstructions: true,
        },
      ],
      serverInstructions: {
        serena: '# Serena Instructions\nUse Serena first.',
      },
    });

    await instructionsCommand({ 'config-dir': '.tmp-test/instructions-command' } as never);

    expect(mockedGetInspectResult).toHaveBeenCalledTimes(1);
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('<server_instructions name="serena">'));
    expect(mockedStdoutWrite).toHaveBeenCalledWith(expect.stringContaining('# Serena Instructions'));
    expect(mockedStdoutWrite).not.toHaveBeenCalledWith(
      expect.stringContaining('<note>(unavailable: server is not currently connected)</note>'),
    );
  });
});

function useAttachmentCallbacks(): void {
  mockedAttachReusableClientSurface.mockImplementationOnce(async (input) => {
    const context = {
      options: input.options,
      baseUrl: 'https://runtime.example',
      serverUrl: new URL('https://runtime.example/mcp'),
      sessionId: 'session-id',
      requestSessionId: 'session-id',
      context: { sessionId: 'session-id' },
      contextHash: 'context-hash',
      contextProof: undefined,
      bearerToken: 'token',
      target: { runtimeTargetContext: { name: 'prod', kind: 'remote' } },
      cachePath: '/tmp/cache',
      cachedSession: null,
    };
    const restResult = await input.rest(context);
    if (restResult.status === 'success') {
      return { status: 'success', protocol: 'rest', value: restResult.value };
    }
    if (restResult.status === 'fallback') {
      const mcpResult = await input.mcp(context);
      return { status: 'success', protocol: 'mcp', value: mcpResult.value };
    }
    return { status: restResult.status, message: restResult.message };
  });
}
