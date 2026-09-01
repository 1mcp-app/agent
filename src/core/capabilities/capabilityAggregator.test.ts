import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, type OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilityAggregator } from './capabilityAggregator.js';
import { readConfiguredToolSnapshot, readLastConfiguredToolSnapshot } from './configuredToolSnapshot.js';

// Mock InternalCapabilitiesProvider
vi.mock('@src/core/capabilities/internalCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: vi.fn().mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      getAvailableTools: vi.fn().mockReturnValue([]),
      getAvailableResources: vi.fn().mockReturnValue([]),
      getAvailablePrompts: vi.fn().mockReturnValue([]),
    }),
  },
}));

const mockGetTransportConfig = vi.fn().mockReturnValue({});

vi.mock('@src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(() => ({
      getTransportConfig: mockGetTransportConfig,
    })),
  },
}));

describe('CapabilityAggregator', () => {
  let aggregator: CapabilityAggregator;
  let mockConnections: OutboundConnections;

  const mockTool: Tool = {
    name: 'test-tool',
    description: 'A test tool',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  };
  const mockResource: Resource = { uri: 'test://resource', name: 'Test Resource' };
  const mockPrompt: Prompt = { name: 'test-prompt', description: 'A test prompt' };

  type CapabilityClient = {
    listTools: () => Promise<unknown>;
    listResources?: () => Promise<unknown>;
    listPrompts?: () => Promise<unknown>;
    close?: () => Promise<void>;
    getServerCapabilities?: () => Record<string, unknown>;
  };

  const connectionFromClient = (
    name: string,
    client: CapabilityClient,
    overrides: Partial<OutboundConnection> = {},
  ): OutboundConnection =>
    createMockOutboundConnection({
      name,
      capabilities: (client.getServerCapabilities?.() ?? {}) as OutboundConnection['capabilities'],
      adapter: {
        request: vi.fn(async ({ method }) => {
          if (method === 'tools/list') return (await client.listTools()) as never;
          if (method === 'resources/list') return ((await client.listResources?.()) ?? { resources: [] }) as never;
          if (method === 'prompts/list') return ((await client.listPrompts?.()) ?? { prompts: [] }) as never;
          return {};
        }),
        ...(client.close ? { close: client.close } : {}),
      },
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockConnections = new Map();
    aggregator = new CapabilityAggregator(mockConnections);
    mockGetTransportConfig.mockReturnValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with empty capabilities', () => {
      const capabilities = aggregator.getCurrentCapabilities();
      expect(capabilities.tools).toHaveLength(0);
      expect(capabilities.resources).toHaveLength(0);
      expect(capabilities.prompts).toHaveLength(0);
      expect(capabilities.readyServers).toHaveLength(0);
    });
  });

  describe('updateCapabilities', () => {
    it('should apply the effective backend request timeout to every capability list call', async () => {
      const listTools = vi.fn().mockResolvedValue({ tools: [mockTool] });
      const listResources = vi.fn().mockResolvedValue({ resources: [mockResource] });
      const listPrompts = vi.fn().mockResolvedValue({ prompts: [mockPrompt] });
      const mockClient = {
        listTools,
        listResources,
        listPrompts,
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
      };

      mockConnections.set(
        'slow-server',
        connectionFromClient('slow-server', mockClient, { requestTimeoutMs: 300_000 }),
      );

      await aggregator.updateCapabilities();

      const adapterRequest = vi.mocked(mockConnections.get('slow-server')!.adapter.request);
      expect(adapterRequest).toHaveBeenCalledTimes(3);
      expect(adapterRequest.mock.calls.map(([request]) => [request.method, request.timeoutMs])).toEqual([
        ['tools/list', 300_000],
        ['resources/list', 300_000],
        ['prompts/list', 300_000],
      ]);
    });

    it('should preserve partial capabilities after a timeout and recover on a later refresh', async () => {
      const recoveredTool = { ...mockTool, name: 'recovered-tool' };
      const healthyTool = { ...mockTool, name: 'healthy-tool' };
      const slowListTools = vi
        .fn()
        .mockRejectedValueOnce(new Error('Request timed out'))
        .mockResolvedValueOnce({ tools: [recoveredTool] })
        .mockRejectedValueOnce(new Error('Request timed out again'));

      const createConnection = (name: string, listTools: () => Promise<unknown>) => {
        const client = {
          listTools,
          getServerCapabilities: vi.fn().mockReturnValue({}),
        };
        return connectionFromClient(name, client, { requestTimeoutMs: 50 });
      };

      mockConnections.set('slow-server', createConnection('slow-server', slowListTools));
      mockConnections.set(
        'healthy-server',
        createConnection('healthy-server', vi.fn().mockResolvedValue({ tools: [healthyTool] })),
      );

      const partial = await aggregator.refreshCapabilities();
      expect(partial.tools.map((tool) => tool.name)).toEqual(['healthy-tool']);

      const recovered = await aggregator.refreshCapabilities();
      expect(recovered.tools.map((tool) => tool.name).sort()).toEqual(['healthy-tool', 'recovered-tool']);

      await aggregator.refreshCapabilities();
      expect(readLastConfiguredToolSnapshot('slow-server').map((tool) => tool.name)).toEqual(['recovered-tool']);
      expect(slowListTools).toHaveBeenCalledTimes(3);
    });

    it('should return no changes when no servers are connected', async () => {
      const changes = await aggregator.updateCapabilities();

      expect(changes.hasChanges).toBe(false);
      expect(changes.toolsChanged).toBe(false);
      expect(changes.resourcesChanged).toBe(false);
      expect(changes.promptsChanged).toBe(false);
    });

    it('should detect changes when servers become ready', async () => {
      // Add a mock connected client
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [mockResource] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [mockPrompt] }),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('test-server', connectionFromClient('test-server', mockClient));

      const changes = await aggregator.updateCapabilities();

      expect(changes.hasChanges).toBe(true);
      expect(changes.toolsChanged).toBe(true);
      expect(changes.resourcesChanged).toBe(true);
      expect(changes.promptsChanged).toBe(true);
      expect(changes.current.tools).toHaveLength(1);
      expect(changes.current.resources).toHaveLength(1);
      expect(changes.current.prompts).toHaveLength(1);
      expect(changes.current.readyServers).toContain('test-server');
    });

    it('should detect effective tool description changes', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        getServerCapabilities: vi.fn().mockReturnValue({ tools: true }),
        transport: { start: vi.fn(), send: vi.fn(), close: vi.fn() },
      } as any;
      mockConnections.set('test-server', connectionFromClient('test-server', mockClient));

      await aggregator.updateCapabilities();
      mockGetTransportConfig.mockReturnValue({
        'test-server': {
          type: 'stdio',
          command: 'node',
          toolDescriptionOverrides: { 'test-tool': 'Operator description' },
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.toolsChanged).toBe(true);
      expect(changes.current.tools).toMatchObject([{ name: 'test-tool', description: 'Operator description' }]);
    });

    it('should handle client method failures gracefully', async () => {
      // Add a mock client that fails
      const mockClient = {
        listTools: vi.fn().mockRejectedValue(new Error('Tool listing failed')),
        listResources: vi.fn().mockRejectedValue(new Error('Resource listing failed')),
        listPrompts: vi.fn().mockRejectedValue(new Error('Prompt listing failed')),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('failing-server', connectionFromClient('failing-server', mockClient));

      const changes = await aggregator.updateCapabilities();

      // Should still track the server even if capabilities fail
      expect(changes.current.readyServers).toContain('failing-server');
      expect(changes.current.tools).toHaveLength(0);
      expect(changes.current.resources).toHaveLength(0);
      expect(changes.current.prompts).toHaveLength(0);
    });

    it('should stop capability polling after a terminal post-authentication 401', async () => {
      const unauthorized = new OneMcpProtocolError(401, 'Server returned 401 after successful authentication');
      const listTools = vi
        .fn()
        .mockResolvedValueOnce({ tools: [mockTool] })
        .mockRejectedValue(unauthorized);
      const listResources = vi.fn().mockResolvedValueOnce({ resources: [] }).mockRejectedValue(unauthorized);
      const listPrompts = vi.fn().mockResolvedValueOnce({ prompts: [] }).mockRejectedValue(unauthorized);
      const close = vi.fn().mockResolvedValue(undefined);
      const mockClient = {
        listTools,
        listResources,
        listPrompts,
        close,
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
      } as any;

      mockConnections.set('oauth-server', connectionFromClient('oauth-server', mockClient));

      const connection = mockConnections.get('oauth-server')!;
      await aggregator.updateCapabilities();
      expect(readConfiguredToolSnapshot(connection)?.map((tool) => tool.name)).toEqual(['test-tool']);

      const first = await aggregator.updateCapabilities();

      expect(close).toHaveBeenCalledTimes(1);
      expect(connection.status).toBe(ClientStatus.AwaitingOAuth);
      expect(connection.lastError).toEqual({ name: 'OneMcpProtocolError', message: unauthorized.message });
      expect(first.current.readyServers).not.toContain('oauth-server');
      expect(readConfiguredToolSnapshot(connection)).toBeUndefined();
      expect(readLastConfiguredToolSnapshot('oauth-server').map((tool) => tool.name)).toEqual(['test-tool']);

      await aggregator.updateCapabilities();
      expect(listTools).toHaveBeenCalledTimes(2);
      expect(listResources).toHaveBeenCalledTimes(2);
      expect(listPrompts).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate tools with same name', async () => {
      const duplicateTool: Tool = {
        name: 'test-tool',
        description: 'Another test tool',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      };

      const mockClient1 = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      const mockClient2 = {
        listTools: vi.fn().mockResolvedValue({ tools: [duplicateTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('server1', connectionFromClient('server1', mockClient1));

      mockConnections.set('server2', connectionFromClient('server2', mockClient2));

      const changes = await aggregator.updateCapabilities();

      // Should only have one tool despite two servers providing tools with same name
      expect(changes.current.tools).toHaveLength(1);
      expect(changes.current.tools[0].name).toBe('test-tool');
    });

    it('should filter disabled tools by logical server name', async () => {
      mockGetTransportConfig.mockReturnValue({
        'template-server': {
          type: 'stdio',
          command: 'node',
          disabledTools: ['test-tool'],
        },
      });

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('template-server:rendered-hash', connectionFromClient('template-server', mockClient));

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.tools).toHaveLength(0);
      expect(changes.current.readyServers).toContain('template-server:rendered-hash');
    });
  });

  describe('getCapabilitiesSummary', () => {
    it('should return formatted summary string', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [mockResource] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [mockPrompt] }),
        getServerCapabilities: vi.fn().mockReturnValue({ resources: true, prompts: true }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('test-server', connectionFromClient('test-server', mockClient));

      await aggregator.updateCapabilities();

      const summary = aggregator.getCapabilitiesSummary();
      expect(summary).toBe('1 tools, 1 resources, 1 prompts from 1 servers');
    });
  });

  describe('refreshCapabilities', () => {
    it('should force refresh and return current capabilities', async () => {
      const capabilities = await aggregator.refreshCapabilities();

      expect(capabilities).toEqual(aggregator.getCurrentCapabilities());
      expect(capabilities.tools).toHaveLength(0);
      expect(capabilities.resources).toHaveLength(0);
      expect(capabilities.prompts).toHaveLength(0);
    });
  });
});
