import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { AuthProviderTransport, ClientStatus, MCPServerParams } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

const mockState = vi.hoisted(() => ({
  contextChangedHandler: undefined as
    ((data: { newContext?: unknown; sessionIdChanged: boolean }) => Promise<void>) | undefined,
  reprocessTemplatesWithNewContext: vi.fn(),
  updateServersWithNewConfig: vi.fn(),
}));

vi.mock('@src/core/loading/mcpLoadingManager.js', () => ({
  McpLoadingManager: {
    current: {
      loadServer: vi.fn(),
      unloadServer: vi.fn(),
      getStateTracker: vi.fn(() => ({
        getServerState: vi.fn(() => ({ state: LoadingState.Ready })),
      })),
    },
  },
}));

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn(() => ({})),
  },
}));

vi.mock('@src/core/context/globalContextManager.js', () => ({
  getGlobalContextManager: vi.fn(() => ({
    getContext: vi.fn(() => undefined),
    on: vi.fn(
      (event: string, handler: (data: { newContext?: unknown; sessionIdChanged: boolean }) => Promise<void>) => {
        if (event === 'context-changed') {
          mockState.contextChangedHandler = handler;
        }
      },
    ),
  })),
}));

vi.mock('@src/core/filtering/index.js', () => ({
  getFilterCache: vi.fn(() => ({
    getStats: vi.fn(() => ({})),
    clear: vi.fn(),
  })),
  ClientTemplateTracker: vi.fn(),
  FilterCache: vi.fn(),
  TemplateIndex: vi.fn(),
}));

