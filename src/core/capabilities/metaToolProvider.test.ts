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
        expect(result.error.message).toContain('Validation Error');
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

    it('should return upstream error if schema not loaded', async () => {
      const result = await provider.callMetaTool('tool_schema', {
        server: 'filesystem',
        toolName: 'read_file',
      });

      expect('error' in result).toBe(true);
      expect(result.error).toBeDefined();
      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
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
        arguments: {},
      });

      if ('error' in result && result.error) {
        expect(result.error.type).toBe('upstream');
      } else {
        throw new Error('Expected error in result');
      }
    });
  });
});
