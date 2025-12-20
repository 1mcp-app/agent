import type { TemplateVariable } from '@src/types/context.js';

/**
 * Template parsing utilities shared across parser and validator
 */
export class TemplateUtils {
  /**
   * Parse variable specification string into structured format
   */
  static parseVariableSpec(spec: string): TemplateVariable {
    if (spec === '') {
      throw new Error('Empty variable specification');
    }

    // Handle optional syntax: {project.path?} or {project.path?:default}
    let variablePath = spec;
    let optional = false;
    let defaultValue: string | undefined;

    if (spec.endsWith('?')) {
      optional = true;
      variablePath = spec.slice(0, -1);
    } else if (spec.includes('?:')) {
      const parts = spec.split('?:');
      if (parts.length === 2) {
        optional = true;
        variablePath = parts[0];
        defaultValue = parts[1];
      }
    }

    // Handle function calls: {func(arg1, arg2)} or {project.path | func(arg1, arg2)}
    const pipelineMatch = variablePath.match(/^([^|]+?)\s*\|\s*(.+)$/);
    if (pipelineMatch) {
      // Variable with function filter: {project.path | func(arg1, arg2)}
      const [, varPart, funcPart] = pipelineMatch;
      const variable = this.parseVariableSpec(varPart.trim());

      // Parse function chain
      const functions = this.parseFunctionChain(funcPart.trim());

      return {
        ...variable,
        name: spec,
        functions,
      };
    }

    // Handle direct function calls: {func(arg1, arg2)}
    const functionMatch = variablePath.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
    if (functionMatch) {
      const [, funcName, argsStr] = functionMatch;
      const args = this.parseFunctionArguments(argsStr);

      return {
        name: spec,
        namespace: 'context', // Functions live in context namespace
        path: [funcName],
        optional,
        defaultValue,
        functions: [{ name: funcName, args }],
      };
    }

    // Regular variable parsing
    const parts = variablePath.split('.');
    if (parts.length < 2) {
      throw new Error(`Variable must include namespace (e.g., project.path, user.name)`);
    }

    const namespace = parts[0] as TemplateVariable['namespace'];
    const path = parts.slice(1);

    // Validate namespace
    const validNamespaces = ['project', 'user', 'environment', 'context', 'transport'];
    if (!validNamespaces.includes(namespace)) {
      throw new Error(`Invalid namespace '${namespace}'. Valid namespaces: ${validNamespaces.join(', ')}`);
    }

    return {
      name: spec,
      namespace,
      path,
      optional,
      defaultValue,
    };
  }

  /**
   * Parse function chain from filter string
   */
  static parseFunctionChain(filterStr: string): Array<{ name: string; args: string[] }> {
    const functions: Array<{ name: string; args: string[] }> = [];

    // Split by | but not within parentheses
    const parts = filterStr.split(/\s*\|\s*(?![^(]*\))/);

    for (const part of parts) {
      const match = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/);
      if (match) {
        const [, funcName, argsStr] = match;
        const args = this.parseFunctionArguments(argsStr);
        functions.push({ name: funcName, args });
      } else if (part.trim()) {
        // Simple function without args: {project.path | uppercase}
        functions.push({ name: part.trim(), args: [] });
      }
    }

    return functions;
  }

  /**
   * Parse function arguments from argument string
   */
  static parseFunctionArguments(argsStr: string): string[] {
    if (!argsStr.trim()) {
      return [];
    }

    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let depth = 0;

    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else if (!inQuotes && char === '(') {
        depth++;
      } else if (!inQuotes && char === ')') {
        depth--;
      } else if (!inQuotes && char === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  /**
   * Extract variables from template string
   */
  static extractVariables(template: string): TemplateVariable[] {
    const variables: TemplateVariable[] = [];
    const variableRegex = /\{([^}]+)\}/g;
    const matches = [...template.matchAll(variableRegex)];

    for (const match of matches) {
      try {
        const variableSpec = match[1];
        const variable = this.parseVariableSpec(variableSpec);
        variables.push(variable);
      } catch {
        // Variables that fail to parse will be caught during parsing
        // We don't log here to avoid duplicate error messages
      }
    }

    return variables;
  }

  /**
   * Check if template contains variables
   */
  static hasVariables(template: string): boolean {
    return /\{[^}]+\}/.test(template);
  }

  /**
   * Get nested property value safely
   */
  static getNestedValue(obj: unknown, path: string[]): unknown {
    let current = obj;
    for (const part of path) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  /**
   * Validate template syntax basics
   */
  static validateBasicSyntax(template: string): string[] {
    const errors: string[] = [];

    // Check for empty variables
    if (/\{\s*\}/g.test(template)) {
      errors.push('Template contains empty variable {}');
    }

    // Check for potentially dangerous expressions
    if (template.includes('${') || template.includes('eval(') || template.includes('Function(')) {
      errors.push('Template contains potentially dangerous expressions');
    }

    // Check for unbalanced braces
    let openCount = 0;
    for (let i = 0; i < template.length; i++) {
      if (template[i] === '{') {
        openCount++;
      } else if (template[i] === '}') {
        openCount--;
        if (openCount < 0) {
          errors.push(`Unmatched closing brace at position ${i}`);
          break;
        }
      }
    }

    if (openCount > 0) {
      errors.push(`Unmatched opening braces: ${openCount} unmatched`);
    }

    return errors;
  }

  /**
   * Convert value to string safely
   */
  static stringifyValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }
}
