import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MetaToolProvider } from './metaToolProvider.js';
import { SchemaCache } from './schemaCache.js';
import { ToolRegistry } from './toolRegistry.js';

describe('MetaToolProvider', () => {
  let toolRegistry: ToolRegistry;
  let schemaCache: SchemaCache;
  let outboundConnections: OutboundConnections;
  let provider: MetaToolProvider;
  let mockClient: any;

  beforeEach(() => {
    // Create mock tools
    const mockTools: Tool[] = [
      { name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } },
      { name: 'write_file', description: 'Write file', inputSchema: { type: 'object' } },
      { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
    ];

    const toolsMap = new Map<string, Tool[]>([['filesystem', mockTools]]);
    const tagsMap = new Map<string, string[]>([['filesystem', ['fs', 'file']]]);

    toolRegistry = ToolRegistry.fromToolsMap(toolsMap, tagsMap);
    schemaCache = new SchemaCache({ maxEntries: 100 });

    // Create mock client
    mockClient = {
      callTool: vi.fn(),
    };

    // Create outbound connections map
    outboundConnections = new Map([
      [
        'filesystem',
        {
          name: 'filesystem',
          client: mockClient,
          status: ClientStatus.Connected,
          transport: {
            tags: ['fs', 'file'],
          },
          lastConnected: new Date(),
        },
      ],
    ]) as OutboundConnections;

    provider = new MetaToolProvider(() => toolRegistry, schemaCache, outboundConnections);
  });

  describe('getMetaTools', () => {
    it('should return exactly 3 meta-tools', () => {
      const metaTools = provider.getMetaTools();
      expect(metaTools).toHaveLength(3);
    });

    it('should include tool_list', () => {
      const metaTools = provider.getMetaTools();
      const listTool = metaTools.find((t) => t.name === 'tool_list');
      expect(listTool).toBeDefined();
      expect(listTool?.description).toContain('List all available MCP tools');
    });

    it('should include tool_schema', () => {
      const metaTools = provider.getMetaTools();
      const describeTool = metaTools.find((t) => t.name === 'tool_schema');
      expect(describeTool).toBeDefined();
      expect(describeTool?.description).toContain('Get the full schema for a specific tool');
    });

    it('should include tool_invoke', () => {
      const metaTools = provider.getMetaTools();
      const callTool = metaTools.find((t) => t.name === 'tool_invoke');
      expect(callTool).toBeDefined();
      expect(callTool?.description).toContain('Execute any tool on any MCP server');
    });

    it('should require server and toolName for describe_tool', () => {
      const metaTools = provider.getMetaTools();
      const describeTool = metaTools.find((t) => t.name === 'tool_schema');
      expect(describeTool?.inputSchema.required).toContain('server');
      expect(describeTool?.inputSchema.required).toContain('toolName');
    });

    it('should require server, toolName, and args for call_tool', () => {
      const metaTools = provider.getMetaTools();
      const callTool = metaTools.find((t) => t.name === 'tool_invoke');
      expect(callTool?.inputSchema.required).toContain('server');
      expect(callTool?.inputSchema.required).toContain('toolName');
      expect(callTool?.inputSchema.required).toContain('args');
    });
  });

  describe('callMetaTool - tool_list', () => {
    it('should list all tools without filters', async () => {
      const result = await provider.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }
      // Type guard: if no error and has tools, it's a ListToolsResult
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(3);
        expect(result.tools).toHaveLength(3);
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should filter by server', async () => {
      const result = await provider.callMetaTool('tool_list', { server: 'filesystem' });

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(3);
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should filter by pattern', async () => {
      const result = await provider.callMetaTool('tool_list', { pattern: '*file*' });

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(2);
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should support pagination', async () => {
      const result = await provider.callMetaTool('tool_list', { limit: 2 });

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }
      if ('tools' in result && 'hasMore' in result) {
        expect(result.tools).toHaveLength(2);
        expect(result.hasMore).toBe(true);
        expect(result.nextCursor).toBeDefined();
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should handle unknown meta-tool', async () => {
      const result = await provider.callMetaTool('unknown_tool', {});

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
        expect(result.error.message).toContain('Unknown meta-tool');
      }
    });
  });

  describe('callMetaTool - tool_schema', () => {
    it('should require server and toolName', async () => {
      const result = await provider.callMetaTool('tool_schema', {});

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('validation');
        expect(result.error.message).toContain('Invalid arguments');
      }
    });

    it('should return error for non-existent tool', async () => {
      const result = await provider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'not_exists',
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
        expect(result.error.message).toContain('Tool not found');
      }
    });

    it('should return schema from cache if available', async () => {
      const mockTool: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      };

      schemaCache.set('filesystem', 'read_file', mockTool);

      const result = await provider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect('error' in result).toBe(false);
      if ('schema' in result && 'fromCache' in result) {
        expect(result.fromCache).toBe(true);
        expect(result.schema.name).toBe('read_file');
      } else {
        throw new Error('Expected DescribeToolResult');
      }
    });

    it('should return internal error if schema not loaded', async () => {
      const result = await provider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('internal');
      }
    });
  });

  describe('callMetaTool - tool_invoke', () => {
    it('should require server and toolName', async () => {
      const result = await provider.callMetaTool('tool_invoke', {});

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('validation');
      }
    });

    it('should return error for non-existent tool', async () => {
      const result = await provider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'not_exists',
        args: {},
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
      }
    });

    it('should return error for disconnected server', async () => {
      const disconnectedConnections = new Map([
        [
          'filesystem',
          {
            name: 'filesystem',
            client: null,
            status: ClientStatus.Disconnected,
            transport: {
              tags: [],
              start: async () => {},
              send: async () => ({}),
              close: async () => {},
            },
          },
        ],
      ]) as any as OutboundConnections;

      const disconnectedProvider = new MetaToolProvider(() => toolRegistry, schemaCache, disconnectedConnections);

      const result = await disconnectedProvider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
        expect(result.error.message).toContain('not connected');
      }
    });

    it('should call tool on upstream server', async () => {
      const mockResult = {
        content: [{ type: 'text', text: 'File contents' }],
      };

      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await provider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: { path: '/test/file.txt' },
      });

      expect('error' in result).toBe(false);
      if ('result' in result && 'server' in result) {
        expect(result.server).toBe('filesystem');
        expect(result.tool).toBe('read_file');
      } else {
        throw new Error('Expected CallToolResult');
      }
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      });
    });

    it('should handle upstream server errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Upstream error'));

      const result = await provider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
        expect(result.error.message).toContain('Server Error');
      }
    });

    it('should detect not found errors from upstream', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool not found: read_file'));

      const result = await provider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
      }
    });
  });

  describe('Error Response Format', () => {
    it('should include error type in validation errors', async () => {
      const result = await provider.callMetaTool('tool_schema', {});

      if ('error' in result && result.error) {
        expect(result.error.type).toBe('validation');
      } else {
        throw new Error('Expected error in result');
      }
    });

    it('should include error type in not_found errors', async () => {
      const result = await provider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'not_exists',
      });

      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
      } else {
        throw new Error('Expected error in result');
      }
    });

    it('should include error type in upstream errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Server error'));

      const result = await provider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {}, // Changed from 'arguments' to 'args' to match schema
      });

      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
      } else {
        throw new Error('Expected error in result');
      }
    });
  });

  describe('tool_schema with SchemaLoader', () => {
    let providerWithLoader: MetaToolProvider;
    let mockSchemaLoader: any;

    beforeEach(() => {
      // Create a mock SchemaLoader function
      mockSchemaLoader = vi.fn();

      // Create provider with SchemaLoader
      providerWithLoader = new MetaToolProvider(() => toolRegistry, schemaCache, outboundConnections, mockSchemaLoader);
    });

    it('should load schema from server when not cached and loader is available', async () => {
      const mockSchema: Tool = {
        name: 'read_file',
        description: 'Read file contents',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      };

      mockSchemaLoader.mockResolvedValue(mockSchema);

      const result = await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(mockSchemaLoader).toHaveBeenCalledWith('filesystem', 'read_file');
      expect('error' in result).toBe(false);
      if ('schema' in result && 'fromCache' in result) {
        expect(result.schema).toEqual(mockSchema);
        expect(result.fromCache).toBe(false);
      } else {
        throw new Error('Expected DescribeToolResult');
      }
    });

    it('should cache loaded schema after successful load', async () => {
      const mockSchema: Tool = {
        name: 'write_file',
        description: 'Write file contents',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      };

      mockSchemaLoader.mockResolvedValue(mockSchema);

      // First call - should load from server
      await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'write_file',
      });

      expect(mockSchemaLoader).toHaveBeenCalledTimes(1);

      // Verify schema is now in cache
      const cached = schemaCache.getIfCached('filesystem', 'write_file');
      expect(cached).toEqual(mockSchema);
    });

    it('should return fromCache: false for freshly loaded schemas', async () => {
      const mockSchema: Tool = {
        name: 'search',
        description: 'Search files',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
      };

      mockSchemaLoader.mockResolvedValue(mockSchema);

      const result = await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'search',
      });

      expect('error' in result).toBe(false);
      if ('schema' in result && 'fromCache' in result) {
        expect(result.fromCache).toBe(false);
        expect(result.schema).toEqual(mockSchema);
      } else {
        throw new Error('Expected DescribeToolResult');
      }
    });

    it('should return fromCache: true for cached schemas', async () => {
      const mockSchema: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object' },
      };

      mockSchemaLoader.mockResolvedValue(mockSchema);

      // First call - loads from server
      const firstResult = await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      if ('schema' in firstResult && 'fromCache' in firstResult) {
        expect(firstResult.fromCache).toBe(false);
      } else {
        throw new Error('Expected DescribeToolResult');
      }

      // Second call - should use cache
      const secondResult = await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(mockSchemaLoader).toHaveBeenCalledTimes(1); // Should not call loader again
      if ('schema' in secondResult && 'fromCache' in secondResult) {
        expect(secondResult.fromCache).toBe(true);
        expect(secondResult.schema).toEqual(mockSchema);
      } else {
        throw new Error('Expected DescribeToolResult');
      }
    });

    it('should return upstream error when loader fails', async () => {
      const loadError = new Error('Connection timeout');
      mockSchemaLoader.mockRejectedValue(loadError);

      const result = await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(mockSchemaLoader).toHaveBeenCalledWith('filesystem', 'read_file');
      expect('error' in result).toBe(true);
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
        expect(result.error.message).toContain('Failed to load schema from server');
        expect(result.error.message).toContain('Connection timeout');
      } else {
        throw new Error('Expected error in result');
      }
    });

    it('should preload schema into cache after loading', async () => {
      const mockSchema: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
        },
      };

      mockSchemaLoader.mockResolvedValue(mockSchema);

      // Verify cache is empty before loading
      expect(schemaCache.getIfCached('filesystem', 'read_file')).toBeFalsy();

      // Load schema
      await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      // Verify schema was preloaded into cache
      const cached = schemaCache.getIfCached('filesystem', 'read_file');
      expect(cached).toBeDefined();
      expect(cached).toEqual(mockSchema);
    });

    it('should handle loader errors gracefully without caching', async () => {
      mockSchemaLoader.mockRejectedValue(new Error('Server unavailable'));

      await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      // Verify nothing was cached on error
      expect(schemaCache.getIfCached('filesystem', 'read_file')).toBeFalsy();

      // Verify loader is called again on retry (not cached)
      mockSchemaLoader.mockClear();
      mockSchemaLoader.mockRejectedValue(new Error('Still unavailable'));

      await providerWithLoader.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(mockSchemaLoader).toHaveBeenCalledTimes(1);
    });
  });

  describe('Server filtering in MetaToolProvider', () => {
    let multiServerProvider: MetaToolProvider;
    let multiServerRegistry: ToolRegistry;
    let multiServerConnections: OutboundConnections;

    beforeEach(() => {
      // Create tools for multiple servers
      const filesystemTools: Tool[] = [
        { name: 'read_file', description: 'Read file', inputSchema: { type: 'object' } },
        { name: 'write_file', description: 'Write file', inputSchema: { type: 'object' } },
      ];

      const searchTools: Tool[] = [
        { name: 'search', description: 'Search', inputSchema: { type: 'object' } },
        { name: 'grep', description: 'Grep', inputSchema: { type: 'object' } },
      ];

      const databaseTools: Tool[] = [{ name: 'query', description: 'Query database', inputSchema: { type: 'object' } }];

      const toolsMap = new Map<string, Tool[]>([
        ['filesystem', filesystemTools],
        ['search', searchTools],
        ['database', databaseTools],
      ]);

      const tagsMap = new Map<string, string[]>([
        ['filesystem', ['fs', 'file']],
        ['search', ['search', 'text']],
        ['database', ['db', 'sql']],
      ]);

      multiServerRegistry = ToolRegistry.fromToolsMap(toolsMap, tagsMap);

      // Create connections for all servers
      multiServerConnections = new Map([
        [
          'filesystem',
          {
            name: 'filesystem',
            client: { callTool: vi.fn() } as any,
            status: ClientStatus.Connected,
            transport: {
              tags: ['fs', 'file'],
              start: vi.fn(),
              send: vi.fn(),
              close: vi.fn(),
            } as any,
            lastConnected: new Date(),
          },
        ],
        [
          'search',
          {
            name: 'search',
            client: { callTool: vi.fn() },
            status: ClientStatus.Connected,
            transport: { tags: ['search', 'text'] },
            lastConnected: new Date(),
          },
        ],
        [
          'database',
          {
            name: 'database',
            client: { callTool: vi.fn() },
            status: ClientStatus.Connected,
            transport: { tags: ['db', 'sql'] },
            lastConnected: new Date(),
          },
        ],
      ]) as OutboundConnections;

      multiServerProvider = new MetaToolProvider(() => multiServerRegistry, schemaCache, multiServerConnections);
    });

    it('should filter tool_list results when allowedServers is set', async () => {
      // Set allowed servers to only filesystem and search
      multiServerProvider.setAllowedServers(new Set(['filesystem', 'search']));

      const result = await multiServerProvider.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }

      if ('tools' in result && 'totalCount' in result) {
        // Should only see tools from filesystem (2) and search (2) = 4 total
        expect(result.totalCount).toBe(4);
        expect(result.tools).toHaveLength(4);

        // Verify no database tools are included
        const toolServers = result.tools.map((t) => t.server);
        expect(toolServers).not.toContain('database');
        expect(toolServers).toContain('filesystem');
        expect(toolServers).toContain('search');

        // Verify servers list is filtered
        expect(result.servers).toHaveLength(2);
        expect(result.servers).toContain('filesystem');
        expect(result.servers).toContain('search');
        expect(result.servers).not.toContain('database');
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should return all tools when allowedServers is undefined', async () => {
      // Clear any filtering
      multiServerProvider.setAllowedServers(undefined);

      const result = await multiServerProvider.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }

      if ('tools' in result && 'totalCount' in result) {
        // Should see all tools: filesystem (2) + search (2) + database (1) = 5 total
        expect(result.totalCount).toBe(5);
        expect(result.tools).toHaveLength(5);

        // Verify all servers are included
        expect(result.servers).toHaveLength(3);
        expect(result.servers).toContain('filesystem');
        expect(result.servers).toContain('search');
        expect(result.servers).toContain('database');
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should return empty list when allowedServers is empty set', async () => {
      // Set allowed servers to empty set
      multiServerProvider.setAllowedServers(new Set([]));

      const result = await multiServerProvider.callMetaTool('tool_list', {});

      expect(result).toBeDefined();
      if ('error' in result && result.error) {
        throw new Error(result.error.message);
      }

      if ('tools' in result && 'totalCount' in result) {
        // Should see no tools
        expect(result.totalCount).toBe(0);
        expect(result.tools).toHaveLength(0);
        expect(result.servers).toHaveLength(0);
      } else {
        throw new Error('Expected ListToolsResult');
      }
    });

    it('should filter tool_schema access to allowed servers only', async () => {
      // Set allowed servers to only filesystem
      multiServerProvider.setAllowedServers(new Set(['filesystem']));

      // Cache a tool from filesystem server
      const filesystemTool: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      };
      schemaCache.set('filesystem', 'read_file', filesystemTool);

      // Cache a tool from database server (blocked)
      const databaseTool: Tool = {
        name: 'query',
        description: 'Query database',
        inputSchema: { type: 'object', properties: { sql: { type: 'string' } } },
      };
      schemaCache.set('database', 'query', databaseTool);

      // Should succeed for allowed server
      const allowedResult = await multiServerProvider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect('error' in allowedResult && allowedResult.error).toBe(false);
      if ('schema' in allowedResult && 'fromCache' in allowedResult) {
        expect(allowedResult.schema.name).toBe('read_file');
        expect(allowedResult.fromCache).toBe(true);
      } else {
        throw new Error('Expected DescribeToolResult');
      }

      // Should fail for blocked server
      const blockedResult = await multiServerProvider.callMetaTool('tool_schema', {
        server: 'database',
        toolName: 'query',
      });

      expect('error' in blockedResult).toBe(true);
      if ('error' in blockedResult && blockedResult.error) {
        expect(blockedResult.error.type).toBe('not_found');
        expect(blockedResult.error.message).toContain('Tool not found');
      } else {
        throw new Error('Expected error in result');
      }
    });

    it('should filter tool_invoke access to allowed servers only', async () => {
      // Set allowed servers to only search
      multiServerProvider.setAllowedServers(new Set(['search']));

      const searchClient = multiServerConnections.get('search')?.client;
      const filesystemClient = multiServerConnections.get('filesystem')?.client;

      if (!searchClient || !filesystemClient) {
        throw new Error('Clients not found');
      }

      // Mock successful response
      (searchClient.callTool as any).mockResolvedValue({
        content: [{ type: 'text', text: 'Search results' }],
      });

      // Should succeed for allowed server
      const allowedResult = await multiServerProvider.callMetaTool('tool_invoke', {
        server: 'search',
        toolName: 'search',
        args: { query: 'test' },
      });

      expect('error' in allowedResult && allowedResult.error).toBe(false);
      if ('result' in allowedResult && 'server' in allowedResult) {
        expect(allowedResult.server).toBe('search');
        expect(allowedResult.tool).toBe('search');
        expect(searchClient.callTool).toHaveBeenCalledWith({
          name: 'search',
          arguments: { query: 'test' },
        });
      } else {
        throw new Error('Expected CallToolResult');
      }

      // Should fail for blocked server
      const blockedResult = await multiServerProvider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: { path: '/test' },
      });

      expect('error' in blockedResult).toBe(true);
      if ('error' in blockedResult && blockedResult.error) {
        expect(blockedResult.error.type).toBe('not_found');
        expect(blockedResult.error.message).toContain('Tool not found');
      } else {
        throw new Error('Expected error in result');
      }

      // Verify filesystem client was never called
      expect(filesystemClient.callTool).not.toHaveBeenCalled();
    });

    it('should return not_found error for filtered servers', async () => {
      // Set allowed servers to only database
      multiServerProvider.setAllowedServers(new Set(['database']));

      // Try to access a tool from filtered-out filesystem server
      const result = await multiServerProvider.callMetaTool('tool_invoke', {
        server: 'filesystem',
        toolName: 'read_file',
        args: { path: '/test/file.txt' },
      });

      expect('error' in result).toBe(true);
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('not_found');
        expect(result.error.message).toContain('Tool not found: filesystem:read_file');
        expect(result.error.message).toContain('Call tool_list to see available tools');
      } else {
        throw new Error('Expected error in result');
      }

      // Verify the correct server context
      if ('server' in result && 'tool' in result) {
        expect(result.server).toBe('filesystem');
        expect(result.tool).toBe('read_file');
      }
    });

    it('should dynamically update filtering when setAllowedServers is called multiple times', async () => {
      // Start with all servers allowed
      multiServerProvider.setAllowedServers(undefined);

      let result = await multiServerProvider.callMetaTool('tool_list', {});
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(5); // All tools
      }

      // Filter to only filesystem
      multiServerProvider.setAllowedServers(new Set(['filesystem']));

      result = await multiServerProvider.callMetaTool('tool_list', {});
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(2); // Only filesystem tools
      }

      // Filter to filesystem and database
      multiServerProvider.setAllowedServers(new Set(['filesystem', 'database']));

      result = await multiServerProvider.callMetaTool('tool_list', {});
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(3); // filesystem (2) + database (1)
      }

      // Clear filter again
      multiServerProvider.setAllowedServers(undefined);

      result = await multiServerProvider.callMetaTool('tool_list', {});
      if ('tools' in result && 'totalCount' in result) {
        expect(result.totalCount).toBe(5); // All tools again
      }
    });
  });

  describe('internal error type handling', () => {
    it('should return internal error type for listAvailableTools registry failures', async () => {
      const failingRegistry: any = {
        listTools: vi.fn(() => {
          throw new Error('Registry corrupted');
        }),
        getServers: vi.fn(() => []),
        filterByServers: vi.fn(function (this: any) {
          return this;
        }),
        hasTool: vi.fn(),
      };

      const internalProvider = new MetaToolProvider(() => failingRegistry, schemaCache, outboundConnections);
      const result = await internalProvider.callMetaTool('tool_list', {});

      expect('error' in result).toBe(true);
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('internal');
        expect(result.error.message).toContain('Internal error listing tools');
      }
    });

    it('should return internal error type for describeTool failures', async () => {
      const failingRegistry: any = {
        listTools: vi.fn(() => ({ tools: [] })),
        getServers: vi.fn(() => []),
        filterByServers: vi.fn(function (this: any) {
          return this;
        }),
        hasTool: vi.fn(() => true), // Tool exists
      };

      const internalProvider = new MetaToolProvider(
        () => failingRegistry,
        schemaCache,
        outboundConnections,
        undefined,
        undefined,
      );

      const result = await internalProvider.callMetaTool('tool_schema', {
        server: 'nonexistent',
        toolName: 'test_tool',
      });

      expect('error' in result).toBe(true);
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('internal');
        expect(result.error.message).toContain('Tool schema not loaded and no SchemaLoader available');
      }
    });

    it('should distinguish between not_found and internal errors', async () => {
      // Test not_found error path - unknown meta-tool
      const notFoundResult = await provider.callMetaTool('unknown_tool', {});
      expect('error' in notFoundResult).toBe(true);
      if ('error' in notFoundResult && notFoundResult.error) {
        expect(notFoundResult.error.type).toBe('not_found');
      }

      // Test internal error path - registry failure
      const failingRegistry: any = {
        listTools: vi.fn(() => {
          throw new Error('Internal failure');
        }),
        getServers: vi.fn(() => []),
        filterByServers: vi.fn(function (this: any) {
          return this;
        }),
        hasTool: vi.fn(),
      };

      const internalProvider = new MetaToolProvider(() => failingRegistry, schemaCache, outboundConnections);
      const internalResult = await internalProvider.callMetaTool('tool_list', {});

      expect('error' in internalResult).toBe(true);
      if ('error' in internalResult && internalResult.error) {
        expect(internalResult.error.type).toBe('internal');
      }
    });
  });
});
