import { MCPServerParams } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { TemplateIndex } from './templateIndex.js';

describe('TemplateIndex', () => {
  let index: TemplateIndex;
  const sampleTemplates: Record<string, MCPServerParams> = {
    'web-server': {
      command: 'echo',
      args: ['web-server'],
      tags: ['web', 'production', 'api'],
    },
    'database-server': {
      command: 'echo',
      args: ['database-server'],
      tags: ['database', 'production', 'postgres'],
    },
    'test-server': {
      command: 'echo',
      args: ['test-server'],
      tags: ['web', 'testing', 'development'],
    },
    'cache-server': {
      command: 'echo',
      args: ['cache-server'],
      tags: ['cache', 'redis', 'production'],
    },
    'multi-tag-server': {
      command: 'echo',
      args: ['multi-tag-server'],
      tags: ['web', 'database', 'production'],
    },
    'no-tags-server': {
      command: 'echo',
      args: ['no-tags-server'],
      // No tags
    },
  };

  beforeEach(() => {
    index = new TemplateIndex();
  });

  describe('buildIndex', () => {
    it('should build index from templates', () => {
      index.buildIndex(sampleTemplates);

      expect(index.isBuilt()).toBe(true);
      expect(index.getAllTemplateNames()).toHaveLength(6);
      expect(index.getAllTags()).toContain('web');
      expect(index.getAllTags()).toContain('database');
      expect(index.getAllTags()).toContain('production');
    });

    it('should handle empty templates', () => {
      index.buildIndex({});

      expect(index.isBuilt()).toBe(true);
      expect(index.getAllTemplateNames()).toHaveLength(0);
      expect(index.getAllTags()).toHaveLength(0);
    });

    it('should rebuild index correctly', () => {
      index.buildIndex({ template1: { command: 'echo', args: ['t1'], tags: ['tag1'] } });
      expect(index.getAllTemplateNames()).toEqual(['template1']);

      index.buildIndex({ template2: { command: 'echo', args: ['t2'], tags: ['tag2'] } });
      expect(index.getAllTemplateNames()).toEqual(['template2']);
    });
  });

  describe('getTemplatesByTag', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should return templates by tag', () => {
      const webTemplates = index.getTemplatesByTag('web');
      expect(webTemplates).toHaveLength(3);
      expect(webTemplates).toContain('web-server');
      expect(webTemplates).toContain('test-server');
      expect(webTemplates).toContain('multi-tag-server');
    });

    it('should return empty array for non-existent tag', () => {
      const templates = index.getTemplatesByTag('non-existent');
      expect(templates).toHaveLength(0);
    });

    it('should handle case-insensitive tag lookup', () => {
      const templates = index.getTemplatesByTag('WEB');
      expect(templates).toHaveLength(3);
    });

    it('should handle templates without tags', () => {
      const noTagTemplates = index.getTemplatesByTag('non-existent-tag');
      expect(noTagTemplates).toHaveLength(0);

      // No-tags server should not be returned for any tag
      const allTags = index.getAllTags();
      for (const tag of allTags) {
        const templates = index.getTemplatesByTag(tag);
        expect(templates).not.toContain('no-tags-server');
      }
    });
  });

  describe('getTemplatesByTags', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should return templates matching any specified tag (OR logic)', () => {
      const templates = index.getTemplatesByTags(['web', 'database']);
      expect(templates).toHaveLength(4);
      expect(templates).toContain('web-server');
      expect(templates).toContain('test-server');
      expect(templates).toContain('database-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should handle empty tags array', () => {
      const templates = index.getTemplatesByTags([]);
      expect(templates).toHaveLength(0);
    });

    it('should handle single tag', () => {
      const templates = index.getTemplatesByTags(['production']);
      expect(templates).toHaveLength(4);
      expect(templates).toContain('web-server');
      expect(templates).toContain('database-server');
      expect(templates).toContain('cache-server');
      expect(templates).toContain('multi-tag-server');
    });
  });

  describe('getTemplatesByAllTags', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should return templates matching all specified tags (AND logic)', () => {
      const templates = index.getTemplatesByAllTags(['web', 'production']);
      expect(templates).toHaveLength(2);
      expect(templates).toContain('web-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should return empty array when no template matches all tags', () => {
      const templates = index.getTemplatesByAllTags(['web', 'cache']);
      expect(templates).toHaveLength(0);
    });

    it('should handle single tag', () => {
      const templates = index.getTemplatesByAllTags(['production']);
      expect(templates).toHaveLength(4);
    });
  });

  describe('evaluateExpression', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should evaluate simple AND expression', () => {
      const templates = index.evaluateExpression('web AND production');
      expect(templates).toHaveLength(2);
      expect(templates).toContain('web-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should evaluate OR expression', () => {
      const templates = index.evaluateExpression('web OR cache');
      expect(templates).toHaveLength(4);
      expect(templates).toContain('web-server');
      expect(templates).toContain('test-server');
      expect(templates).toContain('cache-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should evaluate NOT expression', () => {
      const templates = index.evaluateExpression('production AND NOT web');
      expect(templates).toHaveLength(2);
      expect(templates).toContain('database-server');
      expect(templates).toContain('cache-server');
    });

    it('should evaluate complex expression with parentheses', () => {
      const templates = index.evaluateExpression('(web OR database) AND production');
      expect(templates).toHaveLength(3);
      expect(templates).toContain('web-server');
      expect(templates).toContain('database-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should handle invalid expression gracefully', () => {
      const templates = index.evaluateExpression('invalid syntax (((');
      expect(templates).toHaveLength(0);
    });

    it('should handle expression that matches all templates', () => {
      const templates = index.evaluateExpression('production OR testing OR cache OR web OR database');
      expect(templates).toHaveLength(5); // All except no-tags-server
    });

    it('should handle expression that matches no templates', () => {
      const templates = index.evaluateExpression('non-existent-tag');
      expect(templates).toHaveLength(0);
    });
  });

  describe('evaluateTagQuery', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should evaluate MongoDB-style tag query', () => {
      const query = { $and: [{ tag: 'web' }, { tag: 'production' }] };
      const templates = index.evaluateTagQuery(query);
      expect(templates).toHaveLength(2);
      expect(templates).toContain('web-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should evaluate OR query', () => {
      const query = { $or: [{ tag: 'web' }, { tag: 'cache' }] };
      const templates = index.evaluateTagQuery(query);
      expect(templates).toHaveLength(4);
      expect(templates).toContain('web-server');
      expect(templates).toContain('test-server');
      expect(templates).toContain('cache-server');
      expect(templates).toContain('multi-tag-server');
    });

    it('should evaluate NOT query', () => {
      const query = { $not: { tag: 'web' } };
      const templates = index.evaluateTagQuery(query);
      expect(templates).toHaveLength(3);
      expect(templates).toContain('database-server');
      expect(templates).toContain('cache-server');
      expect(templates).toContain('no-tags-server');
    });

    it('should evaluate complex nested query', () => {
      const query = {
        $and: [{ tag: 'production' }, { $or: [{ tag: 'web' }, { tag: 'cache' }] }],
      };
      const templates = index.evaluateTagQuery(query);
      expect(templates).toHaveLength(3);
      expect(templates).toContain('web-server');
      expect(templates).toContain('cache-server');
      expect(templates).toContain('multi-tag-server');
    });
  });

  describe('getTemplate and hasTemplate', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should get template entry', () => {
      const template = index.getTemplate('web-server');
      expect(template).toBeDefined();
      expect(template?.name).toBe('web-server');
      expect(template?.tagCount).toBe(3);
      expect(Array.from(template!.tags)).toContain('web');
      expect(Array.from(template!.tags)).toContain('production');
      expect(Array.from(template!.tags)).toContain('api');
    });

    it('should return null for non-existent template', () => {
      const template = index.getTemplate('non-existent');
      expect(template).toBeNull();
    });

    it('should check if template exists', () => {
      expect(index.hasTemplate('web-server')).toBe(true);
      expect(index.hasTemplate('non-existent')).toBe(false);
    });
  });

  describe('getPopularTags', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should return tags sorted by popularity', () => {
      const popularTags = index.getPopularTags();
      expect(popularTags.length).toBeGreaterThan(0);

      // production appears 4 times, should be most popular
      expect(popularTags[0].tag).toBe('production');
      expect(popularTags[0].count).toBe(4);

      // web and database appear 2 times each
      const webTag = popularTags.find((tag) => tag.tag === 'web');
      const databaseTag = popularTags.find((tag) => tag.tag === 'database');
      expect(webTag?.count).toBe(3);
      expect(databaseTag?.count).toBe(2);
    });

    it('should respect limit parameter', () => {
      const popularTags = index.getPopularTags(2);
      expect(popularTags).toHaveLength(2);
      expect(popularTags[0].tag).toBe('production');
    });
  });

  describe('getStats', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should provide comprehensive statistics', () => {
      const stats = index.getStats();

      expect(stats.totalTemplates).toBe(6);
      expect(stats.uniqueTags).toBeGreaterThan(0);
      expect(stats.averageTagsPerTemplate).toBeGreaterThan(0);
      expect(stats.mostPopularTag).toBeDefined();
      expect(stats.mostPopularTag?.tag).toBe('production');
      expect(stats.mostPopularTag?.count).toBe(4);
      expect(stats.buildTime).toBeGreaterThanOrEqual(0);
      expect(stats.indexSize).toBeGreaterThan(0);
    });

    it('should handle empty index', () => {
      const emptyIndex = new TemplateIndex();
      emptyIndex.buildIndex({});

      const stats = emptyIndex.getStats();
      expect(stats.totalTemplates).toBe(0);
      expect(stats.uniqueTags).toBe(0);
      expect(stats.averageTagsPerTemplate).toBe(0);
      expect(stats.mostPopularTag).toBeNull();
    });
  });

  describe('optimize', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should optimize index', () => {
      const statsBefore = index.getStats();
      index.optimize();
      const statsAfter = index.getStats();

      // Optimization should not change the basic stats
      expect(statsAfter.totalTemplates).toBe(statsBefore.totalTemplates);
      expect(statsAfter.uniqueTags).toBe(statsBefore.uniqueTags);
    });
  });

  describe('getDebugInfo', () => {
    beforeEach(() => {
      index.buildIndex(sampleTemplates);
    });

    it('should provide detailed debugging information', () => {
      const debugInfo = index.getDebugInfo();

      expect(debugInfo.templates).toHaveLength(6);
      expect(debugInfo.templates[0]).toEqual({
        name: expect.any(String),
        tagCount: expect.any(Number),
        tags: expect.any(Array),
      });

      expect(debugInfo.tagDistribution.length).toBeGreaterThan(0);
      expect(debugInfo.tagDistribution[0]).toEqual({
        tag: expect.any(String),
        count: expect.any(Number),
        templates: expect.any(Array),
      });

      expect(debugInfo.stats).toEqual(index.getStats());
    });
  });

  describe('error handling', () => {
    it('should return empty results when index not built', () => {
      const templates = index.getTemplatesByTag('web');
      expect(templates).toHaveLength(0);

      const evalResults = index.evaluateExpression('web AND production');
      expect(evalResults).toHaveLength(0);
    });

    it('should handle templates with undefined/null tags', () => {
      const templatesWithUndefinedTags: Record<string, MCPServerParams> = {
        'undefined-tags': {
          command: 'echo',
          args: ['undefined-tags'],
          tags: undefined,
        },
        'null-tags': {
          command: 'echo',
          args: ['null-tags'],
          tags: [],
        },
      };

      index.buildIndex(templatesWithUndefinedTags);

      expect(index.isBuilt()).toBe(true);
      expect(index.getAllTemplateNames()).toHaveLength(2);
      expect(index.getAllTags()).toHaveLength(0);
    });
  });
});
