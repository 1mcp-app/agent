import { registerTemplateHelpers } from '@src/core/instructions/templateHelpers.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import type { ContextData } from '@src/types/context.js';

import Handlebars from 'handlebars';

/**
 * Simple Handlebars template renderer
 *
 * Replaces the complex TemplateVariableExtractor with direct template rendering.
 * Renders template configurations with context data and returns the result.
 *
 * This approach:
 * - Eliminates variable extraction complexity
 * - Uses rendered config hash for instance identification
 * - Leverages existing Handlebars helpers and battle-tested rendering
 * - Uses {{var}} syntax (standard Handlebars)
 */
export class HandlebarsTemplateRenderer {
  constructor() {
    // Register existing helpers from the codebase
    registerTemplateHelpers();
  }

  /**
   * Render a template configuration with the provided context
   *
   * @param templateConfig - Configuration with {{variable}} placeholders
   * @param context - Context data to substitute into templates
   * @returns Rendered configuration with all variables replaced
   */
  renderTemplate(templateConfig: MCPServerParams, context: ContextData): MCPServerParams {
    // Deep clone to avoid mutating the original configuration
    const config = JSON.parse(JSON.stringify(templateConfig)) as MCPServerParams;

    // Render command string
    if (config.command && typeof config.command === 'string') {
      config.command = this.renderString(config.command, context);
    }

    // Render args array elements
    if (config.args) {
      config.args = config.args.map((arg: string | number | boolean) =>
        typeof arg === 'string' ? this.renderString(arg, context) : String(arg),
      );
    }

    // Render environment variables
    if (config.env) {
      if (Array.isArray(config.env)) {
        // Handle array format: just convert non-string elements to strings
        config.env = config.env.map((item) => String(item));
      } else {
        // Handle record format: render string values
        const renderedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(config.env)) {
          if (typeof value === 'string') {
            renderedEnv[key] = this.renderString(value, context);
          } else {
            renderedEnv[key] = String(value);
          }
        }
        config.env = renderedEnv;
      }
    }

    // Render other string fields that might contain templates
    const stringFields: Array<keyof MCPServerParams> = ['cwd', 'url'];
    stringFields.forEach((field) => {
      const fieldValue = config[field];
      if (fieldValue && typeof fieldValue === 'string') {
        // Use type assertion to safely assign the rendered string
        (config as Record<string, unknown>)[field] = this.renderString(fieldValue, context);
      }
    });

    return config;
  }

  /**
   * Render a single string template with context
   *
   * @param template - String with {{variable}} placeholders
   * @param context - Context data for substitution
   * @returns Rendered string with variables replaced
   */
  private renderString(template: string, context: ContextData): string {
    // Quick check to skip compilation if no template variables
    if (!template.includes('{{')) {
      return template;
    }

    try {
      const compiled = Handlebars.compile(template);
      return compiled(context);
    } catch {
      // Return original template if rendering fails
      // This maintains graceful degradation
      return template;
    }
  }
}
