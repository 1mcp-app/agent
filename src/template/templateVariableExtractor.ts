import type { MCPServerParams } from '@src/core/types/transport.js';
import { debugIf } from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';
import { createHash as createStringHash } from '@src/utils/crypto.js';

/**
 * Represents a template variable with its namespace and path
 */
export interface TemplateVariable {
  /** Full variable path (e.g., 'project.name' or 'user.username') */
  path: string;
  /** Namespace of the variable (project, user, environment, etc.) */
  namespace: string;
  /** Path within the namespace */
  key: string;
  /** Whether this variable is optional (has a default value) */
  optional: boolean;
  /** Default value if specified */
  defaultValue?: unknown;
}

/**
 * Configuration for template variable extraction
 */
export interface ExtractionOptions {
  /** Whether to include optional variables in the result */
  includeOptional?: boolean;
  /** Whether to include environment variables */
  includeEnvironment?: boolean;
}

/**
 * Extracts and manages template variables from MCP server configurations
 *
 * This class:
 * - Parses template configurations to identify all variables used
 * - Extracts relevant variables from client context
 * - Creates efficient hashes for variable comparison
 * - Caches extraction results for performance
 */
export class TemplateVariableExtractor {
  private extractionCache = new Map<string, TemplateVariable[]>();
  private cacheEnabled = true;

  /**
   * Extracts all template variables from a server configuration
   */
  extractTemplateVariables(config: MCPServerParams, options: ExtractionOptions = {}): TemplateVariable[] {
    const cacheKey = this.createCacheKey(config, options);

    if (this.cacheEnabled && this.extractionCache.has(cacheKey)) {
      return this.extractionCache.get(cacheKey)!;
    }

    const variablesMap = new Map<string, TemplateVariable>();
    // Extract from command and args
    this.extractFromValue(config.command, variablesMap);
    if (config.args) {
      config.args.forEach((arg) => this.extractFromValue(arg, variablesMap));
    }

    // Extract from environment variables
    if (config.env && options.includeEnvironment !== false) {
      Object.values(config.env).forEach((value) => {
        this.extractFromValue(value, variablesMap);
      });
    }

    // Extract from cwd and url (string fields)
    ['cwd', 'url'].forEach((field) => {
      const value = (config as Record<string, unknown>)[field];
      if (value) {
        this.extractFromValue(value, variablesMap);
      }
    });

    // Extract from headers (object field)
    if (config.headers) {
      Object.values(config.headers).forEach((value) => {
        this.extractFromValue(value, variablesMap);
      });
    }

    const result = Array.from(variablesMap.values());

    if (this.cacheEnabled) {
      this.extractionCache.set(cacheKey, result);
    }

    debugIf(() => ({
      message: 'Extracted template variables from configuration',
      meta: {
        variableCount: result.length,
        variables: result.map((v) => v.path),
        cacheKey,
      },
    }));

    return result;
  }

