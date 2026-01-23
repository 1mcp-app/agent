/**
 * Unit tests for MetaToolProvider with template MCP servers
 *
 * This test file reproduces and validates the fix for the issue where
 * tool_invoke and tool_schema fail with template servers due to server name
 * mismatch between clean names (in registry) and hash-suffixed keys (in connections).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { OutboundConnections } from '@src/core/types/client.js';
import { ClientStatus } from '@src/core/types/client.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaToolProvider } from './metaToolProvider.js';
import { SchemaCache } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

describe('MetaToolProvider - Template Server Support', () => {
  let metaToolProvider: MetaToolProvider;
  let schemaCache: SchemaCache;
  let outboundConnections: OutboundConnections;
  let toolRegistry: ToolRegistry;

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
    } as unknown as Client;

    // Template server with hash-suffixed key (shareable template)
    // Key format: "template-server:abc123" (clean name + rendered hash)
    outboundConnections.set('template-server:abc123', {
      name: 'template-server', // Clean name without hash
      client: mockClient,
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
      transport: 'stdio' as any,
    });

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
    } as unknown as Client;

    outboundConnections.set('static-server', {
      name: 'static-server',
      client: mockStaticClient,
      status: ClientStatus.Connected,
      capabilities: { tools: {} },
      transport: 'stdio' as any,
    });

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
        const result = await conn.client.listTools();
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
