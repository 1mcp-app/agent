import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ClientStatus, type OutboundConnections } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

const mocks = vi.hoisted(() => ({
  configManager: {
    loadConfigWithTemplates: vi.fn(),
  },
  connectionManager: {
    connectTransport: vi.fn(),
    disconnectTransport: vi.fn(),
    getTransport: vi.fn(),
    getTransports: vi.fn(() => new Map()),
    getActiveTransportsCount: vi.fn(() => 0),
    getServer: vi.fn(),
    getInboundConnections: vi.fn(() => new Map()),
    executeServerOperation: vi.fn(),
    cleanup: vi.fn().mockResolvedValue(undefined),
    setLazyLoadingOrchestrator: vi.fn(),
  },
  templateServerManager: {
    createTemplateBasedServers: vi.fn(),
    cleanupTemplateServers: vi.fn(),
    getRenderedHashForSession: vi.fn(),
    getAllRenderedHashesForSession: vi.fn(),
    setInstructionAggregator: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  serverRegistry: {
    has: vi.fn(() => false),
    registerExternal: vi.fn(),
    registerTemplate: vi.fn(),
  },
  filterCache: {
    clear: vi.fn(),
    getStats: vi.fn(() => ({})),
  },
}));

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: vi.fn(() => mocks.configManager),
  },
}));

vi.mock('@src/core/filtering/index.js', () => ({
  ClientTemplateTracker: vi.fn(),
  FilterCache: vi.fn(),
  TemplateIndex: vi.fn(),
  getFilterCache: vi.fn(() => mocks.filterCache),
}));

vi.mock('@src/core/loading/mcpLoadingManager.js', () => ({
  McpLoadingManager: { current: {} },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('./adapters/ServerRegistry.js', () => ({
  ServerRegistry: vi.fn(function () {
    return mocks.serverRegistry;
  }),
}));

vi.mock('./connectionManager.js', () => ({
  ConnectionManager: vi.fn(function () {
    return mocks.connectionManager;
  }),
}));

vi.mock('./mcpServerLifecycleManager.js', () => ({
  MCPServerLifecycleManager: vi.fn(function () {
    return {};
  }),
}));

vi.mock('./templateConfigurationManager.js', () => ({
  TemplateConfigurationManager: vi.fn(function () {
    return { cleanup: vi.fn() };
  }),
}));

vi.mock('./templateServerManager.js', () => ({
  TemplateServerManager: vi.fn(function () {
    return mocks.templateServerManager;
  }),
}));

describe('ServerManager template context trust', () => {
  let manager: ServerManager;
  let outboundConnections: OutboundConnections;

  beforeEach(async () => {
    await ServerManager.resetInstance();
    vi.clearAllMocks();
    mocks.configManager.loadConfigWithTemplates.mockImplementation(async (context?: unknown) => ({
      staticServers: {},
      templateServers: context
        ? {
            attacker: {
              type: 'stdio',
              command: '{{project.custom.command}}',
              args: ['-c', 'echo exploit'],
            },
          }
        : {},
      errors: [],
    }));
    mocks.connectionManager.connectTransport.mockResolvedValue(undefined);
    mocks.templateServerManager.getRenderedHashForSession.mockReturnValue(undefined);
    mocks.templateServerManager.getAllRenderedHashesForSession.mockReturnValue(undefined);
    outboundConnections = new Map([
      [
        'static',
        {
          name: 'static',
          status: ClientStatus.Connected,
          transport: { tags: ['safe'] },
        },
      ],
      [
        'template:other-session',
        {
          name: 'template',
          status: ClientStatus.Connected,
          transport: { tags: ['safe'] },
        },
      ],
    ]) as unknown as OutboundConnections;
    manager = ServerManager.getOrCreateInstance(
      { name: '1mcp-test', version: '0.0.0' },
      { capabilities: {} },
      outboundConnections,
      {},
    );
  });

  afterEach(async () => {
    await ServerManager.resetInstance();
  });

  it('rejects untrusted context and passes only a live owner-scoped connection view', async () => {
    const transport = {} as Transport;
    const untrustedContext = {
      project: { path: '/tmp/attacker', custom: { command: 'sh' } },
      user: {},
      environment: { variables: { ATTACKER_CONTROLLED: 'true' } },
      sessionId: 'other-session',
    };

    await manager.connectTransport(
      transport,
      'owner-session',
      { tags: ['safe'], enablePagination: false, context: untrustedContext } as never,
      untrustedContext as never,
    );

    expect(mocks.configManager.loadConfigWithTemplates).toHaveBeenCalledTimes(1);
    expect(mocks.configManager.loadConfigWithTemplates).toHaveBeenCalledWith(undefined);
    expect(mocks.templateServerManager.createTemplateBasedServers).not.toHaveBeenCalled();
    expect(mocks.serverRegistry.registerTemplate).not.toHaveBeenCalled();

    const connectionCall = mocks.connectionManager.connectTransport.mock.calls[0];
    expect(connectionCall.slice(0, 5)).toEqual([
      transport,
      'owner-session',
      { tags: ['safe'], enablePagination: false },
      undefined,
      '',
    ]);

    const sessionConnections = connectionCall[5] as OutboundConnections;
    expect(sessionConnections).not.toBe(outboundConnections);
    expect(Array.from(sessionConnections.keys())).toEqual(['static']);

    outboundConnections.set('late-static', {
      name: 'late-static',
      status: ClientStatus.Connected,
      transport: { tags: ['safe'] },
    } as never);
    expect(Array.from(sessionConnections.keys())).toEqual(['static', 'late-static']);
  });
});
