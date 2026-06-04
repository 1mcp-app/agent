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
