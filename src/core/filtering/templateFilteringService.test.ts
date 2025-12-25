import { MCPServerParams } from '@src/core/types/index.js';
import { InboundConnectionConfig } from '@src/core/types/index.js';

import { describe, expect, it } from 'vitest';

import { TemplateFilteringService } from './templateFilteringService.js';

describe('TemplateFilteringService', () => {
  const sampleTemplates: Array<[string, MCPServerParams]> = [
    [
      'web-server',
      {
        command: 'echo',
        args: ['web-server'],
        tags: ['web', 'production', 'api'],
      },
    ],
    [
      'database-server',
      {
        command: 'echo',
        args: ['database-server'],
        tags: ['database', 'production', 'postgres'],
      },
    ],
    [
      'test-server',
      {
        command: 'echo',
        args: ['test-server'],
        tags: ['web', 'testing', 'development'],
      },
    ],
    [
      'cache-server',
      {
        command: 'echo',
        args: ['cache-server'],
        tags: ['cache', 'redis', 'production'],
      },
    ],
    [
      'no-tags',
      {
        command: 'echo',
        args: ['no-tags'],
      },
    ],
  ];

  describe('getMatchingTemplates', () => {
    it('should return all templates when no filtering is specified', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
      };

      const result = TemplateFilteringService.getMatchingTemplates(sampleTemplates, config);

      expect(result).toHaveLength(5);
      expect(result.map(([name]) => name)).toEqual(
        expect.arrayContaining(['web-server', 'database-server', 'test-server', 'cache-server', 'no-tags']),
      );
    });

    it('should filter by single tag', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web'],
      };

      const result = TemplateFilteringService.getMatchingTemplates(sampleTemplates, config);

      expect(result).toHaveLength(2);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'test-server']);
    });

    it('should filter by multiple tags (OR logic)', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web', 'database'],
      };

      const result = TemplateFilteringService.getMatchingTemplates(sampleTemplates, config);

      expect(result).toHaveLength(3);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'database-server', 'test-server']);
    });

    it('should filter by preset name', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'none',
        presetName: 'production',
      };

      const result = TemplateFilteringService.getMatchingTemplates(sampleTemplates, config);

      // When presetName is specified, it should filter by that preset regardless of mode
      expect(result).toHaveLength(3);
      expect(result.map(([name]) => name)).toEqual(
        expect.arrayContaining(['web-server', 'database-server', 'cache-server']),
      );
    });

    it('should return empty array for non-existent tag', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['non-existent'],
      };

      const result = TemplateFilteringService.getMatchingTemplates(sampleTemplates, config);

      expect(result).toHaveLength(0);
    });

    it('should handle empty templates array', () => {
      const config: InboundConnectionConfig = {
        tagFilterMode: 'simple-or',
        tags: ['web'],
      };

      const result = TemplateFilteringService.getMatchingTemplates([], config);

      expect(result).toHaveLength(0);
    });
  });

  describe('createFilter', () => {
    it('should create filter for simple tag filtering', () => {
      const filter = TemplateFilteringService.createFilter({
        tags: ['web'],
        mode: 'simple-or',
      });

      const result = filter(sampleTemplates);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'test-server']);
    });

    it('should create filter for preset filtering', () => {
      const filter = TemplateFilteringService.createFilter({
        presetName: 'production',
        mode: 'preset',
      });

      const result = filter(sampleTemplates);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'database-server', 'cache-server']);
    });
  });

  describe('byTags', () => {
    it('should filter by tags with case-insensitive matching', () => {
      const filter = TemplateFilteringService.byTags(['WEB']);
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(2);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'test-server']);
    });

    it('should return all templates when no tags specified', () => {
      const filter = TemplateFilteringService.byTags([]);
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(5);
    });
  });

  describe('byPreset', () => {
    it('should filter templates by preset name', () => {
      const filter = TemplateFilteringService.byPreset('production');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(3);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'database-server', 'cache-server']);
    });

    it('should return empty array for non-existent preset', () => {
      const filter = TemplateFilteringService.byPreset('non-existent');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(0);
    });
  });

  describe('byTagExpression', () => {
    it('should handle simple AND expression', () => {
      const filter = TemplateFilteringService.byTagExpression('web AND production');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(1);
      expect(result.map(([name]) => name)).toEqual(['web-server']);
    });

    it('should handle OR expression', () => {
      const filter = TemplateFilteringService.byTagExpression('web OR database');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(3);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'database-server', 'test-server']);
    });

    it('should handle NOT expression', () => {
      const filter = TemplateFilteringService.byTagExpression('production AND NOT web');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(2);
      expect(result.map(([name]) => name)).toEqual(['database-server', 'cache-server']);
    });

    it('should handle complex expression with parentheses', () => {
      const filter = TemplateFilteringService.byTagExpression('(web OR cache) AND production');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(2);
      expect(result.map(([name]) => name)).toEqual(['web-server', 'cache-server']);
    });

    it('should return all templates on parse error', () => {
      const filter = TemplateFilteringService.byTagExpression('invalid syntax (((');
      const result = filter(sampleTemplates);

      expect(result).toHaveLength(5); // Should return all templates on parse error
    });
  });

  describe('combineFilters', () => {
    it('should combine filters with AND logic', () => {
      const tagFilter = TemplateFilteringService.byTags(['web']);
      const presetFilter = TemplateFilteringService.byPreset('production');
      const combined = TemplateFilteringService.combineFilters(tagFilter, presetFilter);

      const result = combined(sampleTemplates);

      expect(result).toHaveLength(1);
      expect(result.map(([name]) => name)).toEqual(['web-server']);
    });

    it('should handle empty filter list', () => {
      const combined = TemplateFilteringService.combineFilters();
      const result = combined(sampleTemplates);

      expect(result).toHaveLength(5);
    });

    it('should handle single filter', () => {
      const tagFilter = TemplateFilteringService.byTags(['web']);
      const combined = TemplateFilteringService.combineFilters(tagFilter);

      const result = combined(sampleTemplates);

      expect(result).toHaveLength(2);
    });
  });

  describe('getFilteringSummary', () => {
    it('should provide filtering summary', () => {
      const original = sampleTemplates;
      const filtered = original.filter(([_, config]) => config.tags?.includes('web'));

      const summary = TemplateFilteringService.getFilteringSummary(original, filtered, {
        mode: 'simple-or',
        tags: ['web'],
      });

      expect(summary.original).toBe(5);
      expect(summary.filtered).toBe(2);
      expect(summary.removed).toBe(3);
      expect(summary.filterType).toBe('simple-or');
      expect(summary.filteredNames).toEqual(['test-server', 'web-server']);
      expect(summary.removedNames).toEqual(['cache-server', 'database-server', 'no-tags']);
    });
  });
});
