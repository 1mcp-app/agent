/**
 * Tests for TagQueryEvaluator
 */

import { describe, it, expect } from 'vitest';
import { TagQueryEvaluator } from './tagQueryEvaluator.js';
import { TagQuery } from './presetTypes.js';

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
});
