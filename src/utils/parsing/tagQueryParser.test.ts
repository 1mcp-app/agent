import { describe, it, expect } from 'vitest';
import { TagQueryParser, TagExpression } from '@src/utils/parsing/tagQueryParser.js';

describe('TagQueryParser', () => {
  describe('parseSimple', () => {
    it('should parse simple comma-separated tags', () => {
      expect(TagQueryParser.parseSimple('web,api')).toEqual(['web', 'api']);
      expect(TagQueryParser.parseSimple('web, api, database')).toEqual(['web', 'api', 'database']);
    });

    it('should handle empty strings and whitespace', () => {
      expect(TagQueryParser.parseSimple('')).toEqual([]);
      expect(TagQueryParser.parseSimple('  ')).toEqual([]);
      expect(TagQueryParser.parseSimple('web,,api')).toEqual(['web', 'api']);
      expect(TagQueryParser.parseSimple(' web , , api ')).toEqual(['web', 'api']);
    });

    it('should handle invalid input gracefully', () => {
      expect(TagQueryParser.parseSimple(null as any)).toEqual([]);
      expect(TagQueryParser.parseSimple(undefined as any)).toEqual([]);
    });
  });

  describe('parseAdvanced - Simple Tags', () => {
    it('should parse single tag', () => {
      const expr = TagQueryParser.parseAdvanced('web');
      expect(expr).toEqual({
        type: 'tag',
        value: 'web',
      });
    });

    it('should handle tag names with numbers and underscores', () => {
      const expr = TagQueryParser.parseAdvanced('api_v2');
      expect(expr).toEqual({
        type: 'tag',
        value: 'api_v2',
      });
    });

    it('should handle tag names with hyphens', () => {
      const expr = TagQueryParser.parseAdvanced('web-server');
      expect(expr).toEqual({
        type: 'tag',
        value: 'web-server',
      });
    });

    it('should handle hyphenated tag in AND expression', () => {
      const expr = TagQueryParser.parseAdvanced('web+api-test');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api-test' },
        ],
      });
    });
  });

  describe('parseAdvanced - NOT Operations', () => {
    it('should parse NOT with exclamation mark', () => {
      const expr = TagQueryParser.parseAdvanced('!test');
      expect(expr).toEqual({
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      });
    });

    it('should parse NOT with dash prefix', () => {
      const expr = TagQueryParser.parseAdvanced('-test');
      expect(expr).toEqual({
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      });
    });

    it('should parse NOT with natural language', () => {
      const expr = TagQueryParser.parseAdvanced('not test');
      expect(expr).toEqual({
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      });
    });

    it('should distinguish NOT dash from hyphenated tag names', () => {
      // Dash at start or after operator is NOT
      const expr1 = TagQueryParser.parseAdvanced('-test');
      expect(expr1.type).toBe('not');

      const expr2 = TagQueryParser.parseAdvanced('web+-test');
      expect(expr2.type).toBe('and');
      expect(expr2.children![0]).toEqual({ type: 'tag', value: 'web' });
      expect(expr2.children![1].type).toBe('not');

      // Dash in middle is part of tag name
      const expr3 = TagQueryParser.parseAdvanced('web-server');
      expect(expr3).toEqual({
        type: 'tag',
        value: 'web-server',
      });
    });
  });

  describe('parseAdvanced - Compact Syntax', () => {
    it('should parse AND with plus', () => {
      const expr = TagQueryParser.parseAdvanced('web+api');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });

    it('should parse OR with comma', () => {
      const expr = TagQueryParser.parseAdvanced('web,api');
      expect(expr).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });

    it('should parse complex compact expression', () => {
      const expr = TagQueryParser.parseAdvanced('web+api+-test');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
          { type: 'not', children: [{ type: 'tag', value: 'test' }] },
        ],
      });
    });

    it('should parse parentheses with compact syntax', () => {
      const expr = TagQueryParser.parseAdvanced('(web,api)+prod');
      expect(expr).toEqual({
        type: 'and',
        children: [
          {
            type: 'group',
            children: [
              {
                type: 'or',
                children: [
                  { type: 'tag', value: 'web' },
                  { type: 'tag', value: 'api' },
                ],
              },
            ],
          },
          { type: 'tag', value: 'prod' },
        ],
      });
    });
  });

  describe('parseAdvanced - Natural Language', () => {
    it('should parse AND with natural language', () => {
      const expr = TagQueryParser.parseAdvanced('web and api');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });

    it('should parse OR with natural language', () => {
      const expr = TagQueryParser.parseAdvanced('web or api');
      expect(expr).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });

    it('should parse complex natural language expression', () => {
      const expr = TagQueryParser.parseAdvanced('web and api and not test');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
          { type: 'not', children: [{ type: 'tag', value: 'test' }] },
        ],
      });
    });

    it('should be case insensitive for operators', () => {
      const expr = TagQueryParser.parseAdvanced('web AND api OR test');
      expect(expr).toEqual({
        type: 'or',
        children: [
          {
            type: 'and',
            children: [
              { type: 'tag', value: 'web' },
              { type: 'tag', value: 'api' },
            ],
          },
          { type: 'tag', value: 'test' },
        ],
      });
    });
  });

  describe('parseAdvanced - Symbol Syntax', () => {
    it('should parse AND with double ampersand', () => {
      const expr = TagQueryParser.parseAdvanced('web && api');
      expect(expr).toEqual({
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });

    it('should parse OR with double pipe', () => {
      const expr = TagQueryParser.parseAdvanced('web || api');
      expect(expr).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      });
    });
  });

  describe('parseAdvanced - Operator Precedence', () => {
    it('should respect AND/OR precedence (AND higher)', () => {
      const expr = TagQueryParser.parseAdvanced('web or api and test');
      expect(expr).toEqual({
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          {
            type: 'and',
            children: [
              { type: 'tag', value: 'api' },
              { type: 'tag', value: 'test' },
            ],
          },
        ],
      });
    });

    it('should respect NOT precedence (highest)', () => {
      const expr = TagQueryParser.parseAdvanced('web and not test or api');
      expect(expr).toEqual({
        type: 'or',
        children: [
          {
            type: 'and',
            children: [
              { type: 'tag', value: 'web' },
              { type: 'not', children: [{ type: 'tag', value: 'test' }] },
            ],
          },
          { type: 'tag', value: 'api' },
        ],
      });
    });
  });

  describe('parseAdvanced - Parentheses', () => {
    it('should parse simple parentheses', () => {
      const expr = TagQueryParser.parseAdvanced('(web)');
      expect(expr).toEqual({
        type: 'group',
        children: [{ type: 'tag', value: 'web' }],
      });
    });

    it('should override precedence with parentheses', () => {
      const expr = TagQueryParser.parseAdvanced('(web or api) and test');
      expect(expr).toEqual({
        type: 'and',
        children: [
          {
            type: 'group',
            children: [
              {
                type: 'or',
                children: [
                  { type: 'tag', value: 'web' },
                  { type: 'tag', value: 'api' },
                ],
              },
            ],
          },
          { type: 'tag', value: 'test' },
        ],
      });
    });

    it('should parse nested parentheses', () => {
      const expr = TagQueryParser.parseAdvanced('((web))');
      expect(expr).toEqual({
        type: 'group',
        children: [
          {
            type: 'group',
            children: [{ type: 'tag', value: 'web' }],
          },
        ],
      });
    });
  });

  describe('parseAdvanced - Error Cases', () => {
    it('should throw on empty input', () => {
      expect(() => TagQueryParser.parseAdvanced('')).toThrow('Query string cannot be empty');
      expect(() => TagQueryParser.parseAdvanced('   ')).toThrow('Query string cannot be empty');
    });

    it('should throw on null/undefined input', () => {
      expect(() => TagQueryParser.parseAdvanced(null as any)).toThrow('Query string is required');
      expect(() => TagQueryParser.parseAdvanced(undefined as any)).toThrow('Query string is required');
    });

    it('should throw on mismatched parentheses', () => {
      expect(() => TagQueryParser.parseAdvanced('(web')).toThrow('Missing closing parenthesis');
      expect(() => TagQueryParser.parseAdvanced('web)')).toThrow('Unexpected tokens');
    });

    it('should throw on invalid characters', () => {
      expect(() => TagQueryParser.parseAdvanced('web@api')).toThrow('Unexpected character');
    });

    it('should throw on incomplete expressions', () => {
      expect(() => TagQueryParser.parseAdvanced('web and')).toThrow('Unexpected end of input');
      expect(() => TagQueryParser.parseAdvanced('not')).toThrow('Unexpected end of input');
    });
  });

  describe('evaluate', () => {
    const serverTags = ['web', 'api', 'production'];

    it('should evaluate simple tag expressions', () => {
      const expr: TagExpression = { type: 'tag', value: 'web' };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);

      const expr2: TagExpression = { type: 'tag', value: 'database' };
      expect(TagQueryParser.evaluate(expr2, serverTags)).toBe(false);
    });

    it('should evaluate NOT expressions', () => {
      const expr: TagExpression = {
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);

      const expr2: TagExpression = {
        type: 'not',
        children: [{ type: 'tag', value: 'web' }],
      };
      expect(TagQueryParser.evaluate(expr2, serverTags)).toBe(false);
    });

    it('should evaluate AND expressions', () => {
      const expr: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);

      const expr2: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'database' },
        ],
      };
      expect(TagQueryParser.evaluate(expr2, serverTags)).toBe(false);
    });

    it('should evaluate OR expressions', () => {
      const expr: TagExpression = {
        type: 'or',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'database' },
        ],
      };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);

      const expr2: TagExpression = {
        type: 'or',
        children: [
          { type: 'tag', value: 'database' },
          { type: 'tag', value: 'cache' },
        ],
      };
      expect(TagQueryParser.evaluate(expr2, serverTags)).toBe(false);
    });

    it('should evaluate GROUP expressions', () => {
      const expr: TagExpression = {
        type: 'group',
        children: [{ type: 'tag', value: 'web' }],
      };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);
    });

    it('should handle empty server tags', () => {
      const expr: TagExpression = { type: 'tag', value: 'web' };
      expect(TagQueryParser.evaluate(expr, [])).toBe(false);
      expect(TagQueryParser.evaluate(expr, null as any)).toBe(false);
      expect(TagQueryParser.evaluate(expr, undefined as any)).toBe(false);
    });

    it('should evaluate complex expressions', () => {
      // (web or api) and production and not test
      const expr: TagExpression = {
        type: 'and',
        children: [
          {
            type: 'group',
            children: [
              {
                type: 'or',
                children: [
                  { type: 'tag', value: 'web' },
                  { type: 'tag', value: 'api' },
                ],
              },
            ],
          },
          { type: 'tag', value: 'production' },
          { type: 'not', children: [{ type: 'tag', value: 'test' }] },
        ],
      };
      expect(TagQueryParser.evaluate(expr, serverTags)).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    const testCases = [
      {
        query: 'web',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: '!test',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: '!web',
        serverTags: ['web', 'api'],
        expected: false,
      },
      {
        query: 'web+api',
        serverTags: ['web', 'api', 'prod'],
        expected: true,
      },
      {
        query: 'web+database',
        serverTags: ['web', 'api'],
        expected: false,
      },
      {
        query: 'web,database',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: 'database,cache',
        serverTags: ['web', 'api'],
        expected: false,
      },
      {
        query: '(web,api)+prod',
        serverTags: ['web', 'prod'],
        expected: true,
      },
      {
        query: '(web,api)+prod',
        serverTags: ['web', 'test'],
        expected: false,
      },
      {
        query: 'web+api+-test',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: 'web+api+-test',
        serverTags: ['web', 'api', 'test'],
        expected: false,
      },
      {
        query: 'web and api',
        serverTags: ['web', 'api', 'prod'],
        expected: true,
      },
      {
        query: 'web or database',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: 'web && api && !test',
        serverTags: ['web', 'api'],
        expected: true,
      },
      {
        query: 'web || database',
        serverTags: ['database'],
        expected: true,
      },
    ];

    testCases.forEach(({ query, serverTags, expected }, index) => {
      it(`should evaluate "${query}" correctly (test ${index + 1})`, () => {
        const expr = TagQueryParser.parseAdvanced(query);
        const result = TagQueryParser.evaluate(expr, serverTags);
        expect(result).toBe(expected);
      });
    });
  });

  describe('expressionToString', () => {
    it('should convert expressions back to readable strings', () => {
      const expr1: TagExpression = { type: 'tag', value: 'web' };
      expect(TagQueryParser.expressionToString(expr1)).toBe('web');

      const expr2: TagExpression = {
        type: 'not',
        children: [{ type: 'tag', value: 'test' }],
      };
      expect(TagQueryParser.expressionToString(expr2)).toBe('not test');

      const expr3: TagExpression = {
        type: 'and',
        children: [
          { type: 'tag', value: 'web' },
          { type: 'tag', value: 'api' },
        ],
      };
      expect(TagQueryParser.expressionToString(expr3)).toBe('web and api');
    });
  });

  describe('Special Character Handling', () => {
    describe('parseSimple with special characters', () => {
      it('should parse basic comma-separated tags', () => {
        // Note: URL decoding and validation are handled at middleware level
        const result = TagQueryParser.parseSimple('web%20api,mobile%2Dapp');
        expect(result).toEqual(['web%20api', 'mobile%2Dapp']);
      });

      it('should handle tags with commas by splitting them', () => {
        // Commas are used as separators, so they split the tags
        const result = TagQueryParser.parseSimple('web&api,mobile,responsive');
        expect(result).toEqual(['web&api', 'mobile', 'responsive']);
      });

      it('should include all tags - validation is handled at middleware level', () => {
        const longTag = 'a'.repeat(101);
        const result = TagQueryParser.parseSimple(`web,${longTag},api`);
        expect(result).toEqual(['web', longTag, 'api']);
      });

      it('should handle international characters', () => {
        const result = TagQueryParser.parseSimple('wëb,ăpi,мобильный');
        expect(result).toEqual(['wëb', 'ăpi', 'мобильный']);
      });
    });

    describe('parseAdvanced with special characters', () => {
      it('should parse URL encoded tag names as literals', () => {
        // URL decoding handled at middleware level
        expect(() => TagQueryParser.parseAdvanced('web%20api')).toThrow('Unexpected character');
      });

      it('should handle case normalization', () => {
        const expr = TagQueryParser.parseAdvanced('WEB+API');
        expect(expr).toEqual({
          type: 'and',
          children: [
            { type: 'tag', value: 'web' },
            { type: 'tag', value: 'api' },
          ],
        });
      });

      it('should reject invalid characters like @ symbol', () => {
        expect(() => TagQueryParser.parseAdvanced('web@api')).toThrow('Unexpected character');
      });

      it('should handle basic alphanumeric tags', () => {
        const expr = TagQueryParser.parseAdvanced('web123+api456');
        expect(expr).toEqual({
          type: 'and',
          children: [
            { type: 'tag', value: 'web123' },
            { type: 'tag', value: 'api456' },
          ],
        });
      });
    });

    describe('evaluate with normalized comparison', () => {
      it('should match tags case-insensitively', () => {
        const expr: TagExpression = { type: 'tag', value: 'WEB' };
        expect(TagQueryParser.evaluate(expr, ['web', 'api'])).toBe(true);
        expect(TagQueryParser.evaluate(expr, ['Web', 'API'])).toBe(true);
      });

      it('should match URL-encoded vs decoded tags', () => {
        const expr: TagExpression = { type: 'tag', value: 'web%20api' };
        expect(TagQueryParser.evaluate(expr, ['web api', 'mobile'])).toBe(true);
        expect(TagQueryParser.evaluate(expr, ['web%20api', 'mobile'])).toBe(true);
      });

      it('should handle whitespace normalization', () => {
        const expr: TagExpression = { type: 'tag', value: '  web  ' };
        expect(TagQueryParser.evaluate(expr, ['web', 'api'])).toBe(true);
        expect(TagQueryParser.evaluate(expr, ['  WEB  ', 'api'])).toBe(true);
      });

      it('should handle international characters consistently', () => {
        const expr: TagExpression = { type: 'tag', value: 'WËB' };
        expect(TagQueryParser.evaluate(expr, ['wëb', 'api'])).toBe(true);
      });
    });
  });
});
