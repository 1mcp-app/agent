import logger from './logger.js';

/**
 * Consolidated patterns for sensitive data detection
 */
const SENSITIVE_PATTERNS = [
  // Bearer tokens in Authorization headers (MUST run before generic key-value to avoid splitting "Token: bearer <token>")
  /bearer\s+[a-zA-Z0-9_\-.~+/]+=*/gi,

  // Key-value credential assignments (e.g., token=xyz, password=xyz, client_secret=xyz)
  // MUST run before generic keyword replacement so values are redacted before keys are masked
  /(?:[?&]|\b)(?:[tT]oken|[cC]ode|[sS]ecret|client_secret|client_id|[pP]assword|[pP]asswd|api[_-]?key|auth[_-]?token|access_token|refresh_token)\s*[:=]\s*[^\s,;&]+/gi,

  // URLs with sensitive parameters (consolidates 4 patterns)
  /https?:\/\/[^\s]*[?&](?:[tT]oken|[cC]ode|[sS]ecret|[kK]ey)=[^\s&]*/gi,

  // Query parameters with sensitive data (consolidates 2 patterns)
  /[?&](?:[tT]oken|[cC]ode|[sS]ecret|[kK]ey)=[^\s&]*/gi,

  // OAuth tokens and credentials (consolidates 6 patterns)
  /(?:access_token|refresh_token|authorization_code|client_secret|client_id)/gi,

  // OAuth configuration patterns (consolidates 4 patterns)
  /(?:scopes?|redirect_uris?|with\s+scope):\s*(?:\[[^\]]*\]|[^\s,}]+(?:\s+[^\s]+)*)/gi,

  // Generic secret patterns (consolidates 5 patterns) - fallback keywords
  /(?:api[_-]?key|secret|password|passwd|auth[_-]?token)/gi,
];

/**
 * Base patterns for sensitive key detection (case-insensitive)
 */
const SENSITIVE_KEY_PATTERNS = ['secret', 'token', 'password', 'passwd', 'key'];

/**
 * C0 + C1 control characters + DEL (CWE-117 log forging & CWE-150 ANSI injection defense).
 * Covers \x00-\x1F (C0), \x7F (DEL), and \x80-\x9F (C1 including 8-bit CSI \x9B).
 * Single character class — linear time, no nested quantifiers, no ReDoS risk.
 */
// eslint-disable-next-line no-control-regex -- intentional: this IS the sanitization pattern
const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F-\x9F]/g;

/**
 * Escape control characters as visible literals (log4j2 %encode{}{CRLF} /
 * Veracode CWE-117 guidance style) so attacker-controlled input cannot forge
 * log lines or inject ANSI escape sequences, while preserving audit intent.
 */
function escapeControlChars(value: string): string {
  return value.replace(CONTROL_CHARS_PATTERN, (char) => {
    if (char === '\n') return '\\n';
    if (char === '\r') return '\\r';
    if (char === '\t') return '\\t';
    return `\\x${char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`;
  });
}

/**
 * Sanitize a string by applying pattern redaction followed by control character escaping.
 */
function sanitizeString(value: string): string {
  let sanitized = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return escapeControlChars(sanitized);
}

/**
 * Sanitize an object key: escapes control characters and redacts any inline credential assignments.
 */
function sanitizeKey(key: string): string {
  const redactedKey = key.replace(
    /(?:[?&]|\b)(?:[tT]oken|[cC]ode|[sS]ecret|client_secret|client_id|[pP]assword|[pP]asswd|api[_-]?key|auth[_-]?token|access_token|refresh_token)\s*[:=]\s*[^\s,;&]+/gi,
    '[REDACTED]',
  );
  return escapeControlChars(redactedKey);
}

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
    return sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name:
        typeof value.name === 'string'
          ? (sanitize(value.name, depth + 1) as string)
          : escapeControlChars(String(value.name)),
      message: sanitize(value.message, depth + 1),
    };
    if (value.stack) {
      sanitizedError.stack = sanitize(value.stack, depth + 1);
    }
    for (const [key, val] of Object.entries(value)) {
      const sanitizedKey = sanitizeKey(key);
      if (isSensitiveKey(key)) {
        sanitizedError[sanitizedKey] = '[REDACTED]';
      } else {
        sanitizedError[sanitizedKey] = sanitize(val, depth + 1);
      }
    }
    return sanitizedError;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      const sanitizedKey = sanitizeKey(key);
      if (isSensitiveKey(key)) {
        sanitized[sanitizedKey] = '[REDACTED]';
      } else {
        sanitized[sanitizedKey] = sanitize(val, depth + 1);
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
    const redacted = serverName.replace(/[?&](client_id|client_secret|token|code)=[^&]*/gi, '[OAUTH_REDACTED]');
    return escapeControlChars(redacted);
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
