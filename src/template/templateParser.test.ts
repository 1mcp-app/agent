import type { ContextData } from '@src/types/context.js';

import { describe, expect, it } from 'vitest';

import { TemplateParser } from './templateParser.js';

describe('TemplateParser', () => {
  let parser: TemplateParser;
  let mockContext: ContextData;

  beforeEach(() => {
    parser = new TemplateParser();
    mockContext = {
      project: {
        path: '/Users/test/project',
        name: 'my-project',
        environment: 'development',
        git: {
          branch: 'main',
          commit: 'abc12345',
          repository: 'test/repo',
          isRepo: true,
        },
        custom: {
          apiEndpoint: 'https://api.test.com',
          version: '1.0.0',
        },
      },
      user: {
        username: 'testuser',
        name: 'Test User',
        email: 'test@example.com',
        home: '/Users/testuser',
        uid: '1000',
        gid: '1000',
        shell: '/bin/bash',
      },
      environment: {
        variables: {
          NODE_ENV: 'test',
          API_KEY: 'secret',
        },
        prefixes: ['APP_'],
      },
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'ctx_test123',
      version: 'v1',
    };
  });

  describe('parse', () => {
    it('should parse simple variables', () => {
      const result = parser.parse('{project.path}', mockContext);
      expect(result.processed).toBe('/Users/test/project');
      expect(result.errors).toHaveLength(0);
    });

    it('should parse nested variables', () => {
      const result = parser.parse('{project.git.branch}', mockContext);
      expect(result.processed).toBe('main');
    });

    it('should parse multiple variables', () => {
      const result = parser.parse('{user.username}@{project.name}.com', mockContext);
      expect(result.processed).toBe('testuser@my-project.com');
    });

    it('should handle optional variables', () => {
      const result = parser.parse('{project.custom.nonexistent?:default}', mockContext);
      expect(result.processed).toBe('default');
    });

    it('should handle missing optional variables', () => {
      const result = parser.parse('{project.custom.missing?}', mockContext);
      expect(result.processed).toBe('');
    });

    it('should return errors for missing required variables', () => {
      const result = parser.parse('{project.nonexistent}', mockContext);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should preserve non-template text', () => {
      const result = parser.parse('Hello, {user.username}!', mockContext);
      expect(result.processed).toBe('Hello, testuser!');
    });

    it('should handle empty strings', () => {
      const result = parser.parse('', mockContext);
      expect(result.processed).toBe('');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle strings without variables', () => {
      const result = parser.parse('static text', mockContext);
      expect(result.processed).toBe('static text');
      expect(result.variables).toHaveLength(0);
    });
  });

  describe('parseMultiple', () => {
    it('should parse multiple templates', () => {
      const templates = ['{project.path}', '{user.username}', '{project.environment}'];
      const results = parser.parseMultiple(templates, mockContext);

      expect(results).toHaveLength(3);
      expect(results[0].processed).toBe('/Users/test/project');
      expect(results[1].processed).toBe('testuser');
      expect(results[2].processed).toBe('development');
    });
  });

  describe('extractVariables', () => {
    it('should extract variables without processing', () => {
      const variables = parser.extractVariables('{project.path} and {user.username}');
      expect(variables).toHaveLength(2);
      expect(variables[0].name).toBe('project.path');
      expect(variables[1].name).toBe('user.username');
    });
  });

  describe('hasVariables', () => {
    it('should detect variables in template', () => {
      expect(parser.hasVariables('{project.path}')).toBe(true);
      expect(parser.hasVariables('static text')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle invalid namespace', () => {
      const result = parser.parse('{invalid.path}', mockContext);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Invalid namespace');
    });

    it('should handle empty variable', () => {
      const result = parser.parse('{}', mockContext);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle unmatched braces', () => {
      const result = parser.parse('{unclosed', mockContext);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle undefined values in strict mode', () => {
      const strictParser = new TemplateParser({ strictMode: true, allowUndefined: false });
      const result = strictParser.parse('{project.custom.missing}', mockContext);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('custom context', () => {
    it('should work with custom context fields', () => {
      const result = parser.parse('{project.custom.apiEndpoint}', mockContext);
      expect(result.processed).toBe('https://api.test.com');
    });

    it('should work with environment context', () => {
      const result = parser.parse('{context.sessionId}', mockContext);
      expect(result.processed).toBe('ctx_test123');
    });
  });
});
