import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { ToolMetadata, ToolRegistry } from './toolRegistry.js';

describe('ToolRegistry', () => {
  const mockTools: ToolMetadata[] = [
    { name: 'read_file', server: 'filesystem', description: 'Read a file', tags: ['fs', 'file'] },
    { name: 'write_file', server: 'filesystem', description: 'Write a file', tags: ['fs', 'file'] },
    { name: 'search', server: 'search', description: 'Search files', tags: ['search'] },
    { name: 'query', server: 'database', description: 'Query database', tags: ['db', 'sql'] },
    { name: 'execute', server: 'database', description: 'Execute command', tags: ['db'] },
    { name: 'git_status', server: 'git', description: 'Git status', tags: ['git', 'vcs'] },
  ];

  let registry: ToolRegistry;

  beforeEach(() => {
    registry = ToolRegistry.empty();
    // Manually add tools since constructor is private
    for (const tool of mockTools) {
      // Use reflection to access private constructor
      (registry as any).tools.push(tool);
    }
  });

  describe('Basic Operations', () => {
    it('should create registry from tools', () => {
      expect(registry.size()).toBe(6);
    });

    it('should create empty registry', () => {
      const empty = ToolRegistry.empty();
      expect(empty.size()).toBe(0);
    });

    it('should get all tools', () => {
      const tools = registry.getAllTools();
      expect(tools).toHaveLength(6);
      expect(tools).toEqual(mockTools);
    });

    it('should check if tool exists', () => {
      expect(registry.hasTool('filesystem', 'read_file')).toBe(true);
      expect(registry.hasTool('filesystem', 'not_exists')).toBe(false);
      expect(registry.hasTool('not_exists', 'read_file')).toBe(false);
    });

    it('should get tool by server and name', () => {
      const tool = registry.getTool('filesystem', 'read_file');
      expect(tool).toEqual({
        name: 'read_file',
        server: 'filesystem',
        description: 'Read a file',
        tags: ['fs', 'file'],
      });

      const notFound = registry.getTool('not_exists', 'not_exists');
      expect(notFound).toBeUndefined();
    });
  });

  describe('Filtering', () => {
    it('should list all tools without filters', () => {
      const result = registry.listTools({});
      expect(result.tools).toHaveLength(6);
      expect(result.totalCount).toBe(6);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by server', () => {
      const result = registry.listTools({ server: 'filesystem' });
      expect(result.tools).toHaveLength(2);
      expect(result.tools.every((t) => t.server === 'filesystem')).toBe(true);
      expect(result.totalCount).toBe(2);
    });

    it('should filter by pattern', () => {
      const result = registry.listTools({ pattern: '*file*' });
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toContain('read_file');
      expect(result.tools.map((t) => t.name)).toContain('write_file');
    });

    it('should filter by tag', () => {
      const result = registry.listTools({ tag: 'db' });
      expect(result.tools).toHaveLength(2);
      expect(result.tools.every((t) => t.tags?.includes('db'))).toBe(true);
    });

    it('should combine multiple filters', () => {
      const result = registry.listTools({ server: 'database', tag: 'db' });
      expect(result.tools).toHaveLength(2);
      expect(result.tools.every((t) => t.server === 'database')).toBe(true);
      expect(result.tools.every((t) => t.tags?.includes('db'))).toBe(true);
    });

    it('should return empty result for non-matching filter', () => {
      const result = registry.listTools({ server: 'not_exists' });
      expect(result.tools).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('Pagination', () => {
    it('should paginate results with limit', () => {
      const result = registry.listTools({ limit: 2 });
      expect(result.tools).toHaveLength(2);
      expect(result.totalCount).toBe(6);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should use cursor for next page', () => {
      const page1 = registry.listTools({ limit: 2 });
      expect(page1.tools).toHaveLength(2);

      const page2 = registry.listTools({
        limit: 2,
        cursor: page1.nextCursor,
      });
      expect(page2.tools).toHaveLength(2);
      expect(page2.tools).not.toEqual(page1.tools);
      expect(page2.hasMore).toBe(true);
    });

    it('should indicate no more pages on last page', () => {
      const page1 = registry.listTools({ limit: 2 });
      const page2 = registry.listTools({ limit: 2, cursor: page1.nextCursor });
      const page3 = registry.listTools({ limit: 2, cursor: page2.nextCursor });

      expect(page3.tools).toHaveLength(2);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('should handle limit larger than result set', () => {
      const result = registry.listTools({ limit: 100 });
      expect(result.tools).toHaveLength(6);
      expect(result.hasMore).toBe(false);
    });

    it('should cap limit at 5000', () => {
      // Create a large registry using fromToolsWithServer factory
      const toolsWithServer = Array.from({ length: 6000 }, (_, i) => ({
        tool: { name: `tool_${i}`, description: `Tool ${i}`, inputSchema: { type: 'object' as const } },
        server: 'server1',
        tags: [],
      }));
      const largeRegistry = ToolRegistry.fromToolsWithServer(toolsWithServer);

      const result = largeRegistry.listTools({ limit: 10000 });
      expect(result.tools).toHaveLength(5000);
      expect(result.hasMore).toBe(true);
    });

    it('should preserve filters across pagination', () => {
      const page1 = registry.listTools({ server: 'database', limit: 1 });
      expect(page1.tools).toHaveLength(1);
      expect(page1.tools[0].server).toBe('database');

      const page2 = registry.listTools({ server: 'database', limit: 1, cursor: page1.nextCursor });
      expect(page2.tools).toHaveLength(1);
      expect(page2.tools[0].server).toBe('database');
      expect(page2.tools[0].name).not.toBe(page1.tools[0].name);
    });
  });

  describe('Server and Tag Operations', () => {
    it('should get unique server names', () => {
      const servers = registry.getServers();
      expect(servers).toEqual(['database', 'filesystem', 'git', 'search']);
    });

    it('should get unique tags', () => {
      const tags = registry.getTags();
      expect(tags).toContain('db');
      expect(tags).toContain('fs');
      expect(tags).toContain('git');
      expect(tags).toContain('search');
    });

    it('should get tool count by server', () => {
      const counts = registry.getToolCountByServer();
      expect(counts).toEqual({
        filesystem: 2,
        search: 1,
        database: 2,
        git: 1,
      });
    });

    it('should group tools by server', () => {
      const grouped = registry.groupByServer();

      expect(Object.keys(grouped)).toHaveLength(4);
      expect(grouped.filesystem).toHaveLength(2);
      expect(grouped.database).toHaveLength(2);
      expect(grouped.search).toHaveLength(1);
      expect(grouped.git).toHaveLength(1);
    });

    it('should categorize tools by tags', () => {
      const categorized = registry.categorizeByTags();

      expect(categorized).toHaveProperty('fs');
      expect(categorized).toHaveProperty('db');
      expect(categorized).toHaveProperty('git');

      // Tools with 'fs' tag
      expect(categorized.fs.tools).toHaveLength(2);
      expect(categorized.fs.tools.every((t: ToolMetadata) => t.tags?.includes('fs'))).toBe(true);

      // Tools with 'db' tag
      expect(categorized.db.tools).toHaveLength(2);
      expect(categorized.db.tools.every((t: ToolMetadata) => t.tags?.includes('db'))).toBe(true);
    });
  });

  describe('Build from Tools Map', () => {
    it('should build registry from tools map', () => {
      const toolsMap = new Map<string, Tool[]>([
        ['test-server', [{ name: 'test_tool', description: 'Test', inputSchema: { type: 'object' } }]],
      ]);

      const tagsMap = new Map<string, string[]>([['test-server', ['test']]]);

      const builtRegistry = ToolRegistry.fromToolsMap(toolsMap, tagsMap);

      expect(builtRegistry.size()).toBe(1);
      expect(builtRegistry.hasTool('test-server', 'test_tool')).toBe(true);
    });

    it('should build registry from tools with server info', () => {
      const toolsWithServer: Array<{ tool: Tool; server: string; tags?: string[] }> = [
        {
          tool: { name: 'tool1', description: 'Tool 1', inputSchema: { type: 'object' } },
          server: 'server1',
          tags: ['tag1'],
        },
        {
          tool: { name: 'tool2', description: 'Tool 2', inputSchema: { type: 'object' } },
          server: 'server2',
          tags: ['tag2'],
        },
      ];

      const builtRegistry = ToolRegistry.fromToolsWithServer(toolsWithServer);

      expect(builtRegistry.size()).toBe(2);
      expect(builtRegistry.hasTool('server1', 'tool1')).toBe(true);
      expect(builtRegistry.hasTool('server2', 'tool2')).toBe(true);
    });

    it('should handle empty tools map', () => {
      const toolsMap = new Map<string, Tool[]>();
      const builtRegistry = ToolRegistry.fromToolsMap(toolsMap);

      expect(builtRegistry.size()).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle tools without tags', () => {
      const noTagRegistry = ToolRegistry.empty();
      const noTagTools = [
        { name: 'tool1', server: 'server1', description: 'Tool 1' },
        { name: 'tool2', server: 'server2', description: 'Tool 2', tags: [] },
      ];

      for (const tool of noTagTools) {
        (noTagRegistry as any).tools.push(tool);
      }

      const categorized = noTagRegistry.categorizeByTags();

      expect(categorized).toHaveProperty('uncategorized');
      expect(categorized.uncategorized.tools).toHaveLength(2);
    });

    it('should handle invalid cursor gracefully', () => {
      const result = registry.listTools({ cursor: 'invalid-base64-cursor' });
      // Should default to offset 0
      expect(result.tools.length).toBeGreaterThan(0);
    });

    it('should handle empty pattern (match all)', () => {
      const result = registry.listTools({ pattern: '*' });
      expect(result.tools).toHaveLength(6);
    });

    it('should handle pattern that matches nothing', () => {
      const result = registry.listTools({ pattern: 'notfound*' });
      expect(result.tools).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });
  });
});
