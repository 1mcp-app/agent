import { Prompt, Resource, Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CapabilityAggregator } from './capabilityAggregator.js';

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

  describe('capability filtering', () => {
    it('should filter out disabled tools', async () => {
      const tools: Tool[] = [
        {
          name: 'safe-tool',
          description: 'A safe tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'dangerous-tool',
          description: 'A dangerous tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
          name: 'another-safe-tool',
          description: 'Another safe tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('github', {
        name: 'github',
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
        serverConfig: {
          disabledTools: ['dangerous-tool'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.tools).toHaveLength(2);
      expect(changes.current.tools.map(t => t.name)).toContain('safe-tool');
      expect(changes.current.tools.map(t => t.name)).toContain('another-safe-tool');
      expect(changes.current.tools.map(t => t.name)).not.toContain('dangerous-tool');
    });

    it('should only include enabled tools (whitelist mode)', async () => {
      const tools: Tool[] = [
        { name: 'tool-a', description: 'Tool A', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'tool-b', description: 'Tool B', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'tool-c', description: 'Tool C', inputSchema: { type: 'object', properties: {}, required: [] } },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('limited-server', {
        name: 'limited-server',
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
        serverConfig: {
          enabledTools: ['tool-a', 'tool-b'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.tools).toHaveLength(2);
      expect(changes.current.tools.map(t => t.name)).toContain('tool-a');
      expect(changes.current.tools.map(t => t.name)).toContain('tool-b');
      expect(changes.current.tools.map(t => t.name)).not.toContain('tool-c');
    });

    it('should filter out disabled resources', async () => {
      const resources: Resource[] = [
        { uri: 'file:///safe/data.json', name: 'Safe Data' },
        { uri: 'file:///etc/passwd', name: 'Sensitive File' },
        { uri: 'file:///var/log/app.log', name: 'App Log' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('filesystem', {
        name: 'filesystem',
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
        serverConfig: {
          disabledResources: ['file:///etc/passwd'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.resources).toHaveLength(2);
      expect(changes.current.resources.map(r => r.uri)).toContain('file:///safe/data.json');
      expect(changes.current.resources.map(r => r.uri)).toContain('file:///var/log/app.log');
      expect(changes.current.resources.map(r => r.uri)).not.toContain('file:///etc/passwd');
    });

    it('should only include enabled resources (whitelist mode)', async () => {
      const resources: Resource[] = [
        { uri: 'public://data.json', name: 'Public Data' },
        { uri: 'private://secrets.json', name: 'Secrets' },
        { uri: 'internal://config.json', name: 'Config' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('api-server', {
        name: 'api-server',
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
        serverConfig: {
          enabledResources: ['public://data.json', 'internal://config.json'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.resources).toHaveLength(2);
      expect(changes.current.resources.map(r => r.uri)).toContain('public://data.json');
      expect(changes.current.resources.map(r => r.uri)).toContain('internal://config.json');
      expect(changes.current.resources.map(r => r.uri)).not.toContain('private://secrets.json');
    });

    it('should filter out disabled prompts', async () => {
      const prompts: Prompt[] = [
        { name: 'safe-prompt', description: 'A safe prompt' },
        { name: 'dangerous-prompt', description: 'A dangerous prompt' },
        { name: 'another-safe-prompt', description: 'Another safe prompt' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('github', {
        name: 'github',
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
        serverConfig: {
          disabledPrompts: ['dangerous-prompt'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.prompts).toHaveLength(2);
      expect(changes.current.prompts.map(p => p.name)).toContain('safe-prompt');
      expect(changes.current.prompts.map(p => p.name)).toContain('another-safe-prompt');
      expect(changes.current.prompts.map(p => p.name)).not.toContain('dangerous-prompt');
    });

    it('should only include enabled prompts (whitelist mode)', async () => {
      const prompts: Prompt[] = [
        { name: 'prompt-a', description: 'Prompt A' },
        { name: 'prompt-b', description: 'Prompt B' },
        { name: 'prompt-c', description: 'Prompt C' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('limited-server', {
        name: 'limited-server',
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
        serverConfig: {
          enabledPrompts: ['prompt-a', 'prompt-b'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.prompts).toHaveLength(2);
      expect(changes.current.prompts.map(p => p.name)).toContain('prompt-a');
      expect(changes.current.prompts.map(p => p.name)).toContain('prompt-b');
      expect(changes.current.prompts.map(p => p.name)).not.toContain('prompt-c');
    });

    it('should pass through all capabilities when no server config', async () => {
      const tools: Tool[] = [
        { name: 'tool-1', description: 'Tool 1', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'tool-2', description: 'Tool 2', inputSchema: { type: 'object', properties: {}, required: [] } },
      ];
      const resources: Resource[] = [
        { uri: 'file://test', name: 'Test' },
      ];
      const prompts: Prompt[] = [
        { name: 'prompt-1', description: 'Prompt 1' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools }),
        listResources: vi.fn().mockResolvedValue({ resources }),
        listPrompts: vi.fn().mockResolvedValue({ prompts }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('unfiltered-server', {
        name: 'unfiltered-server',
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
        // No serverConfig - should pass through all
      });

      const changes = await aggregator.updateCapabilities();

      expect(changes.current.tools).toHaveLength(2);
      expect(changes.current.resources).toHaveLength(1);
      expect(changes.current.prompts).toHaveLength(1);
    });

    it('should filter multiple capability types simultaneously', async () => {
      const tools: Tool[] = [
        { name: 'safe-tool', description: 'Safe', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'dangerous-tool', description: 'Dangerous', inputSchema: { type: 'object', properties: {}, required: [] } },
      ];
      const resources: Resource[] = [
        { uri: 'safe://data', name: 'Safe' },
        { uri: 'secret://data', name: 'Secret' },
      ];
      const prompts: Prompt[] = [
        { name: 'safe-prompt', description: 'Safe' },
        { name: 'admin-prompt', description: 'Admin' },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools }),
        listResources: vi.fn().mockResolvedValue({ resources }),
        listPrompts: vi.fn().mockResolvedValue({ prompts }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('multi-filtered', {
        name: 'multi-filtered',
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
        serverConfig: {
          disabledTools: ['dangerous-tool'],
          disabledResources: ['secret://data'],
          disabledPrompts: ['admin-prompt'],
        },
      });

      const changes = await aggregator.updateCapabilities();

      // Tools: 1 (dangerous-tool filtered)
      expect(changes.current.tools).toHaveLength(1);
      expect(changes.current.tools[0].name).toBe('safe-tool');

      // Resources: 1 (secret://data filtered)
      expect(changes.current.resources).toHaveLength(1);
      expect(changes.current.resources[0].uri).toBe('safe://data');

      // Prompts: 1 (admin-prompt filtered)
      expect(changes.current.prompts).toHaveLength(1);
      expect(changes.current.prompts[0].name).toBe('safe-prompt');
    });

    it('should apply enabledTools over disabledTools (whitelist takes precedence)', async () => {
      const tools: Tool[] = [
        { name: 'tool-a', description: 'Tool A', inputSchema: { type: 'object', properties: {}, required: [] } },
        { name: 'tool-b', description: 'Tool B', inputSchema: { type: 'object', properties: {}, required: [] } },
      ];

      const mockClient = {
        listTools: vi.fn().mockResolvedValue({ tools }),
        listResources: vi.fn().mockResolvedValue({ resources: [] }),
        listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
        transport: {
          start: vi.fn(),
          send: vi.fn(),
          close: vi.fn(),
        },
      } as any;

      mockConnections.set('priority-test', {
        name: 'priority-test',
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
        serverConfig: {
          enabledTools: ['tool-a'],
          disabledTools: ['tool-a', 'tool-b'], // enabled takes precedence
        },
      });

      const changes = await aggregator.updateCapabilities();

      // Only tool-a should be present (enabled takes precedence over disabled)
      expect(changes.current.tools).toHaveLength(1);
      expect(changes.current.tools[0].name).toBe('tool-a');
    });
  });
});
