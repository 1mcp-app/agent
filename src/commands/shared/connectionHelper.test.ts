import type { OutboundConnection } from '@src/core/types/client.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConnectionHelper } from './connectionHelper.js';

const mockCreateClients = vi.fn();
const mockListTools = vi.fn();
const mockListResources = vi.fn();
const mockListPrompts = vi.fn();
const mockClientClose = vi.fn();
const mockTransportClose = vi.fn();
const mockOauthProviderShutdown = vi.fn();

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    getOrCreateInstance: vi.fn(() => ({
      createClients: mockCreateClients,
    })),
  },
}));

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransports: vi.fn((servers: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(servers).map((name) => [name, { name }])),
  ),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createConnection(): OutboundConnection {
  return {
    name: 'mock-server',
    transport: {
      close: mockTransportClose,
      oauthProvider: {
        shutdown: mockOauthProviderShutdown,
      },
    } as unknown as OutboundConnection['transport'],
    client: {
      listTools: mockListTools,
      listResources: mockListResources,
      listPrompts: mockListPrompts,
      close: mockClientClose,
    } as unknown as OutboundConnection['client'],
    status: 'connected' as OutboundConnection['status'],
  };
}

describe('McpConnectionHelper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockListTools.mockResolvedValue({
      tools: [{ name: 'test_tool', inputSchema: { type: 'object' } }],
    });
    mockListResources.mockResolvedValue({ resources: [] });
    mockListPrompts.mockResolvedValue({ prompts: [] });
    mockClientClose.mockResolvedValue(undefined);
    mockTransportClose.mockResolvedValue(undefined);
    mockOauthProviderShutdown.mockReturnValue(undefined);

    mockCreateClients.mockImplementation(async () => {
      const connections = new Map<string, OutboundConnection>();
      connections.set('mock-server', createConnection());
      return connections;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears connection and capability timeout timers after a successful connect flow', async () => {
    const helper = new McpConnectionHelper();

    const pendingBefore = vi.getTimerCount();
    const connectPromise = helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await expect(connectPromise).resolves.toEqual([
      expect.objectContaining({
        serverName: 'mock-server',
        connected: true,
      }),
    ]);

    expect(vi.getTimerCount()).toBe(pendingBefore);
  });

  it('clears close timeout timers during cleanup after successful connection', async () => {
    const helper = new McpConnectionHelper();

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    const pendingBeforeCleanup = vi.getTimerCount();
    await helper.cleanup();

    expect(mockClientClose).toHaveBeenCalledTimes(1);
    expect(mockTransportClose).toHaveBeenCalledTimes(1);
    expect(mockOauthProviderShutdown).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(pendingBeforeCleanup);
  });

  it('attempts both client and transport cleanup in order', async () => {
    const helper = new McpConnectionHelper();

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await helper.cleanup();

    expect(mockClientClose.mock.invocationCallOrder[0]).toBeLessThan(mockTransportClose.mock.invocationCallOrder[0]);
    expect(mockTransportClose.mock.invocationCallOrder[0]).toBeLessThan(
      mockOauthProviderShutdown.mock.invocationCallOrder[0],
    );
  });

  it('still closes transport when client close rejects', async () => {
    const helper = new McpConnectionHelper();

    mockClientClose.mockRejectedValueOnce(new Error('client close failed'));

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await expect(helper.cleanup()).resolves.toBeUndefined();

    expect(mockClientClose).toHaveBeenCalledTimes(1);
    expect(mockTransportClose).toHaveBeenCalledTimes(1);
    expect(mockOauthProviderShutdown).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is idempotent after connections have been cleared', async () => {
    const helper = new McpConnectionHelper();

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await helper.cleanup();
    await helper.cleanup();

    expect(mockClientClose).toHaveBeenCalledTimes(1);
    expect(mockTransportClose).toHaveBeenCalledTimes(1);
    expect(mockOauthProviderShutdown).toHaveBeenCalledTimes(1);
  });

  it('still shuts down the OAuth provider when transport close rejects', async () => {
    const helper = new McpConnectionHelper();

    mockTransportClose.mockRejectedValueOnce(new Error('transport close failed'));

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await expect(helper.cleanup()).resolves.toBeUndefined();

    expect(mockTransportClose).toHaveBeenCalledTimes(1);
    expect(mockOauthProviderShutdown).toHaveBeenCalledTimes(1);
  });
});
