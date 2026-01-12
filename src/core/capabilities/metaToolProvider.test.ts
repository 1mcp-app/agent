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

    provider = new MetaToolProvider(toolRegistry, schemaCache, outboundConnections);
  });

  describe('getMetaTools', () => {
    it('should return exactly 3 meta-tools', () => {
      const metaTools = provider.getMetaTools();
      expect(metaTools).toHaveLength(3);
    });

    it('should include mcp_list_available_tools', () => {
      const metaTools = provider.getMetaTools();
      const listTool = metaTools.find((t) => t.name === 'mcp_list_available_tools');
      expect(listTool).toBeDefined();
      expect(listTool?.description).toContain('List all available MCP tools');
    });

    it('should include mcp_describe_tool', () => {
      const metaTools = provider.getMetaTools();
      const describeTool = metaTools.find((t) => t.name === 'mcp_describe_tool');
      expect(describeTool).toBeDefined();
      expect(describeTool?.description).toContain('complete definition');
    });

    it('should include mcp_call_tool', () => {
      const metaTools = provider.getMetaTools();
      const callTool = metaTools.find((t) => t.name === 'mcp_call_tool');
      expect(callTool).toBeDefined();
      expect(callTool?.description).toContain('Invoke any available MCP tool');
    });

    it('should require server and toolName for describe_tool', () => {
      const metaTools = provider.getMetaTools();
      const describeTool = metaTools.find((t) => t.name === 'mcp_describe_tool');
      expect(describeTool?.inputSchema.required).toContain('server');
      expect(describeTool?.inputSchema.required).toContain('toolName');
    });

    it('should require server, toolName, and args for call_tool', () => {
      const metaTools = provider.getMetaTools();
      const callTool = metaTools.find((t) => t.name === 'mcp_call_tool');
      expect(callTool?.inputSchema.required).toContain('server');
      expect(callTool?.inputSchema.required).toContain('toolName');
      expect(callTool?.inputSchema.required).toContain('args');
    });
  });

  describe('callMetaTool - mcp_list_available_tools', () => {
    it('should list all tools without filters', async () => {
      const result = await provider.callMetaTool('mcp_list_available_tools', {});

      expect(result.isError).toBeFalsy();
      expect(result.content).toBeDefined();
      expect(result._meta?.totalCount).toBe(3);
      expect((result._meta as any).tools).toBeDefined();
    });

    it('should filter by server', async () => {
      const result = await provider.callMetaTool('mcp_list_available_tools', { server: 'filesystem' });

      expect(result.isError).toBeFalsy();
      expect(result._meta?.totalCount).toBe(3);
    });

    it('should filter by pattern', async () => {
      const result = await provider.callMetaTool('mcp_list_available_tools', { pattern: '*file*' });

      expect(result.isError).toBeFalsy();
      expect(result._meta?.totalCount).toBe(2);
    });

    it('should support pagination', async () => {
      const result = await provider.callMetaTool('mcp_list_available_tools', { limit: 2 });

      expect(result.isError).toBeFalsy();
      expect((result._meta as any)?.tools.length).toBe(2);
      expect(result._meta?.hasMore).toBe(true);
      expect(result._meta?.nextCursor).toBeDefined();
    });

    it('should handle unknown meta-tool', async () => {
      const result = await provider.callMetaTool('unknown_tool', {});

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('not_found');
      expect(result.content[0].text).toContain('Unknown meta-tool');
    });
  });

  describe('callMetaTool - mcp_describe_tool', () => {
    it('should require server and toolName', async () => {
      const result = await provider.callMetaTool('mcp_describe_tool', {});

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('validation');
      expect(result.content[0].text).toContain('Validation Error');
    });

    it('should return error for non-existent tool', async () => {
      const result = await provider.callMetaTool('mcp_describe_tool', {
        server: 'filesystem',
        toolName: 'not_exists',
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('not_found');
      expect(result.content[0].text).toContain('Tool not found');
    });

    it('should return schema from cache if available', async () => {
      const mockTool: Tool = {
        name: 'read_file',
        description: 'Read file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      };

      schemaCache.set('filesystem', 'read_file', mockTool);

      const result = await provider.callMetaTool('mcp_describe_tool', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(result.isError).toBeFalsy();
      expect(result._meta?.fromCache).toBe(true);
      expect(result.content[0].text).toContain('read_file');
    });

    it('should return upstream error if schema not loaded', async () => {
      const result = await provider.callMetaTool('mcp_describe_tool', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('upstream');
    });
  });

  describe('callMetaTool - mcp_call_tool', () => {
    it('should require server and toolName', async () => {
      const result = await provider.callMetaTool('mcp_call_tool', {});

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('validation');
    });

    it('should return error for non-existent tool', async () => {
      const result = await provider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'not_exists',
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('not_found');
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

      const disconnectedProvider = new MetaToolProvider(toolRegistry, schemaCache, disconnectedConnections);

      const result = await disconnectedProvider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('upstream');
      expect(result.content[0].text).toContain('not connected');
    });

    it('should call tool on upstream server', async () => {
      const mockResult = {
        content: [{ type: 'text', text: 'File contents' }],
      };

      mockClient.callTool.mockResolvedValue(mockResult);

      const result = await provider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'read_file',
        args: { path: '/test/file.txt' },
      });

      expect(result.isError).toBeFalsy();
      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: 'read_file',
        arguments: { path: '/test/file.txt' },
      });
    });

    it('should handle upstream server errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Upstream error'));

      const result = await provider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('upstream');
      expect(result.content[0].text).toContain('Server Error');
    });

    it('should detect not found errors from upstream', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Tool not found: read_file'));

      const result = await provider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'read_file',
        args: {},
      });

      expect(result.isError).toBe(true);
      expect(result._errorType).toBe('not_found');
    });
  });

  describe('Error Response Format', () => {
    it('should include error type in validation errors', async () => {
      const result = await provider.callMetaTool('mcp_describe_tool', {});

      expect(result._errorType).toBe('validation');
    });

    it('should include error type in not_found errors', async () => {
      const result = await provider.callMetaTool('mcp_describe_tool', {
        server: 'filesystem',
        toolName: 'not_exists',
      });

      expect(result._errorType).toBe('not_found');
    });

    it('should include error type in upstream errors', async () => {
      mockClient.callTool.mockRejectedValue(new Error('Server error'));

      const result = await provider.callMetaTool('mcp_call_tool', {
        server: 'filesystem',
        toolName: 'read_file',
        arguments: {},
      });

      expect(result._errorType).toBe('upstream');
    });
  });
});
