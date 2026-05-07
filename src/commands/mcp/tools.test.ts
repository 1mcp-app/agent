import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toolsCommand } from './tools.js';

const mockPrinter = vi.hoisted(() => ({
  blank: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  keyValue: vi.fn(),
  list: vi.fn(),
  success: vi.fn(),
  subtitle: vi.fn(),
  title: vi.fn(),
}));

const configState = vi.hoisted(() => ({
  backupConfig: vi.fn(() => '/tmp/test-backup.json'),
  getAllServers: vi.fn(),
  getServer: vi.fn(),
  initializeConfigContext: vi.fn(),
  reloadMcpConfig: vi.fn(),
  serverExists: vi.fn(),
  setServer: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('@src/utils/ui/printer.js', () => ({
  default: mockPrinter,
}));

vi.mock('./utils/mcpServerConfig.js', () => ({
  backupConfig: configState.backupConfig,
  getAllServers: configState.getAllServers,
  getServer: configState.getServer,
  initializeConfigContext: configState.initializeConfigContext,
  reloadMcpConfig: configState.reloadMcpConfig,
  serverExists: configState.serverExists,
  setServer: configState.setServer,
  validateConfigPath: configState.validateConfigPath,
}));

describe('toolsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const servers = {
      'bad-server': {
        command: 'echo',
        args: ['bad'],
      },
      'good-server': {
        command: 'echo',
        args: ['good'],
      },
    };

    configState.getAllServers.mockReturnValue(servers);
    configState.serverExists.mockImplementation((serverName: string) => serverName in servers);
    configState.getServer.mockImplementation((serverName: string) => servers[serverName as keyof typeof servers]);
  });

  it('persists disabled tools from interactive selection', async () => {
    const prompt = vi.fn().mockResolvedValue({
      selected: ['read_file'],
    });

    const connectToServers = vi.fn().mockResolvedValue([
      {
        connected: true,
        tools: [
          { name: 'read_file', inputSchema: { type: 'object' } },
          { name: 'write_file', inputSchema: { type: 'object' } },
        ] satisfies Tool[],
      },
    ]);

    const cleanup = vi.fn().mockResolvedValue(undefined);
    const estimateServerTokens = vi.fn().mockReturnValue({
      breakdown: {
        tools: [
          { name: 'read_file', tokens: 90 },
          { name: 'write_file', tokens: 140 },
        ],
      },
    });

    await toolsCommand(
      {
        server: 'good-server',
        config: '/tmp/test-config.json',
      },
      {
        connectionHelperFactory: () =>
          ({
            connectToServers,
            cleanup,
          }) as any,
        tokenServiceFactory: () =>
          ({
            estimateServerTokens,
          }) as any,
        isInteractiveTerminal: () => true,
        prompt: prompt as any,
      },
    );

    expect(connectToServers).toHaveBeenCalledWith({
      'good-server': {
        command: 'echo',
        args: ['good'],
      },
    });
    expect(configState.backupConfig).toHaveBeenCalled();
    expect(configState.setServer).toHaveBeenCalledWith(
      'good-server',
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
    expect(configState.reloadMcpConfig).toHaveBeenCalled();
    expect(mockPrinter.success).toHaveBeenCalledWith("Saved tool selection for server 'good-server'");
    expect(mockPrinter.info).toHaveBeenCalledWith(
      'Running 1MCP serve instances reload mcp.json changes automatically when config reload is enabled.',
    );
    expect(mockPrinter.keyValue).toHaveBeenCalledWith(
      expect.objectContaining({
        'Changed tools': 1,
        Saved: '~140 tokens per request (60.9%)',
      }),
    );
    expect(cleanup).toHaveBeenCalled();
  });

  it('enables a disabled tool and leaves runtime reload to serve hot reload', async () => {
    configState.serverExists.mockReturnValue(true);
    configState.getServer.mockReturnValue({
      command: 'echo',
      args: ['good'],
      disabledTools: ['write_file'],
    });

    const { enableToolCommand } = await import('./tools.js');

    await enableToolCommand({
      server: 'good-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setServer).toHaveBeenCalledWith(
      'good-server',
      expect.not.objectContaining({
        disabledTools: expect.arrayContaining(['write_file']),
      }),
    );
    expect(configState.reloadMcpConfig).toHaveBeenCalled();
    expect(mockPrinter.success).toHaveBeenCalledWith("Successfully enabled tool 'write_file' on server 'good-server'");
    expect(mockPrinter.info).toHaveBeenCalledWith(
      'Running 1MCP serve instances reload mcp.json changes automatically when config reload is enabled.',
    );
  });

  it('does not write config when selection is unchanged', async () => {
    const prompt = vi.fn().mockResolvedValue({
      selected: ['read_file', 'write_file'],
    });

    const cleanup = vi.fn().mockResolvedValue(undefined);

    await toolsCommand(
      {
        server: 'good-server',
        config: '/tmp/test-config.json',
      },
      {
        connectionHelperFactory: () =>
          ({
            connectToServers: vi.fn().mockResolvedValue([
              {
                connected: true,
                tools: [
                  { name: 'read_file', inputSchema: { type: 'object' } },
                  { name: 'write_file', inputSchema: { type: 'object' } },
                ] satisfies Tool[],
              },
            ]),
            cleanup,
          }) as any,
        tokenServiceFactory: () =>
          ({
            estimateServerTokens: vi.fn().mockReturnValue({
              breakdown: {
                tools: [
                  { name: 'read_file', tokens: 90 },
                  { name: 'write_file', tokens: 140 },
                ],
              },
            }),
          }) as any,
        isInteractiveTerminal: () => true,
        prompt: prompt as any,
      },
    );

    expect(configState.backupConfig).not.toHaveBeenCalled();
    expect(configState.setServer).not.toHaveBeenCalled();
    expect(mockPrinter.info).toHaveBeenCalledWith("No tool changes to save for server 'good-server'.");
    expect(cleanup).toHaveBeenCalled();
  });

  it('re-prompts for a different server after a connection failure', async () => {
    const prompt = vi
      .fn()
      .mockResolvedValueOnce({ server: 'bad-server' })
      .mockResolvedValueOnce({ server: 'good-server' })
      .mockResolvedValueOnce({ selected: ['read_file'] });

    const cleanup = vi.fn().mockResolvedValue(undefined);
    const connectToServers = vi.fn().mockImplementation(async (servers: Record<string, unknown>) => {
      const serverName = Object.keys(servers)[0];
      if (serverName === 'bad-server') {
        return [
          {
            connected: false,
            tools: [],
            error: 'boom',
          },
        ];
      }

      return [
        {
          connected: true,
          tools: [
            { name: 'read_file', inputSchema: { type: 'object' } },
            { name: 'write_file', inputSchema: { type: 'object' } },
          ] satisfies Tool[],
        },
      ];
    });

    await toolsCommand(
      {
        config: '/tmp/test-config.json',
      },
      {
        connectionHelperFactory: () =>
          ({
            connectToServers,
            cleanup,
          }) as any,
        tokenServiceFactory: () =>
          ({
            estimateServerTokens: vi.fn().mockReturnValue({
              breakdown: {
                tools: [
                  { name: 'read_file', tokens: 90 },
                  { name: 'write_file', tokens: 140 },
                ],
              },
            }),
          }) as any,
        isInteractiveTerminal: () => true,
        prompt: prompt as any,
      },
    );

    expect(mockPrinter.error).toHaveBeenCalledWith("Unable to load tools for 'bad-server': boom");
    expect(configState.setServer).toHaveBeenCalledWith(
      'good-server',
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
    expect(prompt).toHaveBeenCalledTimes(3);
  });
});
