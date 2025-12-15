import { beforeEach, describe, expect, it } from 'vitest';

import { TemplateFunctions } from './templateFunctions.js';

describe('TemplateFunctions', () => {
  beforeEach(() => {
    // Don't clear all functions, just ensure built-ins are available
    // The clear() method is for testing only
  });

  describe('built-in functions', () => {
    describe('string manipulation', () => {
      it('should convert to uppercase', () => {
        const result = TemplateFunctions.execute('upper', ['hello world']);
        expect(result).toBe('HELLO WORLD');
      });

      it('should convert to lowercase', () => {
        const result = TemplateFunctions.execute('lower', ['HELLO WORLD']);
        expect(result).toBe('hello world');
      });

      it('should capitalize words', () => {
        const result = TemplateFunctions.execute('capitalize', ['hello world']);
        expect(result).toBe('Hello World');
      });

      it('should truncate string', () => {
        const result = TemplateFunctions.execute('truncate', ['hello world', '5']);
        expect(result).toBe('hello...');
      });

      it('should replace occurrences', () => {
        const result = TemplateFunctions.execute('replace', ['hello world', 'world', 'there']);
        expect(result).toBe('hello there');
      });
    });

    describe('path manipulation', () => {
      it('should get basename', () => {
        const result = TemplateFunctions.execute('basename', ['/path/to/file.txt']);
        expect(result).toBe('file.txt');
      });

      it('should get basename with extension', () => {
        const result = TemplateFunctions.execute('basename', ['/path/to/file.txt', '.txt']);
        expect(result).toBe('file');
      });

      it('should get dirname', () => {
        const result = TemplateFunctions.execute('dirname', ['/path/to/file.txt']);
        expect(result).toBe('/path/to');
      });

      it('should get extension', () => {
        const result = TemplateFunctions.execute('extname', ['/path/to/file.txt']);
        expect(result).toBe('.txt');
      });

      it('should join paths', () => {
        const result = TemplateFunctions.execute('join', ['path', 'to', 'file.txt']);
        expect(result).toContain('file.txt');
      });
    });

    describe('date functions', () => {
      it('should format current date', () => {
        const result = TemplateFunctions.execute('date', []);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      });

      it('should format date with custom format', () => {
        const result = TemplateFunctions.execute('date', ['YYYY-MM-DD']);
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should get timestamp', () => {
        const result = TemplateFunctions.execute('timestamp', []);
        expect(result).toMatch(/^\d+$/);
      });
    });

    describe('utility functions', () => {
      it('should return default value for empty input', () => {
        const result = TemplateFunctions.execute('default', ['', 'default']);
        expect(result).toBe('default');
      });

      it('should return original value for non-empty input', () => {
        const result = TemplateFunctions.execute('default', ['hello', 'default']);
        expect(result).toBe('hello');
      });

      it('should get environment variable', () => {
        process.env.TEST_VAR = 'test-value';
        const result = TemplateFunctions.execute('env', ['TEST_VAR']);
        expect(result).toBe('test-value');
        delete process.env.TEST_VAR;
      });

      it('should return default for missing environment variable', () => {
        const result = TemplateFunctions.execute('env', ['MISSING_VAR', 'default']);
        expect(result).toBe('default');
      });

      it('should create hash from string', () => {
        const result = TemplateFunctions.execute('hash', ['test']);
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
      });
    });
  });

  describe('function management', () => {
    it('should list all functions', () => {
      const functions = TemplateFunctions.list();
      expect(functions.length).toBeGreaterThan(0);

      const upperFunc = functions.find((f) => f.name === 'upper');
      expect(upperFunc).toBeDefined();
      expect(upperFunc?.description).toBe('Convert string to uppercase');
    });

    it('should check if function exists', () => {
      expect(TemplateFunctions.has('upper')).toBe(true);
      expect(TemplateFunctions.has('nonexistent')).toBe(false);
    });

    it('should get function by name', () => {
      const func = TemplateFunctions.get('upper');
      expect(func).toBeDefined();
      expect(func?.name).toBe('upper');
    });

    it('should register custom function', () => {
      const customFunc = {
        name: 'custom',
        description: 'Custom test function',
        minArgs: 1,
        maxArgs: 1,
        execute: (input: string) => `custom: ${input}`,
      };

      TemplateFunctions.register('custom', customFunc);

      expect(TemplateFunctions.has('custom')).toBe(true);
      const result = TemplateFunctions.execute('custom', ['test']);
      expect(result).toBe('custom: test');
    });
  });

  describe('argument validation', () => {
    it('should throw error for too few arguments', () => {
      expect(() => {
        TemplateFunctions.execute('upper', []);
      }).toThrow('requires at least 1 arguments, got 0');
    });

    it('should throw error for too many arguments', () => {
      expect(() => {
        TemplateFunctions.execute('upper', ['arg1', 'arg2']);
      }).toThrow('accepts at most 1 arguments, got 2');
    });

    it('should throw error for unknown function', () => {
      expect(() => {
        TemplateFunctions.execute('nonexistent', ['arg']);
      }).toThrow('Unknown template function: nonexistent');
    });
  });

  describe('edge cases', () => {
    it('should handle null arguments', () => {
      const result = TemplateFunctions.execute('default', [null as any, 'default']);
      expect(result).toBe('default');
    });

    it('should handle undefined arguments', () => {
      const result = TemplateFunctions.execute('default', [undefined as any, 'default']);
      expect(result).toBe('default');
    });

    it('should handle numeric input', () => {
      const result = TemplateFunctions.execute('upper', [123 as any]);
      expect(result).toBe('123');
    });

    it('should handle boolean input', () => {
      const result = TemplateFunctions.execute('upper', [true as any]);
      expect(result).toBe('TRUE');
    });
  });
});
