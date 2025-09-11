/**
 * Standardized error handling utilities for preset operations
 */

export interface PresetErrorOptions {
  context?: string;
  userMessage?: string;
  exit?: boolean;
  exitCode?: number;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Standardized error class for preset operations
 */
export class PresetError extends Error {
  public readonly context?: string;
  public readonly userMessage?: string;
  public readonly exitCode?: number;
  public readonly logLevel: 'error' | 'warn' | 'info' | 'debug';

  constructor(message: string, options: PresetErrorOptions = {}) {
    super(message);
    this.name = 'PresetError';
    this.context = options.context;
    this.userMessage = options.userMessage;
    this.exitCode = options.exitCode;
    this.logLevel = options.logLevel || 'error';
  }
}

/**
 * Error handler with consistent formatting and behavior
 */
export class PresetErrorHandler {
  /**
   * Create and throw a standardized preset error
   */
  static throwError(message: string, options: PresetErrorOptions = {}): never {
    const error = new PresetError(message, options);
    throw error;
  }

  /**
   * Handle CLI error with proper exit codes and user-friendly messages
   */
  static handleCliError(error: unknown, context?: string): never {
    if (error instanceof PresetError) {
      if (error.userMessage) {
        console.error(`❌ ${error.userMessage}`);
      }

      if (error.context || context) {
        console.error(`Context: ${error.context || context}`);
      }

      process.exit(error.exitCode || 1);
    }

    // Handle unknown errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ ${context ? `${context}: ` : ''}${errorMessage}`);
    process.exit(1);
  }

  /**
   * Create a validation error with consistent formatting
   */
  static validationError(message: string, field?: string, options: PresetErrorOptions = {}): never {
    const userMessage = field ? `Invalid ${field}: ${message}` : message;
    this.throwError(message, {
      ...options,
      userMessage,
      context: options.context || 'validation',
    });
  }

  /**
   * Create a file operation error
   */
  static fileError(operation: 'read' | 'write' | 'delete', filePath: string, error: unknown): never {
    const operationPast = operation === 'read' ? 'reading' : operation === 'write' ? 'writing' : 'deleting';
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    this.throwError(`Failed to ${operationPast} file: ${errorMessage}`, {
      context: `file ${operation}`,
      userMessage: `Could not ${operationPast} preset file: ${filePath}`,
      exitCode: 2,
    });
  }

  /**
   * Create a parsing error for invalid filter expressions
   */
  static parseError(expression: string, error: unknown, options: PresetErrorOptions = {}): never {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    this.throwError(`Failed to parse filter expression: ${errorMessage}`, {
      ...options,
      context: 'filter parsing',
      userMessage: `Invalid filter expression: "${expression}"`,
      exitCode: options.exitCode || 1,
    });
  }

  /**
   * Create a not found error
   */
  static notFoundError(type: 'preset' | 'server' | 'config', name: string, options: PresetErrorOptions = {}): never {
    this.throwError(`${type} '${name}' not found`, {
      ...options,
      context: `${type} lookup`,
      userMessage: `No ${type} found with name: ${name}`,
      exitCode: 4,
    });
  }

  /**
   * Wrap a function with standardized error handling
   */
  static withErrorHandling<T>(fn: () => T, context?: string, options: PresetErrorOptions = {}): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof PresetError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.throwError(`${context}: ${errorMessage}`, {
        ...options,
        context: context || options.context,
      });
    }
  }

  /**
   * Create a user-friendly error message for filter examples
   */
  static createFilterError(expression: string): never {
    console.error(`❌ Invalid filter expression: ${expression}`);
    console.error('Examples:');
    console.error('  --filter "web,api,database"           # OR logic (comma-separated)');
    console.error('  --filter "web AND database"           # AND logic');
    console.error('  --filter "(web OR api) AND database"  # Complex expressions');

    this.parseError(expression, 'Invalid syntax', {
      userMessage: `Invalid filter expression: "${expression}"`,
      context: 'filter parsing',
      exitCode: 1,
    });
  }

  /**
   * Log error with structured format
   */
  static logError(error: unknown, context?: string): void {
    // Import logger dynamically to avoid circular dependencies
    import('../logger/logger.js')
      .then(({ default: logger }) => {
        if (error instanceof PresetError) {
          logger[error.logLevel](error.message, {
            context: error.context || context,
            userMessage: error.userMessage,
            exitCode: error.exitCode,
            stack: error.stack,
          });
        } else {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.error('Unexpected error', {
            context,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
      })
      .catch(() => {
        // Fallback to console if logger import fails
        console.error('Error logging failed:', error);
      });
  }
}
