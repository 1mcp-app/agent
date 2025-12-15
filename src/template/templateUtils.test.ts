import { describe, expect, it } from 'vitest';

import { TemplateUtils } from './templateUtils.js';

describe('TemplateUtils', () => {
  describe('parseVariableSpec', () => {
    it('should parse simple variable', () => {
      const variable = TemplateUtils.parseVariableSpec('project.name');
      expect(variable).toEqual({
        name: 'project.name',
        namespace: 'project',
        path: ['name'],
        optional: false,
      });
    });

    it('should parse nested variable', () => {
      const variable = TemplateUtils.parseVariableSpec('user.info.name');
      expect(variable).toEqual({
        name: 'user.info.name',
        namespace: 'user',
        path: ['info', 'name'],
        optional: false,
      });
    });

    it('should parse optional variable with ?', () => {
      const variable = TemplateUtils.parseVariableSpec('project.path?');
      expect(variable).toEqual({
        name: 'project.path?',
        namespace: 'project',
        path: ['path'],
        optional: true,
      });
    });

    it('should parse optional variable with default value', () => {
      const variable = TemplateUtils.parseVariableSpec('project.path?:/default');
      expect(variable).toEqual({
        name: 'project.path?:/default',
        namespace: 'project',
        path: ['path'],
        optional: true,
        defaultValue: '/default',
      });
    });

    it('should parse function calls', () => {
      const variable = TemplateUtils.parseVariableSpec('func()');
      expect(variable).toEqual({
        name: 'func()',
        namespace: 'context',
        path: ['func'],
        optional: false,
        functions: [{ name: 'func', args: [] }],
      });
    });

    it('should parse function with arguments', () => {
      const variable = TemplateUtils.parseVariableSpec('formatDate("2024-01-01", "YYYY")');
      expect(variable).toEqual({
        name: 'formatDate("2024-01-01", "YYYY")',
        namespace: 'context',
        path: ['formatDate'],
        optional: false,
        functions: [{ name: 'formatDate', args: ['"2024-01-01"', '"YYYY"'] }],
      });
    });

    it('should parse function chain', () => {
      const variable = TemplateUtils.parseVariableSpec('project.path | uppercase | truncate(10)');
      expect(variable.name).toBe('project.path | uppercase | truncate(10)');
      expect(variable.namespace).toBe('project');
      expect(variable.path).toEqual(['path']);
      expect(variable.functions).toHaveLength(2);
    });

    it('should handle complex arguments with quotes and commas', () => {
      const variable = TemplateUtils.parseVariableSpec('func("arg1, with comma", "arg2")');
      expect(variable.functions).toEqual([
        {
          name: 'func',
          args: ['"arg1, with comma"', '"arg2"'],
        },
      ]);
    });

    it('should throw error for empty variable', () => {
      expect(() => TemplateUtils.parseVariableSpec('')).toThrow('Empty variable specification');
    });

    it('should throw error for variable without namespace', () => {
      expect(() => TemplateUtils.parseVariableSpec('nameonly')).toThrow(
        'Variable must include namespace (e.g., project.path, user.name)',
      );
    });

    it('should throw error for invalid namespace', () => {
      expect(() => TemplateUtils.parseVariableSpec('invalid.path')).toThrow(
        "Invalid namespace 'invalid'. Valid namespaces: project, user, environment, context",
      );
    });
  });

  describe('parseFunctionChain', () => {
    it('should parse single function', () => {
      const functions = TemplateUtils.parseFunctionChain('uppercase');
      expect(functions).toEqual([{ name: 'uppercase', args: [] }]);
    });

    it('should parse function with arguments', () => {
      const functions = TemplateUtils.parseFunctionChain('truncate(10)');
      expect(functions).toEqual([{ name: 'truncate', args: ['10'] }]);
    });

    it('should parse multiple functions', () => {
      const functions = TemplateUtils.parseFunctionChain('uppercase | truncate(10) | lowercase');
      expect(functions).toEqual([
        { name: 'uppercase', args: [] },
        { name: 'truncate', args: ['10'] },
        { name: 'lowercase', args: [] },
      ]);
    });

    it('should handle complex function arguments', () => {
      const functions = TemplateUtils.parseFunctionChain('format("Hello, {name}!", "test")');
      expect(functions).toEqual([
        {
          name: 'format',
          args: ['"Hello, {name}!"', '"test"'],
        },
      ]);
    });
  });

  describe('parseFunctionArguments', () => {
    it('should parse empty arguments', () => {
      const args = TemplateUtils.parseFunctionArguments('');
      expect(args).toEqual([]);
    });

    it('should parse single argument', () => {
      const args = TemplateUtils.parseFunctionArguments('hello');
      expect(args).toEqual(['hello']);
    });

    it('should parse multiple comma-separated arguments', () => {
      const args = TemplateUtils.parseFunctionArguments('arg1, arg2, arg3');
      expect(args).toEqual(['arg1', 'arg2', 'arg3']);
    });

    it('should handle quoted strings', () => {
      const args = TemplateUtils.parseFunctionArguments('"hello, world", test');
      expect(args).toEqual(['"hello, world"', 'test']);
    });

    it('should handle nested parentheses', () => {
      const args = TemplateUtils.parseFunctionArguments('func(arg1, func2(arg2, arg3)), arg4');
      expect(args).toEqual(['func(arg1, func2(arg2, arg3))', 'arg4']);
    });

    it('should handle mixed quotes', () => {
      const args = TemplateUtils.parseFunctionArguments('"single", \'double\', "mix\'ed"');
      expect(args).toEqual(['"single"', "'double'", '"mix\'ed"']);
    });
  });

  describe('extractVariables', () => {
    it('should extract variables from template', () => {
      const variables = TemplateUtils.extractVariables('Hello {user.name}, welcome to {project.name}!');
      expect(variables).toHaveLength(2);
      expect(variables[0].name).toBe('user.name');
      expect(variables[1].name).toBe('project.name');
    });

    it('should handle repeated variables', () => {
      const variables = TemplateUtils.extractVariables('{project.path} and {project.path}');
      expect(variables).toHaveLength(2);
      expect(variables[0].name).toBe('project.path');
      expect(variables[1].name).toBe('project.path');
    });

    it('should ignore invalid variables silently', () => {
      const variables = TemplateUtils.extractVariables('Hello {user.name}, invalid {}');
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('user.name');
    });
  });

  describe('hasVariables', () => {
    it('should detect variables in template', () => {
      expect(TemplateUtils.hasVariables('Hello {user.name}')).toBe(true);
    });

    it('should return false for static text', () => {
      expect(TemplateUtils.hasVariables('Hello world')).toBe(false);
    });

    it('should not detect partial braces as variables', () => {
      expect(TemplateUtils.hasVariables('Hello {world')).toBe(false);
      expect(TemplateUtils.hasVariables('Hello world}')).toBe(false);
    });

    it('should not detect empty braces as variable', () => {
      // The regex requires at least one character between braces
      expect(TemplateUtils.hasVariables('Hello {}')).toBe(false);
    });
  });

  describe('getNestedValue', () => {
    it('should get nested value', () => {
      const obj = {
        user: {
          name: 'John',
          info: {
            email: 'john@example.com',
          },
        },
      };

      expect(TemplateUtils.getNestedValue(obj, ['user', 'name'])).toBe('John');
      expect(TemplateUtils.getNestedValue(obj, ['user', 'info', 'email'])).toBe('john@example.com');
    });

    it('should return undefined for missing path', () => {
      const obj = { user: { name: 'John' } };
      expect(TemplateUtils.getNestedValue(obj, ['user', 'email'])).toBeUndefined();
    });

    it('should handle null/undefined objects', () => {
      expect(TemplateUtils.getNestedValue(null, ['path'])).toBeUndefined();
      expect(TemplateUtils.getNestedValue(undefined, ['path'])).toBeUndefined();
    });
  });

  describe('validateBasicSyntax', () => {
    it('should validate correct template', () => {
      const errors = TemplateUtils.validateBasicSyntax('Hello {user.name}!');
      expect(errors).toHaveLength(0);
    });

    it('should detect empty variables', () => {
      const errors = TemplateUtils.validateBasicSyntax('Hello {} world');
      expect(errors).toContain('Template contains empty variable {}');
    });

    it('should detect unbalanced braces', () => {
      const errors = TemplateUtils.validateBasicSyntax('Hello {user.name');
      expect(errors.some((e) => e.includes('Unmatched opening braces'))).toBe(true);

      const errors2 = TemplateUtils.validateBasicSyntax('Hello user.name}');
      expect(errors2.some((e) => e.includes('Unmatched closing brace'))).toBe(true);
    });

    it('should detect dangerous expressions', () => {
      const errors = TemplateUtils.validateBasicSyntax('Hello ${user.name}');
      expect(errors).toContain('Template contains potentially dangerous expressions');

      const errors2 = TemplateUtils.validateBasicSyntax('eval("evil")');
      expect(errors2).toContain('Template contains potentially dangerous expressions');
    });
  });

  describe('stringifyValue', () => {
    it('should convert values to string', () => {
      expect(TemplateUtils.stringifyValue('hello')).toBe('hello');
      expect(TemplateUtils.stringifyValue(42)).toBe('42');
      expect(TemplateUtils.stringifyValue(true)).toBe('true');
      expect(TemplateUtils.stringifyValue(false)).toBe('false');
    });

    it('should handle null and undefined', () => {
      expect(TemplateUtils.stringifyValue(null)).toBe('');
      expect(TemplateUtils.stringifyValue(undefined)).toBe('');
    });

    it('should JSON stringify objects', () => {
      const obj = { key: 'value' };
      expect(TemplateUtils.stringifyValue(obj)).toBe('{"key":"value"}');
    });

    it('should JSON stringify arrays', () => {
      const arr = [1, 2, 3];
      expect(TemplateUtils.stringifyValue(arr)).toBe('[1,2,3]');
    });
  });
});
