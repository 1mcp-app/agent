import type { MCPServerParams } from '@src/core/types/transport.js';
import { TemplateDetector } from '@src/template/templateDetector.js';

import { describe, expect, it } from 'vitest';

describe('TemplateDetector', () => {
  const validConfig: MCPServerParams = {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    env: {},
    tags: ['filesystem'],
  };

  const templateConfig: MCPServerParams = {
    command: 'npx',
    args: ['-y', 'serena', '{project.path}'],
    env: {
      PROJECT_ID: '{project.custom.projectId}',
      SESSION_ID: '{sessionId}',
    },
    cwd: '{project.path}',
    tags: ['filesystem', 'search'],
  };

  describe('detectTemplatesInString', () => {
    it('should detect templates in a simple string', () => {
      const result = TemplateDetector.detectTemplatesInString('Hello {project.name}');
      expect(result).toEqual(['{project.name}']);
    });

    it('should detect multiple templates in a string', () => {
      const result = TemplateDetector.detectTemplatesInString('{project.name}-{user.username}');
      expect(result).toEqual(['{project.name}', '{user.username}']);
    });

    it('should detect duplicate templates only once', () => {
      const result = TemplateDetector.detectTemplatesInString('{project.name} and {project.name}');
      expect(result).toEqual(['{project.name}']);
    });

    it('should return empty array for strings without templates', () => {
      const result = TemplateDetector.detectTemplatesInString('Hello world');
      expect(result).toEqual([]);
    });

    it('should handle empty strings', () => {
      const result = TemplateDetector.detectTemplatesInString('');
      expect(result).toEqual([]);
    });

    it('should handle null or undefined values', () => {
      expect(TemplateDetector.detectTemplatesInString(null as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInString(undefined as any)).toEqual([]);
    });

    it('should handle non-string values', () => {
      expect(TemplateDetector.detectTemplatesInString(123 as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInString({} as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInString([] as any)).toEqual([]);
    });

    it('should detect complex template patterns', () => {
      const result = TemplateDetector.detectTemplatesInString('{project.custom.apiEndpoint}/v1/{project.environment}');
      expect(result).toEqual(['{project.custom.apiEndpoint}', '{project.environment}']);
    });

    it('should detect templates with conditional operators', () => {
      const result = TemplateDetector.detectTemplatesInString('{?project.environment=production}');
      expect(result).toEqual(['{?project.environment=production}']);
    });

    it('should detect templates with functions', () => {
      const result = TemplateDetector.detectTemplatesInString('{project.name | upper}');
      expect(result).toEqual(['{project.name | upper}']);
    });

    it('should handle nested braces', () => {
      const result = TemplateDetector.detectTemplatesInString('{project.custom.{nested.key}}');
      expect(result).toEqual(['{project.custom.{nested.key}']);
    });
  });

  describe('detectTemplatesInArray', () => {
    it('should detect templates in array of strings', () => {
      const result = TemplateDetector.detectTemplatesInArray([
        'npx',
        '-y',
        'serena',
        '{project.path}',
        '--project',
        '{project.name}',
      ]);
      expect(result).toEqual(['{project.path}', '{project.name}']);
    });

    it('should return empty array for empty array', () => {
      const result = TemplateDetector.detectTemplatesInArray([]);
      expect(result).toEqual([]);
    });

    it('should handle arrays with non-string elements', () => {
      const result = TemplateDetector.detectTemplatesInArray([
        'npx',
        123,
        null,
        { not: 'string' },
        '{project.name}',
      ] as any);
      expect(result).toEqual(['{project.name}']);
    });

    it('should handle non-array values', () => {
      expect(TemplateDetector.detectTemplatesInArray(null as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInArray(undefined as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInArray('string' as any)).toEqual([]);
    });

    it('should remove duplicate templates across array elements', () => {
      const result = TemplateDetector.detectTemplatesInArray([
        '{project.name}',
        'other',
        '{project.name}',
        '{user.username}',
        '{project.name}',
      ]);
      expect(result).toEqual(['{project.name}', '{user.username}']);
    });
  });

  describe('detectTemplatesInObject', () => {
    it('should detect templates in object values', () => {
      const obj = {
        PROJECT_ID: '{project.custom.projectId}',
        SESSION_ID: '{sessionId}',
        STATIC_VALUE: 'no template here',
        EMPTY: '',
        NUMBER: 123,
      };

      const result = TemplateDetector.detectTemplatesInObject(obj);
      expect(result).toEqual(['{project.custom.projectId}', '{sessionId}']);
    });

    it('should return empty array for empty object', () => {
      const result = TemplateDetector.detectTemplatesInObject({});
      expect(result).toEqual([]);
    });

    it('should handle null or undefined objects', () => {
      expect(TemplateDetector.detectTemplatesInObject(null as any)).toEqual([]);
      expect(TemplateDetector.detectTemplatesInObject(undefined as any)).toEqual([]);
    });

    it('should only check string values', () => {
      const obj = {
        stringTemplate: '{project.name}',
        numberValue: 123,
        booleanValue: true,
        arrayValue: ['{project.path}'],
        objectValue: { nested: '{user.username}' },
        nullValue: null,
        undefinedValue: undefined,
      };

      const result = TemplateDetector.detectTemplatesInObject(obj);
      expect(result).toEqual(['{project.name}']);
    });
  });

  describe('detectTemplatesInConfig', () => {
    it('should detect templates in all relevant config fields', () => {
      const config: MCPServerParams = {
        command: 'npx -y {server.name}',
        args: ['{project.path}', '--user', '{user.username}'],
        cwd: '{project.custom.workingDir}',
        env: {
          PROJECT_ID: '{project.custom.projectId}',
          SESSION_ID: '{sessionId}',
          STATIC_VAR: 'static value',
        },
        tags: ['tag1', 'tag2'],
        disabled: false,
      };

      const result = TemplateDetector.detectTemplatesInConfig(config);
      expect(result).toEqual([
        '{server.name}',
        '{project.path}',
        '{user.username}',
        '{project.custom.workingDir}',
        '{project.custom.projectId}',
        '{sessionId}',
      ]);
    });

    it('should return empty array for config without templates', () => {
      const result = TemplateDetector.detectTemplatesInConfig(validConfig);
      expect(result).toEqual([]);
    });

    it('should handle config with missing optional fields', () => {
      const minimalConfig: MCPServerParams = {
        command: 'echo hello',
        args: [],
      };

      const result = TemplateDetector.detectTemplatesInConfig(minimalConfig);
      expect(result).toEqual([]);
    });

    it('should detect templates in disabled field if it contains template', () => {
      const config = {
        command: 'echo hello',
        args: [],
        disabled: '{?project.environment=production}',
      } as any;

      const result = TemplateDetector.detectTemplatesInConfig(config);
      expect(result).toEqual(['{?project.environment=production}']);
    });
  });

  describe('hasTemplates', () => {
    it('should return true for config with templates', () => {
      expect(TemplateDetector.hasTemplates(templateConfig)).toBe(true);
    });

    it('should return false for config without templates', () => {
      expect(TemplateDetector.hasTemplates(validConfig)).toBe(false);
    });

    it('should return false for empty config', () => {
      expect(TemplateDetector.hasTemplates({} as MCPServerParams)).toBe(false);
    });
  });

  describe('validateTemplateFree', () => {
    it('should validate config without templates', () => {
      const result = TemplateDetector.validateTemplateFree(validConfig);

      expect(result.valid).toBe(true);
      expect(result.templates).toEqual([]);
      expect(result.locations).toEqual([]);
    });

    it('should detect templates in config fields', () => {
      const config: MCPServerParams = {
        command: 'npx {project.name}',
        args: ['{project.path}'],
        env: {
          PROJECT_ID: '{project.custom.projectId}',
          STATIC: 'value',
        },
      };

      const result = TemplateDetector.validateTemplateFree(config);

      expect(result.valid).toBe(false);
      expect(result.templates).toEqual(['{project.name}', '{project.path}', '{project.custom.projectId}']);
      expect(result.locations).toEqual([
        'command: "npx {project.name}"',
        'args: [{project.path}]',
        'env: {"PROJECT_ID":"{project.custom.projectId}","STATIC":"value"}',
      ]);
    });

    it('should provide detailed location information', () => {
      const config: MCPServerParams = {
        command: '{project.name}',
        args: ['{project.path}', '{user.username}'],
        env: {
          PROJECT: '{project.custom.projectId}',
          USER: '{user.uid}',
        },
      };

      const result = TemplateDetector.validateTemplateFree(config);

      expect(result.locations).toEqual([
        'command: "{project.name}"',
        'args: [{project.path}, {user.username}]',
        'env: {"PROJECT":"{project.custom.projectId}","USER":"{user.uid}"}',
      ]);
    });

    it('should handle templates in env variables', () => {
      const config: MCPServerParams = {
        command: 'echo hello',
        env: {
          COMPLEX: '{project.custom.value}',
          OTHER: 'static',
        } as Record<string, string>,
      };

      const result = TemplateDetector.validateTemplateFree(config);

      expect(result.valid).toBe(false);
      expect(result.templates).toEqual(['{project.custom.value}']);
      expect(result.locations[0]).toContain('COMPLEX');
    });
  });

  describe('extractVariableNames', () => {
    it('should extract variable names from template strings', () => {
      const templates = ['{project.name}', '{user.username}', '{project.custom.projectId}', '{sessionId}'];

      const result = TemplateDetector.extractVariableNames(templates);
      expect(result).toEqual(['project.name', 'user.username', 'project.custom.projectId', 'sessionId']);
    });

    it('should handle templates with spaces', () => {
      const templates = ['{ project.name }', '{user.username }', '{ project.custom.projectId }'];

      const result = TemplateDetector.extractVariableNames(templates);
      expect(result).toEqual(['project.name', 'user.username', 'project.custom.projectId']);
    });

    it('should remove duplicate variable names', () => {
      const templates = [
        '{project.name}',
        '{user.username}',
        '{project.name}', // duplicate
        '{sessionId}',
        '{project.name}', // duplicate
      ];

      const result = TemplateDetector.extractVariableNames(templates);
      expect(result).toEqual(['project.name', 'user.username', 'sessionId']);
    });

    it('should handle empty and invalid templates', () => {
      const templates = ['{project.name}', '{}', '{ }', '{project.name}', '', '{user.username}'];

      const result = TemplateDetector.extractVariableNames(templates);
      expect(result).toEqual([
        'project.name',
        '', // empty template
        '', // whitespace template
        'user.username',
      ]);
    });

    it('should handle complex template patterns', () => {
      const templates = [
        '{project.name | upper}',
        '{?project.environment=production}',
        '{project.custom.{nested.key}}',
        '{project.name}',
      ];

      const result = TemplateDetector.extractVariableNames(templates);
      expect(result).toEqual([
        'project.name | upper',
        '?project.environment=production',
        'project.custom.{nested.key}',
        'project.name',
      ]);
    });
  });

  describe('validateTemplateSyntax', () => {
    it('should validate correct template syntax', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['-y', 'serena', '{project.path}'],
        env: {
          PROJECT_ID: '{project.custom.projectId}',
        },
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.templates.length).toBe(2);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should detect unbalanced braces', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['-y', 'serena', '{project.path'],
        env: {},
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Unbalanced braces in template: {project.path');
    });

    it('should detect empty templates', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['-y', 'serena', '{}'],
        env: {},
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Empty template found: {}');
    });

    it('should detect whitespace-only templates', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['-y', 'serena', '{ }'],
        env: {},
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Empty template found: { }');
    });

    it('should detect nested templates', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['-y', 'serena', '{{project.nested}}'],
        env: {},
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Nested templates detected: {{project.nested}}');
    });

    it('should return validation result for config without templates', () => {
      const result = TemplateDetector.validateTemplateSyntax(validConfig);

      expect(result.hasTemplates).toBe(false);
      expect(result.templates).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.locations).toEqual([]);
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should include all relevant information in validation result', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['{project.path}', '{project.name}'],
        env: {
          PROJECT_ID: '{project.custom.projectId}',
          SESSION: '{sessionId}',
        },
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.hasTemplates).toBe(true);
      expect(result.templates).toHaveLength(4);
      expect(result.variables).toHaveLength(4);
      expect(result.locations).toHaveLength(2); // args and env
      expect(result.isValid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should handle multiple validation errors', () => {
      const config: MCPServerParams = {
        command: 'npx',
        args: ['{project.path}', '{}', '{{nested}}'],
        env: {
          PROJECT: '{project.custom.projectId',
        },
      };

      const result = TemplateDetector.validateTemplateSyntax(config);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(2);
      expect(result.errors.some((e) => e.includes('Empty template'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Unbalanced braces'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Nested templates'))).toBe(true);
    });
  });
});
