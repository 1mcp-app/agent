import { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilityAggregator } from './capabilityAggregator.js';

// Mock InternalCapabilitiesProvider
vi.mock('@src/core/capabilities/1mcpCapabilitiesProvider.js', () => ({
  InternalCapabilitiesProvider: {
    getInstance: vi.fn().mockReturnValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      getAvailableTools: vi.fn().mockReturnValue([]),
      getAvailableResources: vi.fn().mockReturnValue([]),
      getAvailablePrompts: vi.fn().mockReturnValue([]),
    }),
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

  beforeEach(() => {
    mockConnections = new Map();
    aggregator = new CapabilityAggregator(mockConnections);
    vi.resetAllMocks();
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
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('test-server', {
        name: 'test-server',
        client: mockClient,
        status: ClientStatus.Connected,
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn(),
        },
        lastConnected: new Date(),
      });

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

      mockConnections.set('failing-server', {
        name: 'failing-server',
        client: mockClient,
        status: ClientStatus.Connected,
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn(),
        },
        lastConnected: new Date(),
      });

      const changes = await aggregator.updateCapabilities();

      // Should still track the server even if capabilities fail
      expect(changes.current.readyServers).toContain('failing-server');
      expect(changes.current.tools).toHaveLength(0);
      expect(changes.current.resources).toHaveLength(0);
      expect(changes.current.prompts).toHaveLength(0);
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
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('server1', {
        name: 'server1',
        client: mockClient1,
        status: ClientStatus.Connected,
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn(),
        },
        lastConnected: new Date(),
      });

      mockConnections.set('server2', {
        name: 'server2',
        client: mockClient2,
        status: ClientStatus.Connected,
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn(),
        },
        lastConnected: new Date(),
      });

      const changes = await aggregator.updateCapabilities();

      // Should only have one tool despite two servers providing tools with same name
      expect(changes.current.tools).toHaveLength(1);
      expect(changes.current.tools[0].name).toBe('test-tool');
    });
  });

  describe('getCapabilitiesSummary', () => {
    it('should return formatted summary string', async () => {
      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [mockTool] }),
        listResources: vi.fn().mockResolvedValue({ resources: [mockResource] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [mockPrompt] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('test-server', {
        name: 'test-server',
        client: mockClient,
        status: ClientStatus.Connected,
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
          onerror: vi.fn(),
          onclose: vi.fn(),
        },
        lastConnected: new Date(),
      });

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
