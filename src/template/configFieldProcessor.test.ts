import type { ContextData } from '@src/types/context.js';

import { describe, expect, it, vi } from 'vitest';

import { ConfigFieldProcessor } from './configFieldProcessor.js';
import { TemplateParser } from './templateParser.js';
import { TemplateValidator } from './templateValidator.js';

describe('ConfigFieldProcessor', () => {
  let processor: ConfigFieldProcessor;
  let mockContext: ContextData;

  beforeEach(() => {
    const parser = new TemplateParser({ strictMode: false });
    const validator = new TemplateValidator();
    processor = new ConfigFieldProcessor(parser, validator);

    mockContext = {
      project: {
        path: '/test/project',
        name: 'test-project',
        git: {
          branch: 'main',
          commit: 'abc123',
          repository: 'test/repo',
          isRepo: true,
        },
      },
      user: {
        username: 'testuser',
        email: 'test@example.com',
        home: '/home/testuser',
      },
      environment: {
        variables: {
          NODE_ENV: 'test',
          API_KEY: 'secret',
        },
      },
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'test-session',
      version: 'v1',
    };
  });

  describe('processStringField', () => {
    it('should return unchanged value if no variables', () => {
      const result = processor.processStringField('static-value', 'test', mockContext, [], []);

      expect(result).toBe('static-value');
    });

    it('should process template variables', () => {
      const result = processor.processStringField('{project.name}', 'test', mockContext, [], []);

      expect(result).toBe('test-project');
    });

    it('should handle multiple variables', () => {
      const result = processor.processStringField('{user.username}@{project.name}.com', 'test', mockContext, [], []);

      expect(result).toBe('testuser@test-project.com');
    });

    it('should collect errors for invalid templates', () => {
      const errors: string[] = [];
      processor.processStringField('{invalid.variable}', 'test', mockContext, errors, []);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('test:');
    });

    it('should track processed templates', () => {
      const processed: string[] = [];
      processor.processStringField('{project.path}', 'test', mockContext, [], processed);

      expect(processed).toHaveLength(1);
      expect(processed[0]).toBe('test: {project.path} -> /test/project');
    });
  });

  describe('processArrayField', () => {
    it('should process array with templates', () => {
      const values = ['{project.path}', 'static', '{user.username}'];
      const processed: string[] = [];
      const result = processor.processArrayField(values, 'args', mockContext, [], processed);

      expect(result).toEqual(['/test/project', 'static', 'testuser']);
      expect(processed).toHaveLength(2);
    });

    it('should handle empty array', () => {
      const result = processor.processArrayField([], 'args', mockContext, [], []);

      expect(result).toEqual([]);
    });
  });

  describe('processRecordField', () => {
    it('should process record values with templates', () => {
      const obj = {
        PATH: '{project.path}',
        NAME: '{project.name}',
        STATIC: 'unchanged',
      };
      const processed: string[] = [];
      const result = processor.processRecordField(obj, 'env', mockContext, [], processed);

      expect(result).toEqual({
        PATH: '/test/project',
        NAME: 'test-project',
        STATIC: 'unchanged',
      });
      expect(processed).toHaveLength(2);
    });

    it('should ignore non-string values', () => {
      const obj: Record<string, unknown> = {
        number: 42,
        boolean: true,
        string: '{project.name}',
      };
      const result = processor.processRecordField(obj as Record<string, string>, 'env', mockContext, [], []);

      expect(result).toEqual({
        number: 42,
        boolean: true,
        string: 'test-project',
      });
    });
  });

  describe('with template processor callback', () => {
    it('should use external template processor when provided', () => {
      const mockTemplateProcessor = vi.fn().mockReturnValue({
        original: '{project.name}',
        processed: 'processed-value',
        variables: [],
        errors: [],
      });

      const processorWithCallback = new ConfigFieldProcessor(
        new TemplateParser(),
        new TemplateValidator(),
        mockTemplateProcessor,
      );

      const result = processorWithCallback.processStringField('{project.name}', 'test', mockContext, [], []);

      expect(mockTemplateProcessor).toHaveBeenCalledWith('{project.name}', mockContext);
      expect(result).toBe('processed-value');
    });
  });
});
