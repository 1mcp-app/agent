import { basename, dirname, extname, join, normalize } from 'path';

import logger, { debugIf } from '@src/logger/logger.js';

/**
 * Template function registry
 */
export interface TemplateFunction {
  name: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  execute: (...args: string[]) => string;
}

/**
 * Built-in template functions
 */
export class TemplateFunctions {
  private static functions: Map<string, TemplateFunction> = new Map();

  static {
    // String manipulation functions
    this.register('upper', {
      name: 'upper',
      description: 'Convert string to uppercase',
      minArgs: 1,
      maxArgs: 1,
      execute: (str: string) => String(str).toUpperCase(),
    });

    this.register('lower', {
      name: 'lower',
      description: 'Convert string to lowercase',
      minArgs: 1,
      maxArgs: 1,
      execute: (str: string) => String(str).toLowerCase(),
    });

    this.register('capitalize', {
      name: 'capitalize',
      description: 'Capitalize first letter of each word',
      minArgs: 1,
      maxArgs: 1,
      execute: (str: string) => String(str).replace(/\b\w/g, (char) => char.toUpperCase()),
    });

    this.register('truncate', {
      name: 'truncate',
      description: 'Truncate string to specified length',
      minArgs: 2,
      maxArgs: 2,
      execute: (str: string, length: string) => {
        const len = parseInt(length, 10);
        if (str.length <= len) return str;
        return str.substring(0, len) + '...';
      },
    });

    this.register('replace', {
      name: 'replace',
      description: 'Replace occurrences of substring',
      minArgs: 3,
      maxArgs: 3,
      execute: (str: string, search: string, replace: string) => str.split(search).join(replace),
    });

    // Path manipulation functions
    this.register('basename', {
      name: 'basename',
      description: 'Get basename of path',
      minArgs: 1,
      maxArgs: 2,
      execute: (path: string, ext?: string) => (ext ? basename(path, ext) : basename(path)),
    });

    this.register('dirname', {
      name: 'dirname',
      description: 'Get directory name of path',
      minArgs: 1,
      maxArgs: 1,
      execute: (path: string) => dirname(path),
    });

    this.register('extname', {
      name: 'extname',
      description: 'Get file extension',
      minArgs: 1,
      maxArgs: 1,
      execute: (path: string) => extname(path),
    });

    this.register('join', {
      name: 'join',
      description: 'Join path segments',
      minArgs: 2,
      maxArgs: 10,
      execute: (...segments: string[]) => normalize(join(...segments)),
    });

    // Date formatting functions
    this.register('date', {
      name: 'date',
      description: 'Format current date',
      minArgs: 0,
      maxArgs: 1,
      execute: (format?: string) => {
        const now = new Date();
        if (!format) return now.toISOString();

        // Simple date formatting (support basic placeholders)
        return format
          .replace(/YYYY/g, String(now.getFullYear()))
          .replace(/MM/g, String(now.getMonth() + 1).padStart(2, '0'))
          .replace(/DD/g, String(now.getDate()).padStart(2, '0'))
          .replace(/HH/g, String(now.getHours()).padStart(2, '0'))
          .replace(/mm/g, String(now.getMinutes()).padStart(2, '0'))
          .replace(/ss/g, String(now.getSeconds()).padStart(2, '0'));
      },
    });

    this.register('timestamp', {
      name: 'timestamp',
      description: 'Get Unix timestamp',
      minArgs: 0,
      maxArgs: 0,
      execute: () => String(Date.now()),
    });

    // Utility functions
    this.register('default', {
      name: 'default',
      description: 'Return default value if input is empty',
      minArgs: 2,
      maxArgs: 2,
      execute: (value: string, defaultValue: string) => (value && value.trim() ? value : defaultValue),
    });

    this.register('env', {
      name: 'env',
      description: 'Get environment variable',
      minArgs: 1,
      maxArgs: 2,
      execute: (name: string, defaultValue?: string) => process.env[name] || defaultValue || '',
    });

    this.register('hash', {
      name: 'hash',
      description: 'Create simple hash from string',
      minArgs: 1,
      maxArgs: 1,
      execute: (str: string) => {
        // Simple hash function (not cryptographic)
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          const char = str.charCodeAt(i);
          hash = (hash << 5) - hash + char;
          hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
      },
    });
  }

  /**
   * Register a new template function
   */
  static register(name: string, func: TemplateFunction): void {
    this.functions.set(name, func);
    debugIf(() => ({
      message: 'Template function registered',
      meta: { name, description: func.description },
    }));
  }

  /**
   * Get all registered functions
   */
  static getAll(): Map<string, TemplateFunction> {
    return new Map(this.functions);
  }

  /**
   * Check if function exists
   */
  static has(name: string): boolean {
    return this.functions.has(name);
  }

  /**
   * Get function by name
   */
  static get(name: string): TemplateFunction | undefined {
    return this.functions.get(name);
  }

  /**
   * Execute a function with arguments
   */
  static execute(name: string, args: string[]): string {
    const func = this.functions.get(name);
    if (!func) {
      throw new Error(`Unknown template function: ${name}`);
    }

    if (args.length < func.minArgs) {
      throw new Error(`Function '${name}' requires at least ${func.minArgs} arguments, got ${args.length}`);
    }

    if (args.length > func.maxArgs) {
      throw new Error(`Function '${name}' accepts at most ${func.maxArgs} arguments, got ${args.length}`);
    }

    try {
      const result = func.execute(...args);
      debugIf(() => ({
        message: 'Template function executed',
        meta: { name, args, result },
      }));
      return result;
    } catch (error) {
      const errorMsg = `Error executing function '${name}': ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * List all available functions with descriptions
   */
  static list(): Array<{ name: string; description: string; usage: string }> {
    const list: Array<{ name: string; description: string; usage: string }> = [];

    for (const func of this.functions.values()) {
      const argRange = func.minArgs === func.maxArgs ? func.minArgs : `${func.minArgs}-${func.maxArgs}`;

      list.push({
        name: func.name,
        description: func.description,
        usage: `${func.name}(${argRange === 0 ? '' : '...args'})`,
      });
    }

    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Clear all functions (for testing)
   */
  static clear(): void {
    this.functions.clear();
  }
}
