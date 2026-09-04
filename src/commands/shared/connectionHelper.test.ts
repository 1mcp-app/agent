import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { OutboundConnection } from '@src/core/types/client.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { McpConnectionHelper } from './connectionHelper.js';

const mockCreateClients = vi.fn();
const mockListTools = vi.fn();
const mockListResources = vi.fn();
const mockListPrompts = vi.fn();
const mockAdapterClose = vi.fn();

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
  return createMockOutboundConnection({
    name: 'mock-server',
    adapter: {
      request: vi.fn(async ({ method }) => {
        if (method === 'tools/list') return mockListTools();
        if (method === 'resources/list') return mockListResources();
        if (method === 'prompts/list') return mockListPrompts();
        return {};
      }),
      close: mockAdapterClose,
    },
    status: 'connected' as OutboundConnection['status'],
  });
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
    mockAdapterClose.mockResolvedValue(undefined);

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

    expect(mockAdapterClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(pendingBeforeCleanup);
  });

  it('closes the connection adapter during cleanup', async () => {
    const helper = new McpConnectionHelper();

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await helper.cleanup();

    expect(mockAdapterClose).toHaveBeenCalledOnce();
  });

  it('resolves cleanup when adapter close rejects', async () => {
    const helper = new McpConnectionHelper();

    mockAdapterClose.mockRejectedValueOnce(new Error('adapter close failed'));

    await helper.connectToServers({
      'mock-server': {
        type: 'stdio',
        command: 'echo',
      },
    });

    await expect(helper.cleanup()).resolves.toBeUndefined();

    expect(mockAdapterClose).toHaveBeenCalledTimes(1);
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

    expect(mockAdapterClose).toHaveBeenCalledTimes(1);
  });
});
