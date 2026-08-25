import logger from './logger.js';

/**
 * Patterns matching value-bearing credentials (used for both values and object keys)
 */
const KEY_SENSITIVE_PATTERNS = [
  // PEM Private Key blocks (CWE-532, matches full block or unterminated block through string boundary)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/gi,

  // Bearer tokens in Authorization headers (MUST run before generic key-value to avoid splitting "Token: bearer <token>")
  /bearer\s+[a-zA-Z0-9_\-.~+/]+=*/gi,

  // Basic authentication credentials (Authorization: Basic <base64>)
  /basic\s+[a-zA-Z0-9+/=]{8,}/gi,

  // JWT tokens (Header.Payload.Signature)
  /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/gi,

  // Key-value credential assignments (supports unquoted and quoted values, including embedded whitespace, escaped quotes, and unterminated quotes through string/line boundaries)
  /(?:[?&]|\b)(?:[tT]oken|[cC]ode|[sS]ecret|client_secret|client_id|[pP]assword|[pP]asswd|api[_-]?key|auth[_-]?token|access_token|refresh_token|private[_-]?key)\s*[:=]\s*(?:"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|[^\s,;&]+)/gi,

  // URLs with sensitive parameters (consolidates 4 patterns)
  /https?:\/\/[^\s]*[?&](?:[tT]oken|[cC]ode|[sS]ecret|[kK]ey)=[^\s&]*/gi,

  // Query parameters with sensitive data (consolidates 2 patterns)
  /[?&](?:[tT]oken|[cC]ode|[sS]ecret|[kK]ey)=[^\s&]*/gi,
];

/**
 * Consolidated patterns for sensitive data detection in string values
 */
const SENSITIVE_PATTERNS = [
  ...KEY_SENSITIVE_PATTERNS,

  // OAuth tokens and credentials (consolidates 6 patterns)
  /(?:access_token|refresh_token|authorization_code|client_secret|client_id)/gi,

  // OAuth configuration patterns (consolidates 4 patterns)
  /(?:scopes?|redirect_uris?|with\s+scope):\s*(?:\[[^\]]*\]|[^\s,}]+(?:\s+[^\s]+)*)/gi,

  // Generic secret patterns (consolidates 5 patterns) - fallback keywords
  /(?:api[_-]?key|secret|password|passwd|auth[_-]?token|private[_-]?key)/gi,
];

/**
 * Base patterns for sensitive key detection (case-insensitive)
 */
const SENSITIVE_KEY_PATTERNS = ['secret', 'token', 'password', 'passwd', 'key'];

/**
 * C0 + C1 control characters + DEL + Unicode Line/Paragraph Separators + Bidi overrides (CWE-117, CWE-150, Trojan Source CVE-2021-42574).
 * Covers \x00-\x1F (C0), \x7F (DEL), \x80-\x9F (C1 including 8-bit CSI \x9B),
 * \u2028/\u2029 (Unicode line/paragraph separators), \u202A-\u202E/\u2066-\u2069 (Bidi overrides),
 * and \u200B-\u200D/\uFEFF (Zero-width formatting characters).
 * Single character class — linear time, no nested quantifiers, no ReDoS risk.
 */
// eslint-disable-next-line no-control-regex -- intentional: this IS the sanitization pattern
const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F-\x9F\u200B-\u200D\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

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
    const code = char.charCodeAt(0);
    if (code <= 0xff) {
      return `\\x${code.toString(16).padStart(2, '0').toUpperCase()}`;
    }
    return `\\u${code.toString(16).padStart(4, '0').toUpperCase()}`;
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
 * Sanitize an object key: redacts credential patterns and escapes control characters.
 */
function sanitizeKey(key: string): string {
  let redactedKey = key;
  for (const pattern of KEY_SENSITIVE_PATTERNS) {
    redactedKey = redactedKey.replace(pattern, '[REDACTED]');
  }
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

  if (typeof value === 'bigint') {
    return `${value.toString()}n`;
  }

  if (typeof value === 'symbol') {
    return sanitizeString(value.toString());
  }

  if (typeof value === 'function') {
    return '[Function]';
  }

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }

  if (value instanceof RegExp) {
    return sanitizeString(value.toString());
  }

  if (value instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name:
        typeof value.name === 'string'
          ? (sanitize(value.name, depth + 1) as string)
          : sanitizeString(String(value.name)),
      message: sanitize(value.message, depth + 1),
    };
    if (value.stack) {
      sanitizedError.stack = sanitize(value.stack, depth + 1);
    }
    if ('cause' in value && value.cause !== undefined) {
      sanitizedError.cause = sanitize(value.cause, depth + 1);
    }
    for (const [key, val] of Object.entries(value)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause' || key === '__proto__') {
        continue;
      }
      const sanitizedKey = sanitizeKey(key);
      if (isSensitiveKey(key)) {
        sanitizedError[sanitizedKey] = '[REDACTED]';
      } else {
        sanitizedError[sanitizedKey] = sanitize(val, depth + 1);
      }
    }
    return sanitizedError;
  }

  if (value instanceof Set) {
    return Array.from(value).map((item) => sanitize(item, depth + 1));
  }

  if (value instanceof Map) {
    const mapObj: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const stringKey = typeof k === 'string' ? k : String(k);
      if (stringKey === '__proto__') {
        continue;
      }
      const sanitizedKey = sanitizeKey(stringKey);
      if (isSensitiveKey(stringKey)) {
        mapObj[sanitizedKey] = '[REDACTED]';
      } else {
        mapObj[sanitizedKey] = sanitize(v, depth + 1);
      }
    }
    return mapObj;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    const sanitized: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(value)) {
      if (key === '__proto__') {
        continue;
      }
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
  } catch {
    // Log safe static marker to stderr without exposing dynamic error.message (preventing throwing getter bypasses)
    console.error('Sanitization error occurred');
    return '[SANITIZATION_ERROR]';
  }
}

/**
 * Create a secure logger method for a specific log level
 */
function createLoggerMethod(level: 'debug' | 'info' | 'warn' | 'error') {
  return (message: string, data?: unknown) => {
    const sanitizedMessage = sanitizeForLogging(message);
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
  const sanitizedError = sanitizeForLogging(error);
  const errorString = typeof sanitizedError === 'string' ? sanitizedError : String(sanitizedError);

  return errorString
    .replace(/HTTP \d+.*$/gi, 'HTTP [STATUS_CODE]') // Remove potentially sensitive HTTP response details
    .replace(/server.*responding/gi, 'server connectivity issue'); // Generic server error
}
