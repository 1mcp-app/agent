import logger from './logger.js';

/**
 * Consolidated patterns for sensitive data detection
 */
const SENSITIVE_PATTERNS = [
  // OAuth tokens and credentials (consolidates 6 patterns)
  /(?:access_token|refresh_token|authorization_code|client_secret|client_id|bearer\s+[\w\-.~+/]+=*)/gi,

  // URLs with sensitive parameters (consolidates 4 patterns)
  /https?:\/\/[^\s]*[?&](?:[tT]oken|[cC]ode)=[^\s&]*/gi,

  // Query parameters with sensitive data (consolidates 2 patterns)
  /[?&](?:[tT]oken|[cC]ode)=[^\s&]*/gi,

  // OAuth configuration patterns (consolidates 4 patterns)
  /(?:scopes?|redirect_uris?|with\s+scope):\s*(?:\[[^\]]*\]|[^\s,}]+(?:\s+[^\s]+)*)/gi,

  // Generic secret patterns (consolidates 5 patterns)
  /(?:api[_-]?key|secret|password|passwd|auth[_-]?token)/gi,
];

/**
 * Base patterns for sensitive key detection (case-insensitive)
 */
const SENSITIVE_KEY_PATTERNS = ['secret', 'token', 'password', 'passwd', 'key'];

/**
 * Check if a key contains sensitive patterns
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Unified sanitization function for all data types
 */
function sanitize(value: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) {
    return '[MAX_DEPTH]';
  }

  // Handle primitives and null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    // Apply pattern-based redaction to strings
    let sanitized = value;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = sanitize(val, depth + 1);
      }
    }

    return sanitized;
  }

  return value;
}

/**
 * Sanitize data before logging - handles all data types
 */
export function sanitizeForLogging(data: unknown): unknown {
  try {
    return sanitize(data);
  } catch (error) {
    // Log the actual error safely without exposing sensitive data
    console.error('Sanitization error occurred:', error instanceof Error ? error.message : 'Unknown error');
    return '[SANITIZATION_ERROR]';
  }
}

/**
 * Create a secure logger method for a specific log level
 */
function createLoggerMethod(level: 'debug' | 'info' | 'warn' | 'error') {
  return (message: string, data?: unknown) => {
    const sanitizedMessage = typeof message === 'string' ? sanitize(message) : message;
    const sanitizedMessageStr = typeof sanitizedMessage === 'string' ? sanitizedMessage : String(sanitizedMessage);

    if (data !== undefined) {
      // Type-safe assertion that the logger method exists and is callable
      const loggerMethod = logger[level] as (message: string, ...args: unknown[]) => void;
      loggerMethod(sanitizedMessageStr, sanitizeForLogging(data));
    } else {
      // Type-safe assertion that the logger method exists and is callable
      const loggerMethod = logger[level] as (message: string, ...args: unknown[]) => void;
      loggerMethod(sanitizedMessageStr);
    }
  };
}

/**
 * Safe logger that automatically sanitizes sensitive data
 */
export const secureLogger = {
  debug: createLoggerMethod('debug'),
  info: createLoggerMethod('info'),
  warn: createLoggerMethod('warn'),
  error: createLoggerMethod('error'),
};

/**
 * Utility function to redact OAuth server details from lists
 */
export function sanitizeOAuthServerList(servers: string[]): string[] {
  return servers.map((server) => {
    // Only show server name without any sensitive configuration
    const serverName = server.split('|')[0] || server; // Extract just the name part
    return serverName.replace(/[?&](client_id|client_secret|token|code)=[^&]*/gi, '[OAUTH_REDACTED]');
  });
}

/**
 * Utility function to create safe error messages that don't expose sensitive data
 */
export function createSafeErrorMessage(error: string): string {
  const sanitizedError = sanitize(error);
  const errorString = typeof sanitizedError === 'string' ? sanitizedError : String(sanitizedError);

  return errorString
    .replace(/HTTP \d+.*$/gi, 'HTTP [STATUS_CODE]') // Remove potentially sensitive HTTP response details
    .replace(/server.*responding/gi, 'server connectivity issue'); // Generic server error
}