  /**
   * Extracts only the variables used by a specific template from the full context
   */
  getUsedVariables(
    templateConfig: MCPServerParams,
    fullContext: ContextData,
    options?: ExtractionOptions,
  ): Record<string, unknown> {
    const variables = this.extractTemplateVariables(templateConfig, options);
    const result: Record<string, unknown> = {};
    const { includeOptional = true, includeEnvironment = true } = options || {};

    for (const variable of variables) {
      // Skip optional variables if not included
      if (!includeOptional && variable.optional) {
        continue;
      }

      // Skip environment variables if not included
      if (!includeEnvironment && variable.namespace === 'environment') {
        continue;
      }

      try {
        const value = this.getVariableValue(variable, fullContext);
        if (value !== undefined) {
          result[variable.path] = value;
        } else if (variable.optional && variable.defaultValue !== undefined) {
          result[variable.path] = variable.defaultValue;
        } else {
          // Always include variables in the result, even if value is undefined
          // This ensures they get processed by the template substitution logic
          result[variable.path] = value;
        }
      } catch (error) {
        debugIf(() => ({
          message: 'Failed to extract variable value',
          meta: {
            variable: variable.path,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
        // Skip variables that can't be extracted
        if (variable.optional && variable.defaultValue !== undefined) {
          result[variable.path] = variable.defaultValue;
        }
      }
    }

    return result;
  }

  /**
   * Creates a hash of variable values for efficient comparison
   */
  createVariableHash(variables: Record<string, unknown>): string {
    // Sort keys to ensure consistent ordering
    const sortedKeys = Object.keys(variables).sort();
    const hashObject: Record<string, unknown> = {};

    for (const key of sortedKeys) {
      hashObject[key] = variables[key];
    }

    return createStringHash(JSON.stringify(hashObject));
  }

  /**
   * Creates a unique key for a template configuration (for caching)
   */
  createTemplateKey(templateConfig: MCPServerParams): string {
    // Use relevant fields that would affect variable extraction
    const keyParts = [
      templateConfig.command || '',
      (templateConfig.args || []).join(' '),
      JSON.stringify(templateConfig.env || {}),
      templateConfig.cwd || '',
    ];

    return createStringHash(keyParts.join('|'));
  }

  /**
   * Clears the extraction cache
   */
  clearCache(): void {
    this.extractionCache.clear();
  }

  /**
   * Enables or disables caching
   */
  setCacheEnabled(enabled: boolean): void {
    this.cacheEnabled = enabled;
    if (!enabled) {
      this.clearCache();
    }
  }

  /**
   * Gets cache statistics for monitoring
   */
  getCacheStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.extractionCache.size,
      hits: 0, // TODO: Implement hit/miss tracking if needed
      misses: 0,
    };
  }

  /**
   * Extracts template variables from a string or object value
   */
  private extractFromValue(value: unknown, variablesMap: Map<string, TemplateVariable>): void {
    if (typeof value !== 'string') {
      return;
    }

    // Regular expression to match template variables
    // Matches: {namespace.path} or {namespace.path:default}
    const regex = /\{([^}]+)\}/g;
    let match;

    while ((match = regex.exec(value)) !== null) {
      const template = match[1];
      const variable = this.parseVariableTemplate(template);

      if (variable) {
        variablesMap.set(variable.path, variable);
      }
    }
  }

  /**
   * Parses a variable template string into a TemplateVariable object
   */
  private parseVariableTemplate(template: string): TemplateVariable | null {
    // First, check if this looks like a namespaced variable (contains a dot)
    const dotIndex = template.indexOf('.');

    if (dotIndex > 0) {
      // This is a namespaced variable, check for default value
      const colonIndex = template.indexOf(':');
      let path: string;
      let defaultValue: unknown;

      if (colonIndex > dotIndex) {
        // Colon comes after dot, so it's a default value
        path = template.substring(0, colonIndex).trim();
        const defaultStr = template.substring(colonIndex + 1).trim();

        // Try to parse default value as JSON, fall back to string
        try {
          defaultValue = JSON.parse(defaultStr);
        } catch {
          defaultValue = defaultStr;
        }
      } else {
        // No default value or colon before dot (invalid format)
        path = template;
      }

      const [namespace, ...keyParts] = path.split('.');
      const key = keyParts.join('.');

      if (!namespace || !key) {
        debugIf(() => ({
          message: 'Invalid template variable format',
          meta: { path, namespace, key, template },
        }));
        return null;
      }

      return {
        path,
        namespace,
        key,
        optional: defaultValue !== undefined,
        defaultValue,
      };
    } else {
      // Simple variable without namespace (e.g., {nonexistent:value})
      // Check for default value - simple variables without default are invalid
      const colonIndex = template.indexOf(':');
      let defaultValue: unknown;

      if (colonIndex > 0) {
        // Has default value
        const defaultStr = template.substring(colonIndex + 1).trim();
        try {
          defaultValue = JSON.parse(defaultStr);
        } catch {
          defaultValue = defaultStr;
        }

        return {
          path: template, // Keep the full template as the path
          namespace: template,
          key: '',
          optional: defaultValue !== undefined,
          defaultValue,
        };
      } else {
        // Simple variable without default value is invalid
        debugIf(() => ({
          message: 'Invalid template variable - simple variables must have default values',
          meta: { template },
        }));
        return null;
      }
    }
  }

  /**
   * Gets the value of a variable from the context
   */
  private getVariableValue(variable: TemplateVariable, context: ContextData): unknown {
    const { namespace, key } = variable;

    // Handle simple variables without namespace (e.g., nonexistent:value)
    if (namespace === variable.path && key === '') {
      // This is a simple variable without context binding
      return undefined; // Always return undefined so default value is used
    }

    let target: unknown;

    switch (namespace) {
      case 'context':
        target = context;
        break;
      case 'project':
        target = context.project;
        break;
      case 'user':
        target = context.user;
        break;
      case 'environment':
        target = context.environment;
        break;
      case 'session':
        target = { sessionId: context.sessionId };
        break;
      case 'timestamp':
        target = { timestamp: context.timestamp };
        break;
      case 'version':
        target = { version: context.version };
        break;
      default:
        // Try to get from project.custom for unknown namespaces
        if (context.project && context.project.custom) {
          target = (context.project.custom as Record<string, unknown>)[namespace];
        }
        break;
    }

    if (target === undefined || target === null) {
      return undefined;
    }

    // Navigate nested object path
    const keys = key.split('.');
    let current: unknown = target;

    for (const [i, k] of keys.entries()) {
      if (current && typeof current === 'object' && k in current) {
        const next = (current as Record<string, unknown>)[k];
        // If this is the last key, return the value
        if (i === keys.length - 1) {
          return next;
        }
        // Otherwise, continue navigating
        current = next;
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Creates a cache key for extraction results
   */
  private createCacheKey(config: MCPServerParams, options: ExtractionOptions): string {
    const configKey = this.createTemplateKey(config);
    const optionsKey = JSON.stringify(options);
    return `${configKey}:${optionsKey}`;
  }
}
