import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FilteringService } from './filteringService.js';
import { ClientStatus } from '@src/core/types/client.js';
import { TagExpression } from '@src/utils/parsing/tagQueryParser.js';
import type { OutboundConnections, OutboundConnection, InboundConnectionConfig } from '@src/core/types/index.js';

// Mock dependencies
vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('FilteringService', () => {
  let mockConnections: OutboundConnections;

  beforeEach(() => {
    mockConnections = new Map([
      [
        'web-server',
        {
          name: 'web-server',
          transport: { tags: ['web', 'frontend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          capabilities: { resources: {} },
        } as OutboundConnection,
      ],
      [
        'database-server',
        {
          name: 'database-server',
          transport: { tags: ['database', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          capabilities: { tools: {} },
        } as OutboundConnection,
      ],
      [
        'api-server',
        {
          name: 'api-server',
          transport: { tags: ['api', 'backend'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Connected,
          capabilities: { prompts: {} },
        } as OutboundConnection,
      ],
      [
        'disconnected-server',
        {
          name: 'disconnected-server',
          transport: { tags: ['disconnected'], timeout: 5000 },
          client: {} as any,
          status: ClientStatus.Disconnected,
          capabilities: {},
        } as OutboundConnection,
      ],
    ]);
  });

  describe('getFilteredConnections', () => {
    it('should return all connected servers when no filter is specified', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(3); // Only connected servers
      expect(result.has('web-server')).toBe(true);
      expect(result.has('database-server')).toBe(true);
      expect(result.has('api-server')).toBe(true);
      expect(result.has('disconnected-server')).toBe(false);
    });

    it('should filter by simple tags using OR logic', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web', 'frontend'],
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(1);
      expect(result.has('web-server')).toBe(true);
      expect(result.has('database-server')).toBe(false);
      expect(result.has('api-server')).toBe(false);
    });

    it('should filter by backend tags', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['backend'],
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(2);
      expect(result.has('database-server')).toBe(true);
      expect(result.has('api-server')).toBe(true);
      expect(result.has('web-server')).toBe(false);
    });

    it('should filter by advanced tag expressions', () => {
      const tagExpression: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'backend' },
          { type: 'tag', value: 'api' },
        ],
      };

      const config: InboundConnectionConfig = {
        tagFilterMode: 'advanced',
        tagExpression,
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(1);
      expect(result.has('api-server')).toBe(true);
      expect(result.has('database-server')).toBe(false);
      expect(result.has('web-server')).toBe(false);
    });

    it('should filter by preset tag query', () => {
      const tagQuery = {
        $or: [{ tag: 'web' }, { tag: 'api' }],
      };

      const config: InboundConnectionConfig = {
        tagFilterMode: 'preset',
        tagQuery,
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(2);
      expect(result.has('web-server')).toBe(true);
      expect(result.has('api-server')).toBe(true);
      expect(result.has('database-server')).toBe(false);
    });

    it('should return empty map when no servers match filter', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['nonexistent'],
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(0);
    });

    it('should exclude disconnected servers', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['disconnected'],
      };

      const result = FilteringService.getFilteredConnections(mockConnections, config);

      expect(result.size).toBe(0);
      expect(result.has('disconnected-server')).toBe(false);
    });
  });

  describe('createFilter', () => {
    it('should create a filter for simple tags', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web'],
      };

      const filter = FilteringService.createFilter(config);
      const result = filter(mockConnections);

      expect(result.size).toBe(1);
      expect(result.has('web-server')).toBe(true);
    });

    it('should create a pass-through filter for no filtering', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const filter = FilteringService.createFilter(config);
      const result = filter(mockConnections);

      expect(result.size).toBe(4); // All connections, including disconnected
      expect(result.has('disconnected-server')).toBe(true);
    });
  });

  describe('byTags', () => {
    it('should return all connections when no tags provided', () => {
      const filter = FilteringService.byTags();
      const result = filter(mockConnections);

      expect(result.size).toBe(4); // All connections
    });

    it('should filter connections by tags', () => {
      const filter = FilteringService.byTags(['backend']);
      const result = filter(mockConnections);

      expect(result.size).toBe(2);
      expect(result.has('database-server')).toBe(true);
      expect(result.has('api-server')).toBe(true);
    });
  });

  describe('byCapabilities', () => {
    it('should filter connections by capabilities', () => {
      const filter = FilteringService.byCapabilities({ resources: {} });
      const result = filter(mockConnections);

      expect(result.size).toBe(1);
      expect(result.has('web-server')).toBe(true);
    });

    it('should return empty when no connections have required capabilities', () => {
      const filter = FilteringService.byCapabilities({ nonexistent: {} });
      const result = filter(mockConnections);

      expect(result.size).toBe(0);
    });
  });

  describe('combineFilters', () => {
    it('should combine multiple filters using AND logic', () => {
      const tagFilter = FilteringService.byTags(['backend']);
      const capabilityFilter = FilteringService.byCapabilities({ tools: {} });
      const combinedFilter = FilteringService.combineFilters(tagFilter, capabilityFilter);

      const result = combinedFilter(mockConnections);

      expect(result.size).toBe(1);
      expect(result.has('database-server')).toBe(true);
    });

    it('should return empty when combined filters exclude all connections', () => {
      const tagFilter = FilteringService.byTags(['web']);
      const capabilityFilter = FilteringService.byCapabilities({ tools: {} });
      const combinedFilter = FilteringService.combineFilters(tagFilter, capabilityFilter);

      const result = combinedFilter(mockConnections);

      expect(result.size).toBe(0);
    });
  });

  describe('getFilteringSummary', () => {
    it('should provide filtering statistics', () => {
      const filtered = new Map([['web-server', mockConnections.get('web-server')!]]);

      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web'],
      };

      const summary = FilteringService.getFilteringSummary(mockConnections, filtered, config);

      expect(summary.original).toBe(4);
      expect(summary.filtered).toBe(1);
      expect(summary.removed).toBe(3);
      expect(summary.filterType).toBe('simple-or');
      expect(summary.filteredNames).toEqual(['web-server']);
      expect(summary.removedNames).toEqual(['api-server', 'database-server', 'disconnected-server']);
    });

    it('should handle no filtering', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const summary = FilteringService.getFilteringSummary(mockConnections, mockConnections, config);

      expect(summary.original).toBe(4);
      expect(summary.filtered).toBe(4);
      expect(summary.removed).toBe(0);
      expect(summary.filterType).toBe('none');
    });
  });
});
