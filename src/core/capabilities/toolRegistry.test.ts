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

    it('should use default limit of 20 when not specified', () => {
      // Create registry with 25+ tools
      const manyTools = Array.from({ length: 25 }, (_, i) => ({
        tool: { name: `tool_${i}`, description: `Tool ${i}`, inputSchema: { type: 'object' as const } },
        server: 'server1',
        tags: [],
      }));
      const largeRegistry = ToolRegistry.fromToolsWithServer(manyTools);

      const result = largeRegistry.listTools({});
      expect(result.tools).toHaveLength(20);
      expect(result.totalCount).toBe(25);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();
    });

    it('should paginate through all tools with default limit', () => {
      const manyTools = Array.from({ length: 45 }, (_, i) => ({
        tool: { name: `tool_${i}`, description: `Tool ${i}`, inputSchema: { type: 'object' as const } },
        server: 'server1',
        tags: [],
      }));
      const largeRegistry = ToolRegistry.fromToolsWithServer(manyTools);

      // Page 1: 20 tools
      const page1 = largeRegistry.listTools({});
      expect(page1.tools).toHaveLength(20);
      expect(page1.hasMore).toBe(true);

      // Page 2: 20 tools
      const page2 = largeRegistry.listTools({ cursor: page1.nextCursor });
      expect(page2.tools).toHaveLength(20);
      expect(page2.hasMore).toBe(true);

      // Page 3: 5 remaining tools
      const page3 = largeRegistry.listTools({ cursor: page2.nextCursor });
      expect(page3.tools).toHaveLength(5);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeUndefined();
    });

    it('should return all tools when total is less than default limit', () => {
      const result = registry.listTools({});
      expect(result.tools).toHaveLength(6); // mockTools has 6 tools
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeUndefined();
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

  describe('filterByServers', () => {
    it('should return new registry with only tools from specified servers', () => {
      const serverNames = new Set(['filesystem', 'database']);
      const filtered = registry.filterByServers(serverNames);

      expect(filtered.size()).toBe(4);
      expect(filtered.hasTool('filesystem', 'read_file')).toBe(true);
      expect(filtered.hasTool('filesystem', 'write_file')).toBe(true);
      expect(filtered.hasTool('database', 'query')).toBe(true);
      expect(filtered.hasTool('database', 'execute')).toBe(true);
      expect(filtered.hasTool('search', 'search')).toBe(false);
      expect(filtered.hasTool('git', 'git_status')).toBe(false);
    });

    it('should return empty registry when no servers match', () => {
      const serverNames = new Set(['nonexistent', 'another_nonexistent']);
      const filtered = registry.filterByServers(serverNames);

      expect(filtered.size()).toBe(0);
      expect(filtered.getAllTools()).toHaveLength(0);
    });

    it('should handle empty server set', () => {
      const serverNames = new Set<string>();
      const filtered = registry.filterByServers(serverNames);

      expect(filtered.size()).toBe(0);
      expect(filtered.getAllTools()).toHaveLength(0);
    });

    it('should preserve tool metadata in filtered registry', () => {
      const serverNames = new Set(['filesystem']);
      const filtered = registry.filterByServers(serverNames);

      const readFileTool = filtered.getTool('filesystem', 'read_file');
      expect(readFileTool).toEqual({
        name: 'read_file',
        server: 'filesystem',
        description: 'Read a file',
        tags: ['fs', 'file'],
      });

      const writeFileTool = filtered.getTool('filesystem', 'write_file');
      expect(writeFileTool).toEqual({
        name: 'write_file',
        server: 'filesystem',
        description: 'Write a file',
        tags: ['fs', 'file'],
      });
    });

    it('should work correctly with getAllTools() after filtering', () => {
      const serverNames = new Set(['database', 'git']);
      const filtered = registry.filterByServers(serverNames);

      const allTools = filtered.getAllTools();
      expect(allTools).toHaveLength(3);
      expect(allTools.every((t) => t.server === 'database' || t.server === 'git')).toBe(true);
      expect(allTools.map((t) => t.name)).toContain('query');
      expect(allTools.map((t) => t.name)).toContain('execute');
      expect(allTools.map((t) => t.name)).toContain('git_status');
    });

    it('should work correctly with listTools() after filtering', () => {
      const serverNames = new Set(['filesystem']);
      const filtered = registry.filterByServers(serverNames);

      const result = filtered.listTools({});
      expect(result.tools).toHaveLength(2);
      expect(result.totalCount).toBe(2);
      expect(result.hasMore).toBe(false);
      expect(result.tools.every((t) => t.server === 'filesystem')).toBe(true);
    });

    it('should work correctly with getServers() after filtering', () => {
      const serverNames = new Set(['filesystem', 'database']);
      const filtered = registry.filterByServers(serverNames);

      const servers = filtered.getServers();
      expect(servers).toEqual(['database', 'filesystem']);
      expect(servers).not.toContain('search');
      expect(servers).not.toContain('git');
    });

    it('should work correctly with getTags() after filtering', () => {
      const serverNames = new Set(['filesystem']);
      const filtered = registry.filterByServers(serverNames);

      const tags = filtered.getTags();
      expect(tags).toContain('fs');
      expect(tags).toContain('file');
      expect(tags).not.toContain('db');
      expect(tags).not.toContain('git');
    });

    it('should work correctly with getToolCountByServer() after filtering', () => {
      const serverNames = new Set(['filesystem', 'search']);
      const filtered = registry.filterByServers(serverNames);

      const counts = filtered.getToolCountByServer();
      expect(counts).toEqual({
        filesystem: 2,
        search: 1,
      });
      expect(counts).not.toHaveProperty('database');
      expect(counts).not.toHaveProperty('git');
    });

    it('should support chaining multiple filters', () => {
      const serverNames1 = new Set(['filesystem', 'database', 'git']);
      const filtered1 = registry.filterByServers(serverNames1);
      expect(filtered1.size()).toBe(5);

      const serverNames2 = new Set(['filesystem', 'git']);
      const filtered2 = filtered1.filterByServers(serverNames2);
      expect(filtered2.size()).toBe(3);
      expect(filtered2.hasTool('filesystem', 'read_file')).toBe(true);
      expect(filtered2.hasTool('git', 'git_status')).toBe(true);
      expect(filtered2.hasTool('database', 'query')).toBe(false);
    });

    it('should create independent registry instance', () => {
      const serverNames = new Set(['filesystem']);
      const filtered = registry.filterByServers(serverNames);

      // Original registry should remain unchanged
      expect(registry.size()).toBe(6);
      expect(filtered.size()).toBe(2);

      // Modifying filtered should not affect original
      expect(registry.hasTool('database', 'query')).toBe(true);
      expect(filtered.hasTool('database', 'query')).toBe(false);
    });

    it('should filter single server correctly', () => {
      const serverNames = new Set(['search']);
      const filtered = registry.filterByServers(serverNames);

      expect(filtered.size()).toBe(1);
      expect(filtered.hasTool('search', 'search')).toBe(true);
      expect(filtered.getServers()).toEqual(['search']);
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

  describe('pattern validation', () => {
    it('should escape special regex characters in patterns', () => {
      const specialPatternRegistry = ToolRegistry.empty();
      const specialTools = [
        { name: 'foo[bar]', server: 'server1', description: 'Tool with brackets' },
        { name: 'foo(bar)', server: 'server1', description: 'Tool with parens' },
        { name: 'foo+bar', server: 'server1', description: 'Tool with plus' },
        { name: 'foo$bar', server: 'server1', description: 'Tool with dollar' },
        { name: 'foo^bar', server: 'server1', description: 'Tool with caret' },
        { name: 'foo.bar', server: 'server1', description: 'Tool with dot' },
        { name: 'foo|bar', server: 'server1', description: 'Tool with pipe' },
        { name: 'foo\\bar', server: 'server1', description: 'Tool with backslash' },
      ];

      for (const tool of specialTools) {
        (specialPatternRegistry as any).tools.push(tool);
      }

      // These should match the exact tool names (special chars are escaped)
      const result1 = specialPatternRegistry.listTools({ pattern: 'foo[bar]' });
      expect(result1.tools).toHaveLength(1);
      expect(result1.tools[0].name).toBe('foo[bar]');

      const result2 = specialPatternRegistry.listTools({ pattern: 'foo(bar)' });
      expect(result2.tools).toHaveLength(1);
      expect(result2.tools[0].name).toBe('foo(bar)');

      const result3 = specialPatternRegistry.listTools({ pattern: 'foo+bar' });
      expect(result3.tools).toHaveLength(1);
      expect(result3.tools[0].name).toBe('foo+bar');
    });

    it('should still support wildcard patterns after escaping', () => {
      const wildcardRegistry = ToolRegistry.empty();
      const wildcardTools = [
        { name: 'test_read_file', server: 'server1', description: 'Test' },
        { name: 'test_write_file', server: 'server1', description: 'Test' },
        { name: 'prod_read_file', server: 'server1', description: 'Prod' },
        { name: 'prod_write_file', server: 'server1', description: 'Prod' },
      ];

      for (const tool of wildcardTools) {
        (wildcardRegistry as any).tools.push(tool);
      }

      // * should match any characters
      const result1 = wildcardRegistry.listTools({ pattern: '*_read_file' });
      expect(result1.tools).toHaveLength(2);
      expect(result1.tools.map((t) => t.name)).toContain('test_read_file');
      expect(result1.tools.map((t) => t.name)).toContain('prod_read_file');

      // ? should match single character
      const result2 = wildcardRegistry.listTools({ pattern: '????_read_file' });
      expect(result2.tools).toHaveLength(2);

      // Multiple wildcards
      const result3 = wildcardRegistry.listTools({ pattern: '*_*_file' });
      expect(result3.tools).toHaveLength(4);
    });

    it('should handle patterns with mixed special chars and wildcards', () => {
      const mixedRegistry = ToolRegistry.empty();
      const mixedTools = [
        { name: 'foo[bar]_test', server: 'server1', description: 'Mixed' },
        { name: 'foo[bar]_prod', server: 'server1', description: 'Mixed' },
        { name: 'foo[baz]_test', server: 'server1', description: 'Mixed' },
      ];

      for (const tool of mixedTools) {
        (mixedRegistry as any).tools.push(tool);
      }

      // Escaped brackets + wildcard
      const result = mixedRegistry.listTools({ pattern: 'foo[bar]_*' });
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toContain('foo[bar]_test');
      expect(result.tools.map((t) => t.name)).toContain('foo[bar]_prod');
    });

    it('should handle invalid regex patterns gracefully', () => {
      const invalidPatternRegistry = ToolRegistry.empty();
      const invalidTools = [
        { name: 'valid_tool', server: 'server1', description: 'Valid' },
        { name: 'another_tool', server: 'server1', description: 'Valid' },
      ];

      for (const tool of invalidTools) {
        (invalidPatternRegistry as any).tools.push(tool);
      }

      // Pattern with unmatched brackets that would cause invalid regex
      // The escaping should handle this, but if it still fails, it should not crash
      const result = invalidPatternRegistry.listTools({ pattern: 'foo[bar' });
      // Should return empty or not crash - pattern doesn't match any tools
      expect(result.tools).toBeDefined();
    });
  });
});
