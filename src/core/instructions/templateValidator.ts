import Handlebars from 'handlebars';

/**
 * Template validation result with error details if invalid
 */
export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
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
      suggestions: [
        'Consider splitting the template into smaller files',
        'Remove unnecessary content or comments',
        'Use template partials for repeated sections',
      ],
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
          suggestions: [
            'Remove script tags and event handlers',
            'Use safe template variables only',
            'Consider using triple braces {{{content}}} only for trusted content',
            'Review template security best practices',
          ],
        };
      }
    }
  }

  // Validate Handlebars syntax by attempting compilation
  try {
    Handlebars.compile(templateContent, { noEscape: true });
    return { valid: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Provide helpful suggestions based on common errors
    const suggestions: string[] = [];
    if (errorMessage.includes('Parse error')) {
      suggestions.push('Check for unmatched braces {{ }}');
      suggestions.push('Ensure all Handlebars expressions are properly closed');
      suggestions.push('Verify nested expressions have correct syntax');
    }
    if (errorMessage.includes('Expected')) {
      suggestions.push('Verify template syntax matches Handlebars documentation');
      suggestions.push('Check for typos in helper names or variable references');
      suggestions.push('Ensure block helpers like {{#if}} have matching {{/if}}');
    }
    if (errorMessage.includes('Missing helper')) {
      suggestions.push('Use only built-in Handlebars helpers');
      suggestions.push('Check available template variables in documentation');
    }

    return {
      valid: false,
      error: `Template syntax error${pathInfo}: ${errorMessage}`,
      suggestions:
        suggestions.length > 0
          ? suggestions
          : [
              'Check Handlebars documentation for proper syntax',
              'Test template with a simple Handlebars validator',
              'Start with a minimal template and add complexity gradually',
            ],
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
    const fs = require('fs');
    const stats = fs.statSync(filePath);
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
