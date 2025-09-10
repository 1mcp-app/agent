import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from './searchFiltering.js';
import type { RegistryServer } from '../core/registry/types.js';

describe('SearchEngine', () => {
  let searchEngine: SearchEngine;
  let mockServers: RegistryServer[];

  beforeEach(() => {
    searchEngine = new SearchEngine();
    mockServers = [
      {
        $schema: 'https://schema.org/mcp-server',
        name: 'file-manager',
        description: 'Comprehensive file management system with advanced features',
        status: 'active',
        repository: {
          url: 'https://github.com/test/file-manager',
          source: 'github',
        },
        version: '1.0.0',
        packages: [
          {
            registry_type: 'npm',
            identifier: '@test/file-manager',
            version: '1.0.0',
            transport: 'stdio',
          },
        ],
        _meta: {
          id: 'file-manager-1',
          published_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-06-01T00:00:00Z',
          is_latest: true,
        },
      },
      {
        $schema: 'https://schema.org/mcp-server',
        name: 'database-connector',
        description: 'Database integration and query management',
        status: 'active',
        repository: {
          url: 'https://github.com/test/database-connector',
          source: 'github',
        },
        version: '2.1.0',
        packages: [
          {
            registry_type: 'pypi',
            identifier: 'database-connector',
            version: '2.1.0',
            transport: 'sse',
          },
        ],
        _meta: {
          id: 'database-connector-1',
          published_at: '2024-02-01T00:00:00Z',
          updated_at: '2024-07-01T00:00:00Z',
          is_latest: true,
        },
      },
      {
        $schema: 'https://schema.org/mcp-server',
        name: 'legacy-files',
        description: 'Old file system utilities (deprecated)',
        status: 'deprecated',
        repository: {
          url: 'https://github.com/test/legacy-files',
          source: 'github',
        },
        version: '0.9.0',
        packages: [
          {
            registry_type: 'npm',
            identifier: '@test/legacy-files',
            version: '0.9.0',
            transport: 'stdio',
          },
        ],
        _meta: {
          id: 'legacy-files-1',
          published_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-06-01T00:00:00Z',
          is_latest: false,
        },
      },
    ];
  });

  describe('fuzzySearch', () => {
    it('should return all servers for empty query', () => {
      const result = searchEngine.fuzzySearch('', mockServers);
      expect(result).toHaveLength(mockServers.length);
    });

    it('should find exact name matches', () => {
      const result = searchEngine.fuzzySearch('file-manager', mockServers);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file-manager');
    });

    it('should find partial name matches', () => {
      const result = searchEngine.fuzzySearch('file', mockServers);
      expect(result).toHaveLength(2); // file-manager and legacy-files
      expect(result[0].name).toBe('file-manager'); // Should rank exact match higher
    });

    it('should search in descriptions', () => {
      const result = searchEngine.fuzzySearch('database', mockServers);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('database-connector');
    });

    it('should handle multiple words', () => {
      const result = searchEngine.fuzzySearch('file management', mockServers);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('file-manager');
    });

    it('should be case insensitive', () => {
      const result = searchEngine.fuzzySearch('FILE', mockServers);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should rank results by relevance', () => {
      const result = searchEngine.fuzzySearch('file', mockServers);
      // file-manager should rank higher than legacy-files due to status and recency
      expect(result[0].name).toBe('file-manager');
    });
  });

  describe('filterByStatus', () => {
    it('should filter by active status', () => {
      const result = searchEngine.filterByStatus(mockServers, 'active');
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.status === 'active')).toBe(true);
    });

    it('should filter by deprecated status', () => {
      const result = searchEngine.filterByStatus(mockServers, 'deprecated');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('legacy-files');
    });

    it('should return all servers for "all" status', () => {
      const result = searchEngine.filterByStatus(mockServers, 'all');
      expect(result).toHaveLength(mockServers.length);
    });

    it('should return all servers for empty status', () => {
      const result = searchEngine.filterByStatus(mockServers, '');
      expect(result).toHaveLength(mockServers.length);
    });
  });

  describe('filterByRegistryType', () => {
    it('should filter by npm registry type', () => {
      const result = searchEngine.filterByRegistryType(mockServers, 'npm');
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.packages.some((p) => p.registry_type === 'npm'))).toBe(true);
    });

    it('should filter by pypi registry type', () => {
      const result = searchEngine.filterByRegistryType(mockServers, 'pypi');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('database-connector');
    });

    it('should return all servers for empty type', () => {
      const result = searchEngine.filterByRegistryType(mockServers, '');
      expect(result).toHaveLength(mockServers.length);
    });
  });

  describe('filterByTransport', () => {
    it('should filter by stdio transport', () => {
      const result = searchEngine.filterByTransport(mockServers, 'stdio');
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.packages.some((p) => p.transport === 'stdio'))).toBe(true);
    });

    it('should filter by sse transport', () => {
      const result = searchEngine.filterByTransport(mockServers, 'sse');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('database-connector');
    });

    it('should return all servers for empty transport', () => {
      const result = searchEngine.filterByTransport(mockServers, '');
      expect(result).toHaveLength(mockServers.length);
    });
  });

  describe('rankResults', () => {
    it('should rank by update recency when no query provided', () => {
      const result = searchEngine.rankResults(mockServers);
      // database-connector was updated most recently (2024-07-01)
      expect(result[0].name).toBe('database-connector');
    });

    it('should use fuzzy search ranking when query provided', () => {
      const result = searchEngine.rankResults(mockServers, 'file');
      // Should prioritize active servers and better matches
      expect(result[0].name).toBe('file-manager');
    });
  });

  describe('applyFilters', () => {
    it('should apply all filters together', () => {
      const result = searchEngine.applyFilters(mockServers, {
        query: 'file',
        status: 'active',
        registry_type: 'npm',
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file-manager');
    });

    it('should handle no matches', () => {
      const result = searchEngine.applyFilters(mockServers, {
        query: 'nonexistent',
        status: 'active',
      });

      expect(result).toHaveLength(0);
    });

    it('should work with only search query', () => {
      const result = searchEngine.applyFilters(mockServers, {
        query: 'database',
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('database-connector');
    });

    it('should work with only filters', () => {
      const result = searchEngine.applyFilters(mockServers, {
        status: 'deprecated',
        registry_type: 'npm',
      });

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('legacy-files');
    });
  });

  describe('calculateFuzzyScore', () => {
    it('should score exact matches highest', () => {
      const score1 = (searchEngine as any).calculateFuzzyScore('test', 'test');
      const score2 = (searchEngine as any).calculateFuzzyScore('testing', 'test');
      expect(score1).toBeGreaterThan(score2);
    });

    it('should score substring matches well', () => {
      const score1 = (searchEngine as any).calculateFuzzyScore('test-string', 'test');
      const score2 = (searchEngine as any).calculateFuzzyScore('tset-gnirts', 'test');
      expect(score1).toBeGreaterThan(score2);
    });
  });
});
