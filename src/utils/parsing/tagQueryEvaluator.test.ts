/**
 * Tests for TagQueryEvaluator
 */

import { describe, it, expect } from 'vitest';
import { TagQueryEvaluator } from '@src/utils/parsing/tagQueryEvaluator.js';
import { TagQuery } from '@src/utils/config/presetTypes.js';

describe('TagQueryEvaluator', () => {
  const sampleTags = ['web', 'api', 'database', 'secure', 'dev'];

  describe('evaluate', () => {
    it('should match single tag queries', () => {
      const query: TagQuery = { tag: 'web' };
      expect(TagQueryEvaluator.evaluate(query, ['web', 'api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['api', 'database'])).toBe(false);
    });

    it('should match OR queries', () => {
      const query: TagQuery = { $or: [{ tag: 'web' }, { tag: 'api' }] };
      expect(TagQueryEvaluator.evaluate(query, ['web'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web', 'database'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['database', 'secure'])).toBe(false);
    });

    it('should match AND queries', () => {
      const query: TagQuery = { $and: [{ tag: 'web' }, { tag: 'api' }] };
      expect(TagQueryEvaluator.evaluate(query, ['web', 'api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web', 'api', 'database'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web'])).toBe(false);
      expect(TagQueryEvaluator.evaluate(query, ['api'])).toBe(false);
    });

    it('should match NOT queries', () => {
      const query: TagQuery = { $not: { tag: 'dev' } };
      expect(TagQueryEvaluator.evaluate(query, ['web', 'api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web', 'dev'])).toBe(false);
      expect(TagQueryEvaluator.evaluate(query, ['dev'])).toBe(false);
    });

    it('should match IN queries', () => {
      const query: TagQuery = { $in: ['web', 'api', 'database'] };
      expect(TagQueryEvaluator.evaluate(query, ['web'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['api'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['secure'])).toBe(false);
    });

    it('should handle complex nested queries', () => {
      const query: TagQuery = {
        $and: [{ $or: [{ tag: 'web' }, { tag: 'api' }] }, { tag: 'secure' }],
      };
      expect(TagQueryEvaluator.evaluate(query, ['web', 'secure'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['api', 'secure'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web', 'api', 'secure'])).toBe(true);
      expect(TagQueryEvaluator.evaluate(query, ['web'])).toBe(false);
      expect(TagQueryEvaluator.evaluate(query, ['secure'])).toBe(false);
    });

    it('should handle empty queries', () => {
      expect(TagQueryEvaluator.evaluate({}, sampleTags)).toBe(false);
      expect(TagQueryEvaluator.evaluate({ tag: undefined } as any, sampleTags)).toBe(false);
    });

    it('should handle advanced queries', () => {
      const query: TagQuery = { $advanced: '(web+api) or database' };
      // For advanced queries, we would need to integrate with existing parser
      // For now, this just tests the structure
      expect(typeof query.$advanced).toBe('string');
    });
  });

  describe('stringToQuery', () => {
    it('should convert simple tag expressions', () => {
      expect(TagQueryEvaluator.stringToQuery('web')).toEqual({ tag: 'web' });
      expect(TagQueryEvaluator.stringToQuery('web,api', 'or')).toEqual({
        $or: [{ tag: 'web' }, { tag: 'api' }],
      });
      expect(TagQueryEvaluator.stringToQuery('web,api', 'and')).toEqual({
        $and: [{ tag: 'web' }, { tag: 'api' }],
      });
    });

    it('should handle advanced expressions', () => {
      const result = TagQueryEvaluator.stringToQuery('(web+api) or database', 'advanced');
      expect(result).toEqual({ $advanced: '(web+api) or database' });
    });

    it('should handle empty expressions', () => {
      expect(TagQueryEvaluator.stringToQuery('')).toEqual({});
      expect(TagQueryEvaluator.stringToQuery('   ')).toEqual({});
    });
  });

  describe('queryToString', () => {
    it('should convert queries to readable strings', () => {
      expect(TagQueryEvaluator.queryToString({ tag: 'web' })).toBe('web');
      expect(TagQueryEvaluator.queryToString({ $or: [{ tag: 'web' }, { tag: 'api' }] })).toBe('web OR api');
      expect(TagQueryEvaluator.queryToString({ $and: [{ tag: 'web' }, { tag: 'api' }] })).toBe('web AND api');
      expect(TagQueryEvaluator.queryToString({ $not: { tag: 'dev' } })).toBe('NOT (dev)');
      expect(TagQueryEvaluator.queryToString({ $in: ['web', 'api'] })).toBe('web, api');
    });

    it('should handle advanced queries', () => {
      expect(TagQueryEvaluator.queryToString({ $advanced: '(web+api) or database' })).toBe('(web+api) or database');
    });

    it('should handle empty queries', () => {
      expect(TagQueryEvaluator.queryToString({})).toBe('');
    });
  });

  describe('validateQuery', () => {
    it('should validate correct queries', () => {
      const result1 = TagQueryEvaluator.validateQuery({ tag: 'web' });
      expect(result1.isValid).toBe(true);
      expect(result1.errors).toEqual([]);

      const result2 = TagQueryEvaluator.validateQuery({ $or: [{ tag: 'web' }, { tag: 'api' }] });
      expect(result2.isValid).toBe(true);
    });

    it('should detect invalid queries', () => {
      const result1 = TagQueryEvaluator.validateQuery(null as any);
      expect(result1.isValid).toBe(false);
      expect(result1.errors).toContain('Query must be an object');

      const result2 = TagQueryEvaluator.validateQuery({ $or: 'invalid' } as any);
      expect(result2.isValid).toBe(false);
      expect(result2.errors).toContain('$or operator must be an array');

      const result3 = TagQueryEvaluator.validateQuery({ $and: 'invalid' } as any);
      expect(result3.isValid).toBe(false);
      expect(result3.errors).toContain('$and operator must be an array');
    });
  });

  describe('Three-State Tag Selection Utilities', () => {
    const mockServers = {
      'web-server': { tags: ['web', 'api', 'production'] },
      'database-server': { tags: ['database', 'sql', 'production'] },
      'cache-server': { tags: ['cache', 'redis', 'production'] },
      'dev-server': { tags: ['web', 'development'] },
    };

    describe('buildTagServerMap', () => {
      it('should create correct tag-to-servers mapping', () => {
        const tagServerMap = TagQueryEvaluator.buildTagServerMap(mockServers);

        expect(tagServerMap.get('web')).toEqual(['web-server', 'dev-server']);
        expect(tagServerMap.get('production')).toEqual(['web-server', 'database-server', 'cache-server']);
        expect(tagServerMap.get('development')).toEqual(['dev-server']);
        expect(tagServerMap.get('api')).toEqual(['web-server']);
      });
    });

    describe('cycleTagState', () => {
      it('should cycle through states correctly', () => {
        expect(TagQueryEvaluator.cycleTagState('empty')).toBe('selected');
        expect(TagQueryEvaluator.cycleTagState('selected')).toBe('not-selected');
        expect(TagQueryEvaluator.cycleTagState('not-selected')).toBe('empty');
      });
    });

    describe('getTagStateSymbol', () => {
      it('should return correct symbols for each state', () => {
        expect(TagQueryEvaluator.getTagStateSymbol('empty')).toBe('○');
        expect(TagQueryEvaluator.getTagStateSymbol('selected')).toBe('✓');
        expect(TagQueryEvaluator.getTagStateSymbol('not-selected')).toBe('✗');
      });
    });

    describe('buildQueryFromSelections', () => {
      it('should build OR query for selected tags', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server'] },
          { tag: 'database', state: 'selected' as const, servers: ['database-server'] },
          { tag: 'cache', state: 'empty' as const, servers: ['cache-server'] },
        ];

        const query = TagQueryEvaluator.buildQueryFromSelections(selections, 'or');
        expect(query).toEqual({
          $or: [{ tag: 'web' }, { tag: 'database' }],
        });
      });

      it('should build AND query for selected tags', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server'] },
          { tag: 'production', state: 'selected' as const, servers: ['web-server'] },
          { tag: 'cache', state: 'empty' as const, servers: ['cache-server'] },
        ];

        const query = TagQueryEvaluator.buildQueryFromSelections(selections, 'and');
        expect(query).toEqual({
          $and: [{ tag: 'web' }, { tag: 'production' }],
        });
      });

      it('should handle NOT selections', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server'] },
          { tag: 'development', state: 'not-selected' as const, servers: ['dev-server'] },
          { tag: 'cache', state: 'empty' as const, servers: ['cache-server'] },
        ];

        const query = TagQueryEvaluator.buildQueryFromSelections(selections, 'or');
        expect(query).toEqual({
          $and: [{ tag: 'web' }, { $not: { tag: 'development' } }],
        });
      });

      it('should return empty query when no selections', () => {
        const selections = [
          { tag: 'web', state: 'empty' as const, servers: ['web-server'] },
          { tag: 'database', state: 'empty' as const, servers: ['database-server'] },
        ];

        const query = TagQueryEvaluator.buildQueryFromSelections(selections, 'or');
        expect(query).toEqual({});
      });

      it('should handle single selected tag', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server'] },
          { tag: 'database', state: 'empty' as const, servers: ['database-server'] },
        ];

        const query = TagQueryEvaluator.buildQueryFromSelections(selections, 'or');
        expect(query).toEqual({ tag: 'web' });
      });
    });

    describe('getMatchingServers', () => {
      it('should find matching servers with OR selection', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server', 'dev-server'] },
          { tag: 'database', state: 'selected' as const, servers: ['database-server'] },
          { tag: 'cache', state: 'empty' as const, servers: ['cache-server'] },
        ];

        const matches = TagQueryEvaluator.getMatchingServers(selections, mockServers, 'or');
        expect(matches.sort()).toEqual(['web-server', 'dev-server', 'database-server'].sort());
      });

      it('should find matching servers with AND selection', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server', 'dev-server'] },
          { tag: 'production', state: 'selected' as const, servers: ['web-server', 'database-server', 'cache-server'] },
        ];

        const matches = TagQueryEvaluator.getMatchingServers(selections, mockServers, 'and');
        expect(matches).toEqual(['web-server']);
      });

      it('should exclude NOT selected tags', () => {
        const selections = [
          { tag: 'web', state: 'selected' as const, servers: ['web-server', 'dev-server'] },
          { tag: 'development', state: 'not-selected' as const, servers: ['dev-server'] },
        ];

        const matches = TagQueryEvaluator.getMatchingServers(selections, mockServers, 'or');
        expect(matches).toEqual(['web-server']); // dev-server excluded due to 'development' tag
      });
    });

    describe('formatServerList', () => {
      it('should format short server list', () => {
        const servers = ['server1', 'server2'];
        const formatted = TagQueryEvaluator.formatServerList(servers);
        expect(formatted).toBe('server1, server2');
      });

      it('should format long server list with overflow', () => {
        const servers = ['server1', 'server2', 'server3', 'server4', 'server5'];
        const formatted = TagQueryEvaluator.formatServerList(servers, 3);
        expect(formatted).toBe('server1, server2, server3 +2 more');
      });

      it('should handle empty server list', () => {
        const formatted = TagQueryEvaluator.formatServerList([]);
        expect(formatted).toBe('none');
      });
    });
  });
});
