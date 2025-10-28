import { statSync } from 'node:fs';

import Handlebars from 'handlebars';

/**
 * Types of template errors for better categorization
 */
export enum TemplateErrorType {
  /** Handlebars syntax errors (unmatched braces, invalid expressions) */
  SYNTAX = 'SYNTAX',
  /** Template compilation errors (missing helpers, invalid helper usage) */
  COMPILATION = 'COMPILATION',
  /** Template size exceeds allowed limit */
  SIZE_LIMIT = 'SIZE_LIMIT',
  /** Template contains potentially unsafe content */
  UNSAFE_CONTENT = 'UNSAFE_CONTENT',
  /** Runtime errors during template rendering */
  RUNTIME = 'RUNTIME',
}

/**
 * Template validation result with error details if invalid
 */
export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
  errorType?: TemplateErrorType;
  suggestions?: string[];
}

/**
 * Configuration for template validation
 */
export interface TemplateValidationConfig {
  maxSizeBytes?: number;
  allowUnsafeContent?: boolean;
  customDangerousPatterns?: RegExp[];
}

/**
 * Default validation configuration
 */
export const DEFAULT_TEMPLATE_VALIDATION_CONFIG: Required<TemplateValidationConfig> = {
  maxSizeBytes: 1024 * 1024, // 1MB
  allowUnsafeContent: false,
  customDangerousPatterns: [],
};

/**
 * Built-in dangerous patterns for template content
 */
export const DANGEROUS_TEMPLATE_PATTERNS: RegExp[] = [
  /<script[^>]*>/i,
  /javascript:/i,
  /on\w+\s*=/i, // event handlers like onclick=
];

/**
 * Categorize template errors based on error message patterns
 * @param errorMessage Error message from Handlebars compilation
 * @returns Template error type
 */
export function categorizeTemplateError(errorMessage: string): TemplateErrorType {
  const message = errorMessage.toLowerCase();

  // Check for syntax errors
  if (
    message.includes('parse error') ||
    message.includes('expecting') ||
    message.includes('unexpected token') ||
    message.includes('unterminated') ||
    message.includes('unmatched') ||
    message.includes("doesn't match")
  ) {
    return TemplateErrorType.SYNTAX;
  }

  // Check for compilation errors
  if (
    message.includes('missing helper') ||
    message.includes('must pass iterator') ||
    message.includes('helper not found') ||
    message.includes('invalid helper')
  ) {
    return TemplateErrorType.COMPILATION;
  }

  // Default to compilation error for other Handlebars errors
  return TemplateErrorType.COMPILATION;
}

/**
 * Get specific suggestions based on error type
 * @param errorType Type of template error
 * @param errorMessage Original error message
 * @returns Array of suggestions
 */
export function getErrorSuggestions(errorType: TemplateErrorType, errorMessage: string): string[] {
  switch (errorType) {
    case TemplateErrorType.SYNTAX:
      return [
        'Check for unmatched braces {{ }}',
        'Ensure all Handlebars expressions are properly closed',
        'Verify nested expressions have correct syntax',
        'Look for unterminated block helpers like {{#if}} without {{/if}}',
      ];
    case TemplateErrorType.COMPILATION:
      if (errorMessage.includes('Must pass iterator')) {
        return [
          'Use {{#each serverNames}} instead of {{#each}}',
          'Ensure iterator variable is provided for #each helpers',
          'Check available template variables in documentation',
        ];
      }
      return [
        'Use only built-in Handlebars helpers',
        'Check available template variables in documentation',
        'Verify helper names are spelled correctly',
        'Ensure block helpers like {{#if}} have matching {{/if}}',
      ];
    case TemplateErrorType.SIZE_LIMIT:
      return [
        'Consider splitting the template into smaller files',
        'Remove unnecessary content or comments',
        'Use template partials for repeated sections',
        'Increase template size limit if necessary',
      ];
    case TemplateErrorType.UNSAFE_CONTENT:
      return [
        'Remove script tags and event handlers',
        'Use safe template variables only',
        'Consider using triple braces {{{content}}} only for trusted content',
        'Review template security best practices',
      ];
    case TemplateErrorType.RUNTIME:
      return [
        'Check template variables are correctly defined',
        'Verify data passed to template matches expected structure',
        'Test template with sample data',
      ];
    default:
      return [
        'Check Handlebars documentation for proper syntax',
        'Test template with a simple Handlebars validator',
        'Start with a minimal template and add complexity gradually',
      ];
  }
}

/**
 * Validate Handlebars template content for safety and syntax
 * @param templateContent Template content to validate
 * @param templatePath Path for error reporting (optional)
 * @param config Validation configuration (optional)
 * @returns Validation result with error details if invalid
 */
