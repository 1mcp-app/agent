import type { ContextData } from '@src/types/context.js';

import { TemplateParser } from './templateParser.js';
import type { TemplateParseResult } from './templateParser.js';
import { TemplateUtils } from './templateUtils.js';
import { TemplateValidator } from './templateValidator.js';

/**
 * Configuration field processor that handles template substitution
 * in a generic way
 */
export class ConfigFieldProcessor {
  private parser: TemplateParser;
  private validator: TemplateValidator;
  private templateProcessor?: (template: string, context: ContextData) => TemplateParseResult;

  constructor(
    parser: TemplateParser,
    validator: TemplateValidator,
    templateProcessor?: (template: string, context: ContextData) => TemplateParseResult,
  ) {
    this.parser = parser;
    this.validator = validator;
    this.templateProcessor = templateProcessor;
  }

  /**
   * Process a string field with templates
   */
  processStringField(
    value: string,
    fieldName: string,
    context: ContextData,
    errors: string[],
    processedTemplates: string[],
  ): string {
    if (!TemplateUtils.hasVariables(value)) {
      return value;
    }

    const result = this.processTemplate(fieldName, value, context);
    if (result.errors.length > 0) {
      errors.push(...result.errors.map((e) => `${fieldName}: ${e}`));
    }

    processedTemplates.push(`${fieldName}: ${value} -> ${result.processed}`);
    return result.processed;
  }

  /**
   * Process an array field with templates
   */
  processArrayField(
    values: string[],
    fieldName: string,
    context: ContextData,
    errors: string[],
    processedTemplates: string[],
  ): string[] {
    return values.map((value, index) => {
      if (!TemplateUtils.hasVariables(value)) {
        return value;
      }

      const result = this.processTemplate(`${fieldName}[${index}]`, value, context);
      if (result.errors.length > 0) {
        errors.push(...result.errors.map((e) => `${fieldName}[${index}]: ${e}`));
      }

      processedTemplates.push(`${fieldName}[${index}]: ${value} -> ${result.processed}`);
      return result.processed;
    });
  }

  /**
   * Process an object field with templates
   */
  processObjectField(
    obj: Record<string, string> | string[],
    fieldName: string,
    context: ContextData,
    errors: string[],
    processedTemplates: string[],
  ): Record<string, string> | string[] {
    // Handle string arrays (like env array format)
    if (Array.isArray(obj)) {
      return this.processArrayField(obj, fieldName, context, errors, processedTemplates);
    }

    // Handle object format
    return this.processRecordField(obj, fieldName, context, errors, processedTemplates);
  }

  /**
   * Process a record field with templates (always returns Record<string, string>)
   */
  processRecordField(
    obj: Record<string, string>,
    fieldName: string,
    context: ContextData,
    errors: string[],
    processedTemplates: string[],
  ): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value !== 'string') {
        result[key] = value;
        continue;
      }

      if (!TemplateUtils.hasVariables(value)) {
        result[key] = value;
        continue;
      }

      const parseResult = this.processTemplate(`${fieldName}.${key}`, value, context);
      if (parseResult.errors.length > 0) {
        errors.push(...parseResult.errors.map((e) => `${fieldName}.${key}: ${e}`));
      }

      result[key] = parseResult.processed;
      processedTemplates.push(`${fieldName}.${key}: ${value} -> ${parseResult.processed}`);
    }

    return result;
  }

  /**
   * Process a template string with validation and parsing
   */
  private processTemplate(fieldName: string, template: string, context: ContextData): TemplateParseResult {
    // Validate template first
    const validation = this.validator.validate(template);
    if (!validation.valid) {
      return {
        original: template,
        processed: template, // Return original on validation error
        variables: [],
        errors: validation.errors,
      };
    }

    // Use external template processor if provided (for caching), otherwise use parser directly
    if (this.templateProcessor) {
      return this.templateProcessor(template, context);
    }

    // Parse and process the template
    return this.parser.parse(template, context);
  }
}
