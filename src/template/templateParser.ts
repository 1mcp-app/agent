import logger, { debugIf } from '@src/logger/logger.js';
import type { ContextData, TemplateContext, TemplateVariable } from '@src/types/context.js';

import { TemplateUtils } from './templateUtils.js';

/**
 * Template parsing result
 */
export interface TemplateParseResult {
  original: string;
  processed: string;
  variables: TemplateVariable[];
  errors: string[];
}

/**
 * Template parser options
 */
export interface TemplateParserOptions {
  strictMode?: boolean;
  allowUndefined?: boolean;
  defaultValue?: string;
  maxDepth?: number;
}

/**
 * Template Parser Implementation
 *
 * Parses templates with variable substitution syntax like {project.path}, {user.name}, etc.
 * Supports nested object access and error handling.
 */
export class TemplateParser {
  private options: Required<TemplateParserOptions>;

  constructor(options: TemplateParserOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? true,
      allowUndefined: options.allowUndefined ?? false,
      defaultValue: options.defaultValue ?? '',
      maxDepth: options.maxDepth ?? 10,
    };
  }

  /**
   * Parse a template string with context data
   */
  parse(template: string, context: ContextData): TemplateParseResult {
    const errors: string[] = [];

    try {
      // Use shared utilities for syntax validation
      errors.push(...TemplateUtils.validateBasicSyntax(template));

      // Validate variable specifications
      const variableRegex = /\{([^}]+)\}/g;
      const matches = [...template.matchAll(variableRegex)];

      for (const match of matches) {
        try {
          TemplateUtils.parseVariableSpec(match[1]);
        } catch (error) {
          errors.push(`Invalid variable '${match[1]}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // If syntax errors found and in strict mode, return early
      if (errors.length > 0 && this.options.strictMode) {
        return {
          original: template,
          processed: '',
          variables: [],
          errors,
        };
      }

      // Create template context
      const templateContext: TemplateContext = {
        project: context.project,
        user: context.user,
        environment: context.environment,
        context: {
          path: context.project.path || process.cwd(),
          timestamp: context.timestamp || new Date().toISOString(),
          sessionId: context.sessionId || 'unknown',
          version: context.version || 'v1',
        },
      };

      // Process template with shared utilities
      const { processed, variables } = this.processTemplate(template, templateContext, errors);

      debugIf(() => ({
        message: 'Template parsing complete',
        meta: {
          original: template,
          processed,
          variableCount: variables.length,
          errorCount: errors.length,
        },
      }));

      return {
        original: template,
        processed,
        variables,
        errors,
      };
    } catch (error) {
      const errorMsg = `Template parsing failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      logger.error(errorMsg);

      return {
        original: template,
        processed: this.options.strictMode ? '' : template,
        variables: [],
        errors,
      };
    }
  }

  /**
   * Process template with variable substitution
   */
  private processTemplate(
    template: string,
    context: TemplateContext,
    errors: string[],
  ): { processed: string; variables: TemplateVariable[] } {
    let processed = template;
    const variables: TemplateVariable[] = [];

    // Use shared utilities to extract variables
    const extractedVariables = TemplateUtils.extractVariables(template);

    for (const variable of extractedVariables) {
      try {
        variables.push(variable);
        const value = this.resolveVariable(variable, context);
        processed = processed.replace(`{${variable.name}}`, value);
      } catch (error) {
        const errorMsg = `Error processing variable '${variable.name}': ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);

        if (this.options.strictMode) {
          throw new Error(errorMsg);
        } else {
          // Keep original placeholder in non-strict mode
          processed = processed.replace(`{${variable.name}}`, this.options.defaultValue);
        }
      }
    }

    return { processed, variables };
  }

  /**
   * Resolve variable value from context
   */
  private resolveVariable(variable: TemplateVariable, context: TemplateContext): string {
    try {
      // Get the source object based on namespace
      const source = this.getSourceByNamespace(variable.namespace, context);

      // Use shared utilities to navigate the path
      const value = TemplateUtils.getNestedValue(source, variable.path);

      // Handle undefined/null values
      if (value === null || value === undefined) {
        if (variable.optional) {
          return variable.defaultValue || this.options.defaultValue;
        }
        throw new Error(`Variable '${variable.name}' is null or undefined`);
      }

      // Handle object values
      if (typeof value === 'object') {
        if (this.options.allowUndefined) {
          return TemplateUtils.stringifyValue(value);
        }
        throw new Error(
          `Variable '${variable.name}' resolves to an object. Use specific path or enable allowUndefined option.`,
        );
      }

      // Use shared utilities for string conversion
      return TemplateUtils.stringifyValue(value);
    } catch (error) {
      if (variable.optional) {
        return variable.defaultValue || this.options.defaultValue;
      }
      throw error;
    }
  }

  /**
   * Get source object by namespace
   */
  private getSourceByNamespace(namespace: TemplateVariable['namespace'], context: TemplateContext): unknown {
    switch (namespace) {
      case 'project':
        return context.project;
      case 'user':
        return context.user;
      case 'environment':
        return context.environment;
      case 'context':
        return context.context;
      default:
        throw new Error(`Unknown namespace: ${namespace}`);
    }
  }

  /**
   * Parse multiple templates
   */
  parseMultiple(templates: string[], context: ContextData): TemplateParseResult[] {
    return templates.map((template) => this.parse(template, context));
  }

  /**
   * Extract variables from template without processing
   */
  extractVariables(template: string): TemplateVariable[] {
    return TemplateUtils.extractVariables(template);
  }

  /**
   * Check if template contains variables
   */
  hasVariables(template: string): boolean {
    return TemplateUtils.hasVariables(template);
  }
}