export function validateTemplateContent(
  templateContent: string,
  templatePath?: string,
  config: TemplateValidationConfig = {},
): TemplateValidationResult {
  const validationConfig = { ...DEFAULT_TEMPLATE_VALIDATION_CONFIG, ...config };
  const pathInfo = templatePath ? ` at ${templatePath}` : '';

  // Check template size
  if (templateContent.length > validationConfig.maxSizeBytes) {
    return {
      valid: false,
      error: `Template file too large${pathInfo}: ${templateContent.length} bytes (max ${Math.round(validationConfig.maxSizeBytes / 1024 / 1024)}MB)`,
      errorType: TemplateErrorType.SIZE_LIMIT,
      suggestions: getErrorSuggestions(TemplateErrorType.SIZE_LIMIT, ''),
    };
  }

  // Check for potentially dangerous content (unless explicitly allowed)
  if (!validationConfig.allowUnsafeContent) {
    const allPatterns = [...DANGEROUS_TEMPLATE_PATTERNS, ...validationConfig.customDangerousPatterns];

    for (const pattern of allPatterns) {
      if (pattern.test(templateContent)) {
        return {
          valid: false,
          error: `Template contains potentially unsafe content${pathInfo}: ${pattern.source}`,
          errorType: TemplateErrorType.UNSAFE_CONTENT,
          suggestions: getErrorSuggestions(TemplateErrorType.UNSAFE_CONTENT, ''),
        };
      }
    }
  }

  // Validate Handlebars syntax by attempting compilation and rendering
  try {
    const compiledTemplate = Handlebars.compile(templateContent, { noEscape: true });

    // Try rendering with sample data to catch runtime errors
    try {
      compiledTemplate({
        serverCount: 0,
        hasServers: false,
        serverList: '',
        serverNames: [],
        servers: [],
        pluralServers: 'servers',
        isAre: 'are',
        instructions: '',
        filterContext: '',
        toolPattern: '{server}_1mcp_{tool}',
        title: 'Test Title',
        examples: [],
      });
    } catch (renderError) {
      // If rendering fails, it's a compilation/runtime error
      const errorMessage = renderError instanceof Error ? renderError.message : String(renderError);
      const errorType = categorizeTemplateError(errorMessage);
      const suggestions = getErrorSuggestions(errorType, errorMessage);

      return {
        valid: false,
        error: `Template syntax error${pathInfo}: ${errorMessage}`,
        errorType,
        suggestions,
      };
    }

    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = categorizeTemplateError(errorMessage);
    const suggestions = getErrorSuggestions(errorType, errorMessage);

    return {
      valid: false,
      error: `Template syntax error${pathInfo}: ${errorMessage}`,
      errorType,
      suggestions,
    };
  }
}

/**
 * Validate template file size before reading
 * @param filePath Path to template file
 * @param maxSizeBytes Maximum allowed file size in bytes
 * @returns True if file size is acceptable
 */
export function isTemplateSizeAcceptable(
  filePath: string,
  maxSizeBytes: number = DEFAULT_TEMPLATE_VALIDATION_CONFIG.maxSizeBytes,
): boolean {
  try {
    const stats = statSync(filePath);
    return stats.size <= maxSizeBytes;
  } catch {
    return false; // File doesn't exist or can't be accessed
  }
}

/**
 * Quick validation for template content safety (without compilation)
 * @param templateContent Template content to check
 * @param config Validation configuration
 * @returns True if content appears safe
 */
export function isTemplateContentSafe(templateContent: string, config: TemplateValidationConfig = {}): boolean {
  const validationConfig = { ...DEFAULT_TEMPLATE_VALIDATION_CONFIG, ...config };

  if (!validationConfig.allowUnsafeContent) {
    const allPatterns = [...DANGEROUS_TEMPLATE_PATTERNS, ...validationConfig.customDangerousPatterns];
    return !allPatterns.some((pattern) => pattern.test(templateContent));
  }

  return true;
}

/**
 * Get human-readable validation error message with suggestions
 * @param result Validation result from validateTemplateContent
 * @returns Formatted error message with suggestions
 */
export function formatValidationError(result: TemplateValidationResult): string {
  if (result.valid) {
    return '';
  }

  let message = result.error || 'Template validation failed';

  if (result.suggestions && result.suggestions.length > 0) {
    message += '\n\nSuggestions:';
    result.suggestions.forEach((suggestion, index) => {
      message += `\n  ${index + 1}. ${suggestion}`;
    });
  }

  return message;
}