vi.mock('./connectionManager.js', () => ({
  ConnectionManager: vi.fn(function () {
    return {
      setLazyLoadingOrchestrator: vi.fn(),
      getInboundConnections: vi.fn(() => new Map()),
      getTransports: vi.fn(() => new Map()),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock('./templateServerManager.js', () => ({
  TemplateServerManager: vi.fn(function () {
    return {
      setInstructionAggregator: vi.fn(),
      getFilteringStats: vi.fn(() => ({ tracker: null, index: null, enabled: true })),
      getClientTemplateInfo: vi.fn(() => ({})),
      rebuildTemplateIndex: vi.fn(),
      getIdleTemplateInstances: vi.fn(() => []),
      cleanupIdleInstances: vi.fn().mockResolvedValue(0),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('./templateConfigurationManager.js', () => ({
  TemplateConfigurationManager: vi.fn(function () {
    return {
      reprocessTemplatesWithNewContext: mockState.reprocessTemplatesWithNewContext,
      updateServersWithNewConfig: mockState.updateServersWithNewConfig,
      updateServersIndividually: vi.fn(),
      cleanup: vi.fn(),
    };
  }),
}));

vi.mock('./adapters/ServerRegistry.js', () => ({
  ServerRegistry: vi.fn(function () {
    return {};
  }),
}));

describe('ServerManager hot-reload lifecycle facade', () => {
  const serverConfig = { name: '1mcp-test', version: '0.0.0' };
  const serverCapabilities = { capabilities: {} };
  let outboundConns: Map<string, unknown>;
  let transports: Record<string, AuthProviderTransport>;
  let serverManager: ServerManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockState.contextChangedHandler = undefined;
    vi.mocked(McpLoadingManager.current.getStateTracker).mockReturnValue({
      getServerState: vi.fn(() => ({ state: LoadingState.Ready })),
    } as never);
    await ServerManager.resetInstance();
    outboundConns = new Map();
    transports = {};
    serverManager = ServerManager.getOrCreateInstance(
      serverConfig,
      serverCapabilities,
      outboundConns as never,
      transports,
    );
  });

  it('loads through McpLoadingManager and records lifecycle status in one ServerManager entry point', async () => {
    const config: MCPServerParams = {
      command: 'node',
      args: ['server.js'],
      tags: ['runtime'],
    };
    const transport = { close: vi.fn() } as unknown as AuthProviderTransport;

    vi.mocked(McpLoadingManager.current.loadServer).mockImplementationOnce(async () => {
      outboundConns.set('hot-server', {
        name: 'hot-server',
        transport,
        status: ClientStatus.Connected,
      });
      transports['hot-server'] = transport;
    });

    await serverManager.loadMcpServer('hot-server', config);

    expect(McpLoadingManager.current.loadServer).toHaveBeenCalledWith('hot-server', config);
    expect(serverManager.isMcpServerRunning('hot-server')).toBe(true);
    expect(serverManager.getMcpServerStatus().get('hot-server')).toMatchObject({
      running: true,
      config,
    });
  });

  it('records a connected initial-boot server through the same lifecycle facade', () => {
    const config: MCPServerParams = {
      command: 'node',
      args: ['server.js'],
      tags: ['boot'],
    };
    const transport = { close: vi.fn() } as unknown as AuthProviderTransport;

    outboundConns.set('boot-server', {
      name: 'boot-server',
      transport,
      status: ClientStatus.Connected,
    });

    serverManager.recordMcpServerReady('boot-server', config);

    expect(serverManager.isMcpServerRunning('boot-server')).toBe(true);
    expect(serverManager.getMcpServerStatus().get('boot-server')).toMatchObject({
      running: true,
      config,
    });
  });

  it('syncs only connected initial-boot clients into lifecycle status', () => {
    const readyConfig: MCPServerParams = { command: 'node', args: ['ready.js'] };
    const failedConfig: MCPServerParams = { command: 'node', args: ['failed.js'] };
    const oauthConfig: MCPServerParams = { type: 'http', url: 'https://mcp.example.com' };
    const readyTransport = { close: vi.fn() } as unknown as AuthProviderTransport;
    const failedTransport = { close: vi.fn() } as unknown as AuthProviderTransport;
    const oauthTransport = { close: vi.fn() } as unknown as AuthProviderTransport;

    outboundConns.set('ready-server', {
      name: 'ready-server',
      transport: readyTransport,
      status: ClientStatus.Connected,
    });
    outboundConns.set('failed-server', {
      name: 'failed-server',
      transport: failedTransport,
      status: ClientStatus.Error,
    });
    outboundConns.set('oauth-server', {
      name: 'oauth-server',
      transport: oauthTransport,
      status: ClientStatus.AwaitingOAuth,
    });

    serverManager.syncMcpServerLifecycleFromConnectedClients({
      'ready-server': readyConfig,
      'failed-server': failedConfig,
      'oauth-server': oauthConfig,
    });

    expect(serverManager.isMcpServerRunning('ready-server')).toBe(true);
    expect(serverManager.getMcpServerStatus().get('ready-server')).toMatchObject({
      running: true,
      config: readyConfig,
    });
    expect(serverManager.isMcpServerRunning('failed-server')).toBe(false);
    expect(serverManager.isMcpServerRunning('oauth-server')).toBe(false);
  });

  it('does not record lifecycle status when hot-reload load ends in Failed', async () => {
    const config: MCPServerParams = {
      command: 'node',
      args: ['server.js'],
    };
    const transport = { close: vi.fn() } as unknown as AuthProviderTransport;

    vi.mocked(McpLoadingManager.current.getStateTracker).mockReturnValue({
      getServerState: vi.fn(() => ({ state: LoadingState.Failed })),
    } as never);
    vi.mocked(McpLoadingManager.current.loadServer).mockImplementationOnce(async () => {
      outboundConns.set('failed-server', {
        name: 'failed-server',
        transport,
        status: ClientStatus.Error,
      });
      transports['failed-server'] = transport;
    });

    await serverManager.loadMcpServer('failed-server', config);

    expect(serverManager.isMcpServerRunning('failed-server')).toBe(false);
    expect(serverManager.getMcpServerStatus().has('failed-server')).toBe(false);
  });

  it('does not record lifecycle status when hot-reload load is awaiting OAuth', async () => {
    const config: MCPServerParams = {
      type: 'http',
      url: 'https://mcp.example.com',
    };
    const transport = { close: vi.fn() } as unknown as AuthProviderTransport;

    vi.mocked(McpLoadingManager.current.getStateTracker).mockReturnValue({
      getServerState: vi.fn(() => ({ state: LoadingState.AwaitingOAuth })),
    } as never);
    vi.mocked(McpLoadingManager.current.loadServer).mockImplementationOnce(async () => {
      outboundConns.set('oauth-server', {
        name: 'oauth-server',
        transport,
        status: ClientStatus.AwaitingOAuth,
      });
      transports['oauth-server'] = transport;
    });

    await serverManager.loadMcpServer('oauth-server', config);

    expect(serverManager.isMcpServerRunning('oauth-server')).toBe(false);
    expect(serverManager.getMcpServerStatus().has('oauth-server')).toBe(false);
  });

  it('unloads through McpLoadingManager and clears lifecycle status in one ServerManager entry point', async () => {
    const config: MCPServerParams = {
      command: 'node',
      args: ['server.js'],
    };
    const transport = { close: vi.fn() } as unknown as AuthProviderTransport;

    vi.mocked(McpLoadingManager.current.loadServer).mockImplementationOnce(async () => {
      outboundConns.set('hot-server', {
        name: 'hot-server',
        transport,
        status: ClientStatus.Connected,
      });
      transports['hot-server'] = transport;
    });

    await serverManager.loadMcpServer('hot-server', config);
    await serverManager.unloadMcpServer('hot-server');

    expect(McpLoadingManager.current.unloadServer).toHaveBeenCalledWith('hot-server');
    expect(serverManager.isMcpServerRunning('hot-server')).toBe(false);
    expect(serverManager.getMcpServerStatus().has('hot-server')).toBe(false);
  });

  it('routes context template reload callbacks through the hot-reload facade', async () => {
    const addedConfig: MCPServerParams = { command: 'node', args: ['added.js'] };
    const restartedConfig: MCPServerParams = { command: 'node', args: ['changed.js'] };
    const instructionAggregator = {
      on: vi.fn(),
      setLazyLoadingOrchestrator: vi.fn(),
    };
    const loadSpy = vi.spyOn(serverManager, 'loadMcpServer').mockResolvedValue(undefined);
    const unloadSpy = vi.spyOn(serverManager, 'unloadMcpServer').mockResolvedValue(undefined);
    vi.spyOn(serverManager, 'startServer').mockResolvedValue(undefined);
    vi.spyOn(serverManager, 'stopServer').mockResolvedValue(undefined);
    vi.spyOn(serverManager, 'restartServer').mockResolvedValue(undefined);

    mockState.reprocessTemplatesWithNewContext.mockImplementationOnce(async (_context, updateServers) => {
      await updateServers({
        'added-server': addedConfig,
        'restarted-server': restartedConfig,
      });
    });
    mockState.updateServersWithNewConfig.mockImplementationOnce(
      async (_newConfig, _currentServers, startServer, stopServer, restartServer) => {
        await startServer('added-server', addedConfig);
        await stopServer('removed-server');
        await restartServer('restarted-server', restartedConfig);
      },
    );

    serverManager.setInstructionAggregator(instructionAggregator as never);
    await mockState.contextChangedHandler?.({
      newContext: { sessionId: 'ctx-1' },
      sessionIdChanged: true,
    });

    expect(loadSpy).toHaveBeenCalledWith('added-server', addedConfig);
    expect(unloadSpy).toHaveBeenCalledWith('removed-server');
    expect(loadSpy).toHaveBeenCalledWith('restarted-server', restartedConfig);
    expect(serverManager.startServer).not.toHaveBeenCalled();
    expect(serverManager.stopServer).not.toHaveBeenCalled();
    expect(serverManager.restartServer).not.toHaveBeenCalled();
  });
});
