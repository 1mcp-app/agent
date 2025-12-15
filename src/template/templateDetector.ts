import type { MCPServerParams } from '@src/core/types/transport.js';

/**
 * Template detection utility for MCP server configurations
 *
 * Provides utilities to detect template syntax in server configurations
 * and validate that templates are only used in appropriate sections.
 */
export class TemplateDetector {
  /**
   * Regular expression for detecting template syntax
   * Matches patterns like {project.name}, {user.username}, etc.
   */
  private static readonly TEMPLATE_REGEX = /\{[^}]*\}/g;

  /**
   * Regular expression for detecting incomplete template syntax (for validation)
   * Matches patterns like {project.name (missing closing brace)
   */
  private static readonly INCOMPLETE_TEMPLATE_REGEX = /\{[^}]*$/g;

  /**
   * Regular expression for detecting nested template patterns
   * Matches patterns with double opening braces like {{project.name}}
   */
  private static readonly NESTED_TEMPLATE_REGEX = /\{\{[^}]*\}\}/g;

  /**
   * Set of field names that commonly contain template values
   */
  private static readonly TEMPLATE_PRONE_FIELDS = new Set(['command', 'args', 'cwd', 'url', 'env', 'disabled']);

  /**
   * Detect template syntax in a string value
   *
   * @param value - String value to check for templates
   * @returns Array of template strings found in the value
   */
  public static detectTemplatesInString(value: string): string[] {
    if (!value || typeof value !== 'string') {
      return [];
    }

    const matches = value.match(this.TEMPLATE_REGEX);
    if (!matches) {
      return [];
    }

    // Remove duplicates while preserving order
    return [...new Set(matches)];
  }

  /**
   * Detect template syntax in an array of strings
   *
   * @param values - Array of strings to check for templates
   * @returns Array of template strings found in the array
   */
  public static detectTemplatesInArray(values: string[]): string[] {
    if (!Array.isArray(values)) {
      return [];
    }

    const allTemplates: string[] = [];
    for (const value of values) {
      if (typeof value === 'string') {
        allTemplates.push(...this.detectTemplatesInString(value));
      }
    }

    return [...new Set(allTemplates)];
  }

  /**
   * Detect template syntax in an object's string values
   *
   * @param obj - Object to check for templates
   * @returns Array of template strings found in the object
   */
  public static detectTemplatesInObject(obj: Record<string, unknown>): string[] {
    if (!obj || typeof obj !== 'object') {
      return [];
    }

    const allTemplates: string[] = [];
    for (const [_key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        // Only check string values in objects
        allTemplates.push(...this.detectTemplatesInString(value));
      }
    }

    return [...new Set(allTemplates)];
  }

  /**
   * Detect template syntax in a complete MCP server configuration
   *
   * @param config - MCP server configuration to check
   * @returns Array of template strings found in the configuration
   */
  public static detectTemplatesInConfig(config: MCPServerParams): string[] {
    const allTemplates: string[] = [];

    // Check common string fields that might contain templates
    for (const field of this.TEMPLATE_PRONE_FIELDS) {
      const value = config[field as keyof MCPServerParams];

      if (typeof value === 'string') {
        allTemplates.push(...this.detectTemplatesInString(value));
      } else if (Array.isArray(value)) {
        allTemplates.push(...this.detectTemplatesInArray(value));
      } else if (typeof value === 'object' && value !== null) {
        allTemplates.push(...this.detectTemplatesInObject(value));
      }
    }

    return [...new Set(allTemplates)];
  }

  /**
   * Check if a configuration contains any template syntax
   *
   * @param config - MCP server configuration to check
   * @returns True if the configuration contains templates
   */
  public static hasTemplates(config: MCPServerParams): boolean {
    return this.detectTemplatesInConfig(config).length > 0;
  }

  /**
   * Validate that a configuration is template-free (for mcpServers section)
   *
   * @param config - MCP server configuration to validate
   * @returns Validation result with details about any templates found
   */
  public static validateTemplateFree(config: MCPServerParams): {
    valid: boolean;
    templates: string[];
    locations: string[];
  } {
    const templates = this.detectTemplatesInConfig(config);
    const locations: string[] = [];

    if (templates.length > 0) {
      // Find specific locations where templates were found
      for (const field of this.TEMPLATE_PRONE_FIELDS) {
        const value = config[field as keyof MCPServerParams];

        if (typeof value === 'string' && this.detectTemplatesInString(value).length > 0) {
          locations.push(`${field}: "${value}"`);
        } else if (Array.isArray(value)) {
          const templatesInArray = this.detectTemplatesInArray(value);
          if (templatesInArray.length > 0) {
            locations.push(`${field}: [${value.join(', ')}]`);
          }
        } else if (typeof value === 'object' && value !== null) {
          const templatesInObject = this.detectTemplatesInObject(value);
          if (templatesInObject.length > 0) {
            locations.push(`${field}: ${JSON.stringify(value)}`);
          }
        }
      }
    }

    return {
      valid: templates.length === 0,
      templates,
      locations,
    };
  }

  /**
   * Extract template variable names from template strings
   *
   * @param templates - Array of template strings (e.g., ["{project.name}", "{user.username}"])
   * @returns Array of variable names (e.g., ["project.name", "user.username"])
   */
  public static extractVariableNames(templates: string[]): string[] {
    const variableNames: string[] = [];
    const seenNonEmpty = new Set<string>();

    for (const template of templates) {
      // Skip empty strings that are not templates
      if (!template || template.trim() === '') {
        continue;
      }

      // Remove only the outermost curly braces, preserving inner braces
      let variable = template.trim();
      if (variable.startsWith('{') && variable.endsWith('}')) {
        variable = variable.slice(1, -1).trim();
      }

      // For empty templates (like {} or { }), always include them
      if (variable === '') {
        variableNames.push(variable);
      } else {
        // For non-empty templates, only add if we haven't seen it before
        if (!seenNonEmpty.has(variable)) {
          seenNonEmpty.add(variable);
          variableNames.push(variable);
        }
      }
    }

    return variableNames;
  }

  /**
   * Validate template syntax and return detailed information
   *
   * @param config - MCP server configuration to validate
   * @returns Detailed validation result
   */
  public static validateTemplateSyntax(config: MCPServerParams): {
    hasTemplates: boolean;
    templates: string[];
    variables: string[];
    locations: string[];
    isValid: boolean;
    errors: string[];
  } {
    const templates = this.detectTemplatesInConfig(config);
    const locations: string[] = [];
    const errors: string[] = [];

    // Also collect incomplete and nested templates for validation
    const allTemplates: string[] = [...templates];

    // Check for all template patterns including nested and incomplete
    for (const field of this.TEMPLATE_PRONE_FIELDS) {
      const value = config[field as keyof MCPServerParams];

      if (typeof value === 'string') {
        // Find all template patterns (complete, nested, or incomplete)
        // Order matters: more specific patterns first
        const templateMatches = value.match(/\{\{[^}]*\}\}|\{[^}]*\}|\{[^}]*$/g) || [];
        for (const match of templateMatches) {
          // Add if not already in allTemplates
          if (!allTemplates.includes(match)) {
            allTemplates.push(match);
          }

          // Check for unbalanced braces
          const matchOpenBraces = (match.match(/{/g) || []).length;
          const matchCloseBraces = (match.match(/}/g) || []).length;
          if (matchOpenBraces !== matchCloseBraces) {
            errors.push(`Unbalanced braces in template: ${match}`);
          }
        }
      } else if (Array.isArray(value)) {
        // Check for template patterns in arrays
        for (const item of value) {
          if (typeof item === 'string') {
            // Order matters: more specific patterns first
            const templateMatches = item.match(/\{\{[^}]*\}\}|\{[^}]*\}|\{[^}]*$/g) || [];
            for (const match of templateMatches) {
              // Add if not already in allTemplates
              if (!allTemplates.includes(match)) {
                allTemplates.push(match);
              }

              // Check for unbalanced braces
              const matchOpenBraces = (match.match(/{/g) || []).length;
              const matchCloseBraces = (match.match(/}/g) || []).length;
              if (matchOpenBraces !== matchCloseBraces) {
                errors.push(`Unbalanced braces in template: ${match}`);
              }
            }
          }
        }
      }
    }

    // Find locations and check for syntax errors
    for (const field of this.TEMPLATE_PRONE_FIELDS) {
      const value = config[field as keyof MCPServerParams];

      if (typeof value === 'string') {
        const fieldTemplates = this.detectTemplatesInString(value);
        if (fieldTemplates.length > 0) {
          locations.push(`${field}: "${value}"`);
        }
      } else if (Array.isArray(value)) {
        const fieldTemplates = this.detectTemplatesInArray(value);
        if (fieldTemplates.length > 0) {
          locations.push(`${field}: [${value.join(', ')}]`);
        }
      } else if (typeof value === 'object' && value !== null) {
        const fieldTemplates = this.detectTemplatesInObject(value);
        if (fieldTemplates.length > 0) {
          locations.push(`${field}: ${JSON.stringify(value)}`);
        }

        // Also check for incomplete templates in object values (especially env)
        if (field === 'env') {
          for (const [, envValue] of Object.entries(value as Record<string, unknown>)) {
            if (typeof envValue === 'string') {
              const incompleteMatches = envValue.match(/\{[^}]*$/g) || [];
              for (const match of incompleteMatches) {
                if (!allTemplates.includes(match)) {
                  allTemplates.push(match);
                }
              }
            }
          }
        }
      }
    }

    // Check for common syntax errors
    for (const template of allTemplates) {
      // Check for empty templates
      if (template === '{}' || template === '{ }') {
        errors.push(`Empty template found: ${template}`);
      }

      // Check for unbalanced braces
      const matchOpenBraces = (template.match(/{/g) || []).length;
      const matchCloseBraces = (template.match(/}/g) || []).length;
      if (matchOpenBraces !== matchCloseBraces) {
        errors.push(`Unbalanced braces in template: ${template}`);
      }

      // Check for nested templates using specific regex
      // Create a new regex instance to avoid lastIndex issues
      const nestedRegex = /\{\{[^}]*\}/;
      if (nestedRegex.test(template)) {
        errors.push(`Nested templates detected: ${template}`);
      }
    }

    const variables = this.extractVariableNames(allTemplates);
    const isValid = errors.length === 0;

    return {
      hasTemplates: allTemplates.length > 0,
      templates: allTemplates,
      variables,
      locations,
      isValid,
      errors,
    };
  }
}
