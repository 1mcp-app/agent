import logger, { debugIf } from '@src/logger/logger.js';
import type { TemplateVariable } from '@src/types/context.js';

import { TemplateFunctions } from './templateFunctions.js';
import { TemplateUtils } from './templateUtils.js';

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  variables: TemplateVariable[];
}

/**
 * Template validator options
 */
export interface TemplateValidatorOptions {
  allowSensitiveData?: boolean;
  maxTemplateLength?: number;
  maxVariableDepth?: number;
  forbiddenNamespaces?: ('project' | 'user' | 'environment' | 'context')[];
  requiredNamespaces?: ('project' | 'user' | 'environment' | 'context')[];
}

/**
 * Sensitive data patterns that should not be allowed in templates
 */
const SENSITIVE_PATTERNS = [/password/i, /secret/i, /token/i, /key/i, /auth/i, /credential/i, /private/i];

/**
 * Template Validator Implementation
 *
 * Validates template syntax, security, and usage patterns.
 * Prevents injection attacks and ensures template safety.
 */
export class TemplateValidator {
  private options: Required<TemplateValidatorOptions>;

  constructor(options: TemplateValidatorOptions = {}) {
    this.options = {
      allowSensitiveData: options.allowSensitiveData ?? false,
      maxTemplateLength: options.maxTemplateLength ?? 10000,
      maxVariableDepth: options.maxVariableDepth ?? 5,
      forbiddenNamespaces: options.forbiddenNamespaces ?? [],
      requiredNamespaces: options.requiredNamespaces ?? [],
    };
  }

  /**
   * Validate a template string
   */
  validate(template: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Check template length
      if (template.length > this.options.maxTemplateLength) {
        errors.push(`Template too long: ${template.length} > ${this.options.maxTemplateLength}`);
      }

      // Use shared utilities to extract variables
      const variables = TemplateUtils.extractVariables(template);

      // Also validate each variable spec to catch parsing errors
      const variableRegex = /\{([^}]+)\}/g;
      const matches = [...template.matchAll(variableRegex)];

      for (const match of matches) {
        try {
          const variable = TemplateUtils.parseVariableSpec(match[1]);
          errors.push(...this.validateVariable(variable));
        } catch (error) {
          errors.push(`Invalid variable '${match[1]}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Check for required namespaces
      if (this.options.requiredNamespaces.length > 0) {
        const foundNamespaces = new Set(variables.map((v) => v.namespace));
        for (const required of this.options.requiredNamespaces) {
          if (!foundNamespaces.has(required)) {
            warnings.push(`Template missing required namespace: ${required}`);
          }
        }
      }

      // Use shared utilities for syntax validation
      errors.push(...TemplateUtils.validateBasicSyntax(template));

      // Check for nested variables (warning only)
      const nestedRegex = /\{[^{}]*\{[^}]*\}[^{}]*\}/g;
      const nestedMatches = template.match(nestedRegex);
      if (nestedMatches) {
        warnings.push(`Template contains nested variables: ${nestedMatches.join(', ')}`);
      }

      debugIf(() => ({
        message: 'Template validation complete',
        meta: {
          templateLength: template.length,
          variableCount: variables.length,
          errorCount: errors.length,
          warningCount: warnings.length,
        },
      }));

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        variables,
      };
    } catch (error) {
      const errorMsg = `Template validation failed: ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMsg);
      logger.error(errorMsg);

      return {
        valid: false,
        errors,
        warnings,
        variables: [],
      };
    }
  }

  /**
   * Validate multiple templates
   */
  validateMultiple(templates: string[]): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    const allVariables: TemplateVariable[] = [];

    for (let i = 0; i < templates.length; i++) {
      const result = this.validate(templates[i]);

      // Add template index to errors and warnings
      const indexedErrors = result.errors.map((error) => `Template ${i + 1}: ${error}`);
      const indexedWarnings = result.warnings.map((warning) => `Template ${i + 1}: ${warning}`);

      allErrors.push(...indexedErrors);
      allWarnings.push(...indexedWarnings);
      allVariables.push(...result.variables);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
      variables: allVariables,
    };
  }

  /**
   * Validate a single variable
   */
  private validateVariable(variable: TemplateVariable): string[] {
    const errors: string[] = [];

    // Check forbidden namespaces
    if (this.options.forbiddenNamespaces.includes(variable.namespace)) {
      errors.push(`Forbidden namespace: ${variable.namespace}`);
    }

    // Check namespace validity
    const validNamespaces = ['project', 'user', 'environment', 'context'];
    if (!validNamespaces.includes(variable.namespace)) {
      errors.push(`Invalid namespace '${variable.namespace}'. Valid: ${validNamespaces.join(', ')}`);
    }

    // Check variable depth
    if (variable.path.length > this.options.maxVariableDepth) {
      errors.push(`Variable path too deep: ${variable.path.length} > ${this.options.maxVariableDepth}`);
    }

    // Check for sensitive data
    if (!this.options.allowSensitiveData) {
      const fullName = [variable.namespace, ...variable.path].join('.');
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(fullName)) {
          errors.push(`Variable may expose sensitive data: ${fullName}`);
        }
      }
    }

    // Check path parts for validity
    for (const part of variable.path) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)) {
        errors.push(`Invalid path component: ${part}`);
      }
    }

    return errors;
  }

  /**
   * Validate that template functions exist
   */
  validateFunctions(template: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const variables: TemplateVariable[] = [];

    // Extract function calls from template
    const functionRegex = /\{[^}]*\|[^}]*\([^}]*\)[^}]*\}/g;
    const matches = template.match(functionRegex);

    if (matches) {
      for (const match of matches) {
        // Extract function name (simplified regex)
        const funcMatch = match.match(/\|([a-zA-Z_][a-zA-Z0-9_]*)\(/);
        if (funcMatch) {
          const funcName = funcMatch[1];
          if (!TemplateFunctions.has(funcName)) {
            errors.push(`Unknown template function: ${funcName}`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      variables,
    };
  }

  /**
   * Sanitize template by removing or escaping dangerous content
   */
  sanitize(template: string): string {
    let sanitized = template;

    // Remove dangerous expressions
    sanitized = sanitized.replace(/\$\{[^}]*\}/g, '[removed]');
    sanitized = sanitized.replace(/eval\([^)]*\)/g, '[removed]');
    sanitized = sanitized.replace(/Function\([^)]*\)/g, '[removed]');

    return sanitized;
  }
}
