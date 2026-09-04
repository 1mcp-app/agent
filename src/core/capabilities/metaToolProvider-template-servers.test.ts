/**
 * Unit tests for MetaToolProvider with template MCP servers
 *
 * This test file reproduces and validates the fix for the issue where
 * tool_invoke and tool_schema fail with template servers due to server name
 * mismatch between clean names (in registry) and hash-suffixed keys (in connections).
 */
import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { ClientStatus, OutboundConnections } from '@src/core/types/client.js';
import { Tool } from '@src/sdk/contracts/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCapabilityVisibility } from './capabilityVisibility.js';
import { MetaToolProvider } from './metaToolProvider.js';
import { SchemaCache } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

describe('MetaToolProvider - Template Server Support', () => {
  let metaToolProvider: MetaToolProvider;
  let schemaCache: SchemaCache;
  let outboundConnections: OutboundConnections;
  let toolRegistry: ToolRegistry;

  type MockClient = {
    callTool: (params: unknown) => Promise<unknown>;
    listTools: () => Promise<{ tools: Tool[] }>;
  };

  const connectionFromClient = (name: string, client: MockClient) =>
    createMockOutboundConnection({
      name,
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
      adapter: {
        request: vi.fn(async ({ method, params }) => {
          if (method === 'tools/list') return (await client.listTools()) as never;
          if (method === 'tools/call') return (await client.callTool(params)) as never;
          return {};
        }),
      },
    });

  beforeEach(() => {
    // Create schema cache
    schemaCache = new SchemaCache({ maxEntries: 100 });

    // Create outbound connections with template server (hash-suffixed key)
    outboundConnections = new Map();

    // Mock client for template server
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Tool called successfully' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'template_tool',
            description: 'A tool from template server',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        ],
      }),
    };

    // Template server with hash-suffixed key (shareable template)
    // Key format: "template-server:abc123" (clean name + rendered hash)
    outboundConnections.set('template-server:abc123', connectionFromClient('template-server', mockClient));

    // Static server without hash (for comparison)
    const mockStaticClient = {
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Static tool called' }],
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: 'static_tool',
            description: 'A tool from static server',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
            },
          },
        ],
      }),
    };

    outboundConnections.set('static-server', connectionFromClient('static-server', mockStaticClient));

    // Create tool registry with CLEAN server names (no hash suffixes)
    // This simulates how ToolRegistry stores tools from template servers
    const tools: Tool[] = [
      {
        name: 'template_tool',
        description: 'A tool from template server',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
      {
        name: 'static_tool',
        description: 'A tool from static server',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    ];

    // Build registry from tools map with CLEAN server names
    const toolsMap = new Map<string, Tool[]>();
    toolsMap.set('template-server', [tools[0]]); // Clean name, no hash
    toolsMap.set('static-server', [tools[1]]);

    toolRegistry = ToolRegistry.fromToolsMap(toolsMap);

    // Create MetaToolProvider
    metaToolProvider = new MetaToolProvider(
      () => toolRegistry,
      schemaCache,
      outboundConnections,
      async (server: string, toolName: string) => {
        // SchemaLoader implementation
        const conn = outboundConnections.get(server);
        if (!conn) {
          throw new Error(`Server not found: ${server}`);
        }
        const result = await requestLegacyAdapter<{ tools: Tool[] }>(conn.adapter, 'tools/list');
        const tool = result.tools.find((t) => t.name === toolName);
        if (!tool) {
          throw new Error(`Tool not found: ${toolName}`);
        }
        return tool;
      },
    );
  });

  describe('tool_list with template servers', () => {
    it('should list tools from template servers with clean names', async () => {
      const result = await metaToolProvider.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      expect(result).toHaveProperty('tools');
      expect(result).toHaveProperty('servers');

      // Tools should use clean server names (no hash suffixes)
      const templateTool = (result as any).tools.find((t: any) => t.name === 'template_tool');
      expect(templateTool).toBeDefined();
      expect(templateTool.server).toBe('template-server'); // Clean name, no ":abc123"

      // Servers list should also use clean names
      expect((result as any).servers).toContain('template-server');
      expect((result as any).servers).not.toContain('template-server:abc123');
    });

    it('should resolve list routes through the caller session for shareable templates', async () => {
      const sessionAwareProvider = new MetaToolProvider(
        () =>
          ToolRegistry.fromToolsWithServer([
            {
              tool: {
                name: 'template_tool',
                description: 'A tool from the session server',
                inputSchema: { type: 'object', properties: {} },
              },
              server: 'template-server',
              connectionKey: 'template-server:session-123',
            },
            {
              tool: {
                name: 'template_tool',
                description: 'A tool from the shareable server',
                inputSchema: { type: 'object', properties: {} },
              },
              server: 'template-server',
              connectionKey: 'template-server:abc123',
            },
          ]),
        schemaCache,
        outboundConnections,
        undefined,
        undefined,
        {
          getRenderedHashForSession: vi.fn(() => 'abc123'),
          getAllRenderedHashesForSession: vi.fn(() => new Map([['template-server', 'abc123']])),
        },
      );
      const listVisibleTools = vi.spyOn((sessionAwareProvider as any).capabilityCatalog, 'listVisibleTools');

      const visibility = createCapabilityVisibility([['template-server:abc123', 'template-server']], 'session-123');
      const result = await sessionAwareProvider.callMetaTool('tool_list', {}, visibility);

      expect((result as any).error).toBeUndefined();
      expect(listVisibleTools).toHaveBeenCalledWith({}, visibility);
    });

    it('keeps differing per-session tool surfaces, schemas, and invocation routes isolated', async () => {
      const sessionAClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'tool_a', description: 'session A', inputSchema: { type: 'object', title: 'A' } }],
        }),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'A' }] }),
      };
      const sessionBClient = {
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: 'tool_b', description: 'session B', inputSchema: { type: 'object', title: 'B' } }],
        }),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'B' }] }),
      };
      const connections: OutboundConnections = new Map([
        ['template-server:session-a', connectionFromClient('template-server', sessionAClient)],
        ['template-server:session-b', connectionFromClient('template-server', sessionBClient)],
      ]);
      const registry = ToolRegistry.fromToolsWithServer([
        {
          tool: { name: 'tool_a', description: 'session A', inputSchema: { type: 'object', title: 'A' } },
          server: 'template-server',
          connectionKey: 'template-server:session-a',
        },
        {
          tool: { name: 'tool_b', description: 'session B', inputSchema: { type: 'object', title: 'B' } },
          server: 'template-server',
          connectionKey: 'template-server:session-b',
        },
      ]);
      const provider = new MetaToolProvider(
        () => registry,
        schemaCache,
        connections,
        async (connectionKey, toolName) => {
          const result = await requestLegacyAdapter<{ tools: Tool[] }>(
            connections.get(connectionKey)!.adapter,
            'tools/list',
          );
          return result.tools.find((tool) => tool.name === toolName)!;
        },
      );
      const sessionAVisibility = createCapabilityVisibility(
        [['template-server:session-a', 'template-server']],
        'session-a',
      );
      const sessionBVisibility = createCapabilityVisibility(
        [['template-server:session-b', 'template-server']],
        'session-b',
      );

      const listedA = await provider.callMetaTool('tool_list', {}, sessionAVisibility);
      const listedB = await provider.callMetaTool('tool_list', {}, sessionBVisibility);
      expect((listedA as any).tools.map((tool: Tool) => tool.name)).toEqual(['tool_a']);
      expect((listedB as any).tools.map((tool: Tool) => tool.name)).toEqual(['tool_b']);
      expect((listedA as any).tools[0].server).toBe('template-server');

      const schemaA = await provider.callMetaTool(
        'tool_schema',
        { server: 'template-server', toolName: 'tool_a' },
        sessionAVisibility,
      );
      const invokeB = await provider.callMetaTool(
        'tool_invoke',
        { server: 'template-server', toolName: 'tool_b', args: {} },
        sessionBVisibility,
      );

      expect((schemaA as any).schema.inputSchema.title).toBe('A');
      expect(schemaCache.getIfCached('template-server:session-a', 'tool_a')).not.toBeNull();
      expect((invokeB as any).error).toBeUndefined();
      expect(sessionBClient.callTool).toHaveBeenCalledOnce();
      expect(sessionAClient.callTool).not.toHaveBeenCalled();
    });
  });

  describe('tool_schema with template servers - FIXED', () => {
    it('should successfully get schema for template server tool (bug fixed)', async () => {
      // This test validates that tool_schema now WORKS with template servers
      // after implementing resolveConnectionKey() to resolve clean names to hash-suffixed keys

      const result = await metaToolProvider.callMetaTool('tool_schema', {
        server: 'template-server', // Clean name (as returned by tool_list)
        toolName: 'template_tool',
      });

      expect(result).toBeDefined();

      // FIXED: Should now succeed because resolveConnectionKey() finds the connection
      // 1. Registry check: hasTool('template-server', 'template_tool') ✅ PASSES
      // 2. Connection lookup: resolveConnectionKey('template-server') → 'template-server:abc123' ✅ SUCCEEDS
      // 3. Schema loaded from connection ✅ SUCCEEDS

      console.log('tool_schema result:', JSON.stringify(result, null, 2));

      // After fix: should succeed without errors
      expect((result as any).error).toBeUndefined();
      expect((result as any).schema).toBeDefined();
      expect((result as any).schema.name).toBe('template_tool');
      expect((result as any).fromCache).toBe(false);
    });

    it('should succeed with static server (no hash suffix)', async () => {
      // This test shows that tool_schema WORKS with static servers
      // because they don't have hash-suffixed keys

      const result = await metaToolProvider.callMetaTool('tool_schema', {
        server: 'static-server',
        toolName: 'static_tool',
      });

      expect(result).toBeDefined();
      expect((result as any).error).toBeUndefined();
      expect((result as any).schema).toBeDefined();
      expect((result as any).schema.name).toBe('static_tool');
    });
  });

  describe('tool_invoke with template servers - FIXED', () => {
    it('should successfully invoke template server tool (bug fixed)', async () => {
      // This test validates that tool_invoke now WORKS with template servers

      const result = await metaToolProvider.callMetaTool('tool_invoke', {
        server: 'template-server', // Clean name
        toolName: 'template_tool',
        args: { message: 'test' },
      });

      expect(result).toBeDefined();

      // FIXED: Should now succeed with resolveConnectionKey()
      console.log('tool_invoke result:', JSON.stringify(result, null, 2));

      // After fix: should succeed without errors
      expect((result as any).error).toBeUndefined();
      expect((result as any).result).toBeDefined();
      expect((result as any).server).toBe('template-server');
      expect((result as any).tool).toBe('template_tool');
    });

    it('should succeed with static server (no hash suffix)', async () => {
      // This test shows that tool_invoke WORKS with static servers

      const result = await metaToolProvider.callMetaTool('tool_invoke', {
        server: 'static-server',
        toolName: 'static_tool',
        args: { message: 'test' },
      });

      expect(result).toBeDefined();
      expect((result as any).error).toBeUndefined();
      expect((result as any).result).toBeDefined();
      expect((result as any).server).toBe('static-server');
      expect((result as any).tool).toBe('static_tool');
    });

    it('should prefer the session-specific template connection when multiple instances exist', async () => {
      const sessionScopedClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'session-specific result' }],
        }),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'template_tool',
              description: 'A tool from the session server',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      };

      const globalClient = {
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'wrong global result' }],
        }),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: 'template_tool',
              description: 'A tool from the global server',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        }),
      };

      const multiConnections: OutboundConnections = new Map([
        ['template-server:session-123', connectionFromClient('template-server', sessionScopedClient)],
        ['template-server:abc123', connectionFromClient('template-server', globalClient)],
      ]);

      const sessionAwareProvider = new MetaToolProvider(
        () =>
          ToolRegistry.fromToolsWithServer([
            {
              tool: {
                name: 'template_tool',
                description: 'A tool from the session server',
                inputSchema: { type: 'object', properties: {} },
              },
              server: 'template-server',
              connectionKey: 'template-server:session-123',
            },
            {
              tool: {
                name: 'template_tool',
                description: 'A tool from the shareable server',
                inputSchema: { type: 'object', properties: {} },
              },
              server: 'template-server',
              connectionKey: 'template-server:abc123',
            },
          ]),
        schemaCache,
        multiConnections,
        undefined,
        undefined,
        {
          getRenderedHashForSession: vi.fn(() => 'abc123'),
          getAllRenderedHashesForSession: vi.fn(() => new Map([['template-server', 'abc123']])),
        },
      );

      const result = await sessionAwareProvider.callMetaTool(
        'tool_invoke',
        {
          server: 'template-server',
          toolName: 'template_tool',
          args: { message: 'test' },
        },
        createCapabilityVisibility([['template-server:session-123', 'template-server']], 'session-123'),
      );

      expect((result as any).error).toBeUndefined();
      expect(sessionScopedClient.callTool).toHaveBeenCalledOnce();
      expect(globalClient.callTool).not.toHaveBeenCalled();
      expect((result as any).result.content[0].text).toBe('session-specific result');
    });
  });

  describe('Connection key resolution strategy', () => {
    it('should demonstrate the mismatch between registry and connections', () => {
      // Registry uses clean names
      expect(toolRegistry.hasTool('template-server', 'template_tool')).toBe(true);
      expect(toolRegistry.hasTool('template-server:abc123', 'template_tool')).toBe(false);

      // Connections use hash-suffixed keys for template servers
      expect(outboundConnections.has('template-server')).toBe(false);
      expect(outboundConnections.has('template-server:abc123')).toBe(true);

      // This mismatch causes the bug!
      const conn = outboundConnections.get('template-server');
      expect(conn).toBeUndefined(); // ❌ Not found with clean name

      const connWithHash = outboundConnections.get('template-server:abc123');
      expect(connWithHash).toBeDefined(); // ✅ Found with hash-suffixed key
      expect(connWithHash?.name).toBe('template-server'); // But connection.name is clean!
    });
  });
});
