import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listToolsCommand, toolsCommand } from './tools.js';

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
  getEffectiveServerTargetConfig: vi.fn(),
  getAllServers: vi.fn(),
  getAllServerTargets: vi.fn(),
  getServer: vi.fn(),
  initializeConfigContext: vi.fn(),
  reloadMcpConfig: vi.fn(),
  resolveServerTarget: vi.fn(),
  serverExists: vi.fn(),
  serverTargetExists: vi.fn(),
  setResolvedServerTarget: vi.fn(),
  setServer: vi.fn(),
  validateConfigPath: vi.fn(),
}));

vi.mock('@src/utils/ui/printer.js', () => ({
  default: mockPrinter,
}));

vi.mock('./utils/mcpServerConfig.js', () => ({
  backupConfig: configState.backupConfig,
  getEffectiveServerTargetConfig: configState.getEffectiveServerTargetConfig,
  getAllServers: configState.getAllServers,
  getAllServerTargets: configState.getAllServerTargets,
  getServer: configState.getServer,
  initializeConfigContext: configState.initializeConfigContext,
  reloadMcpConfig: configState.reloadMcpConfig,
  resolveServerTarget: configState.resolveServerTarget,
  serverExists: configState.serverExists,
  serverTargetExists: configState.serverTargetExists,
  setResolvedServerTarget: configState.setResolvedServerTarget,
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
    configState.getAllServerTargets.mockReturnValue(servers);
    configState.getEffectiveServerTargetConfig.mockImplementation(
      (serverName: string) => servers[serverName as keyof typeof servers] ?? null,
    );
    configState.serverExists.mockImplementation((serverName: string) => serverName in servers);
    configState.serverTargetExists.mockImplementation((serverName: string) => serverName in servers);
    configState.getServer.mockImplementation((serverName: string) => servers[serverName as keyof typeof servers]);
    configState.resolveServerTarget.mockImplementation((serverName: string) => {
      const serverConfig = servers[serverName as keyof typeof servers];
      if (!serverConfig) {
        return null;
      }

      return {
        serverName,
        source: 'mcpServers',
        serverConfig,
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'good-server',
        source: 'mcpServers',
      }),
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
    expect(configState.reloadMcpConfig).not.toHaveBeenCalled();
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

  it('connects interactive tool selection with the effective target config', async () => {
    configState.getAllServerTargets.mockReturnValue({
      'inherited-server': {
        type: 'stdio',
        command: 'echo',
      },
    });
    configState.serverTargetExists.mockReturnValue(true);
    configState.getEffectiveServerTargetConfig.mockReturnValue({
      type: 'stdio',
      command: 'echo',
      env: { SHARED: 'global' },
      inheritParentEnv: true,
    });
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'inherited-server',
      source: 'mcpServers',
      serverConfig: {
        type: 'stdio',
        command: 'echo',
      },
    });

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

    await toolsCommand(
      {
        server: 'inherited-server',
        config: '/tmp/test-config.json',
      },
      {
        connectionHelperFactory: () =>
          ({
            connectToServers,
            cleanup: vi.fn().mockResolvedValue(undefined),
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

    expect(connectToServers).toHaveBeenCalledWith({
      'inherited-server': {
        type: 'stdio',
        command: 'echo',
        env: { SHARED: 'global' },
        inheritParentEnv: true,
      },
    });
  });

  it('enables a disabled tool and leaves runtime reload to serve hot reload', async () => {
    configState.serverExists.mockReturnValue(true);
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'good-server',
      source: 'mcpServers',
      serverConfig: {
        command: 'echo',
        args: ['good'],
        disabledTools: ['write_file'],
      },
    });

    const { enableToolCommand } = await import('./tools.js');

    await enableToolCommand({
      server: 'good-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'good-server',
        source: 'mcpServers',
      }),
      expect.not.objectContaining({
        disabledTools: expect.arrayContaining(['write_file']),
      }),
    );
    expect(configState.reloadMcpConfig).not.toHaveBeenCalled();
    expect(mockPrinter.success).toHaveBeenCalledWith("Successfully enabled tool 'write_file' on server 'good-server'");
    expect(mockPrinter.info).toHaveBeenCalledWith(
      'Running 1MCP serve instances reload mcp.json changes automatically when config reload is enabled.',
    );
  });

  it('enables a tool when disabledTools stores the qualified name', async () => {
    configState.serverExists.mockReturnValue(true);
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'good-server',
      source: 'mcpServers',
      serverConfig: {
        command: 'echo',
        args: ['good'],
        disabledTools: ['good-server_1mcp_write_file'],
      },
    });

    const { enableToolCommand } = await import('./tools.js');

    await enableToolCommand({
      server: 'good-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'good-server',
        source: 'mcpServers',
      }),
      expect.not.objectContaining({
        disabledTools: expect.arrayContaining(['good-server_1mcp_write_file', 'write_file']),
      }),
    );
    expect(mockPrinter.info).not.toHaveBeenCalledWith("Tool 'write_file' is already enabled on server 'good-server'.");
  });

  it('treats a qualified disabled tool as already disabled', async () => {
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'good-server',
      source: 'mcpServers',
      serverConfig: {
        command: 'echo',
        args: ['good'],
        disabledTools: ['good-server_1mcp_write_file'],
      },
    });

    const { disableToolCommand } = await import('./tools.js');

    await disableToolCommand({
      server: 'good-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).not.toHaveBeenCalled();
    expect(mockPrinter.info).toHaveBeenCalledWith("Tool 'write_file' is already disabled on server 'good-server'.");
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
    expect(configState.setResolvedServerTarget).not.toHaveBeenCalled();
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
    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'good-server',
        source: 'mcpServers',
      }),
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it('waits for helper cleanup to settle before completing the interactive save flow', async () => {
    vi.useFakeTimers();

    const prompt = vi.fn().mockResolvedValue({
      selected: [],
    });
    const cleanup = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        }),
    );

    const commandPromise = toolsCommand(
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

    await Promise.resolve();
    expect(prompt).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    await commandPromise;

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'good-server',
        source: 'mcpServers',
      }),
      expect.objectContaining({
        disabledTools: ['read_file', 'write_file'],
      }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disables a tool in a template-only server entry', async () => {
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'template-server',
      source: 'mcpTemplates',
      serverConfig: {
        command: 'echo',
        args: ['template'],
      },
    });

    const { disableToolCommand } = await import('./tools.js');

    await disableToolCommand({
      server: 'template-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'template-server',
        source: 'mcpTemplates',
      }),
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
  });

  it('disables a tool in the template entry when static and template names collide', async () => {
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'shared-server',
      source: 'mcpTemplates',
      serverConfig: {
        command: 'echo',
        args: ['template'],
      },
    });

    const { disableToolCommand } = await import('./tools.js');

    await disableToolCommand({
      server: 'shared-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'shared-server',
        source: 'mcpTemplates',
      }),
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
  });

  it('enables a tool from the template entry when static and template names collide', async () => {
    configState.serverTargetExists.mockReturnValue(true);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'shared-server',
      source: 'mcpTemplates',
      serverConfig: {
        command: 'echo',
        args: ['template'],
        disabledTools: ['write_file'],
      },
    });

    const { enableToolCommand } = await import('./tools.js');

    await enableToolCommand({
      server: 'shared-server',
      tool: 'write_file',
      config: '/tmp/test-config.json',
      'config-dir': '/tmp',
    });

    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'shared-server',
        source: 'mcpTemplates',
      }),
      expect.not.objectContaining({
        disabledTools: expect.arrayContaining(['write_file']),
      }),
    );
  });

  it('persists interactive tool selection to the template entry when names collide', async () => {
    const templateServerConfig = {
      command: 'echo',
      args: ['template'],
    };

    configState.getAllServerTargets.mockReturnValue({
      'shared-server': templateServerConfig,
    });
    configState.serverTargetExists.mockReturnValue(true);
    configState.getEffectiveServerTargetConfig.mockReturnValue(templateServerConfig);
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'shared-server',
      source: 'mcpTemplates',
      serverConfig: templateServerConfig,
    });

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

    await toolsCommand(
      {
        server: 'shared-server',
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

    expect(connectToServers).toHaveBeenCalledWith({
      'shared-server': templateServerConfig,
    });
    expect(configState.setResolvedServerTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'shared-server',
        source: 'mcpTemplates',
      }),
      expect.objectContaining({
        disabledTools: ['write_file'],
      }),
    );
  });

  it('preselects tools as disabled when config stores qualified names', async () => {
    configState.getAllServerTargets.mockReturnValue({
      'good-server': {
        command: 'echo',
        args: ['good'],
        disabledTools: ['good-server_1mcp_write_file'],
      },
    });
    configState.getEffectiveServerTargetConfig.mockReturnValue({
      command: 'echo',
      args: ['good'],
      disabledTools: ['good-server_1mcp_write_file'],
    });
    configState.resolveServerTarget.mockReturnValue({
      serverName: 'good-server',
      source: 'mcpServers',
      serverConfig: {
        command: 'echo',
        args: ['good'],
        disabledTools: ['good-server_1mcp_write_file'],
      },
    });

    const prompt = vi.fn().mockResolvedValue({
      selected: ['read_file'],
    });

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
            cleanup: vi.fn().mockResolvedValue(undefined),
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

    const multiselectCall = prompt.mock.calls[0]?.[0];
    expect(multiselectCall?.choices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'read_file', selected: true }),
        expect.objectContaining({ value: 'write_file', selected: false }),
      ]),
    );
  });

  it('lists disabled tools from the template entry when names collide', async () => {
    configState.serverTargetExists.mockReturnValue(true);
    configState.getAllServerTargets.mockReturnValue({
      'shared-server': {
        command: 'echo',
        args: ['template'],
        disabledTools: ['template_tool'],
      },
    });

    await listToolsCommand({
      server: 'shared-server',
      disabled: true,
      config: '/tmp/test-config.json',
    });

    expect(mockPrinter.list).toHaveBeenCalledWith(['template_tool']);
  });
});
