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
});
