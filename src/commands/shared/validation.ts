import { MCPServerParams } from '@src/core/types/index.js';

/**
 * Validation utilities for server command inputs
 */

/**
 * Validate server name format
 */
export function validateServerName(name: string): void {
  if (!name || name.trim().length === 0) {
    throw new Error('Server name cannot be empty');
  }

  const trimmedName = name.trim();

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedName)) {
    throw new Error('Server name can only contain letters, numbers, hyphens, and underscores');
  }

  // Check length
  if (trimmedName.length > 50) {
    throw new Error('Server name must be 50 characters or less');
  }

  // Reserved names
  const reservedNames = ['1mcp', 'proxy', 'server', 'client', 'config'];
  if (reservedNames.includes(trimmedName.toLowerCase())) {
    throw new Error(`Server name '${trimmedName}' is reserved and cannot be used`);
  }
}

/**
 * Validate command line arguments for different server types
 */
export function validateServerArgs(type: string, args: any): void {
  switch (type) {
    case 'stdio':
      validateStdioArgs(args);
      break;
    case 'http':
    case 'sse':
      validateHttpArgs(args);
      break;
    default:
      throw new Error(`Unsupported server type: ${type}`);
  }
}

/**
 * Validate stdio server arguments
 */
function validateStdioArgs(args: any): void {
  if (!args.command) {
    throw new Error('Command is required for stdio servers');
  }

  if (typeof args.command !== 'string' || args.command.trim().length === 0) {
    throw new Error('Command must be a non-empty string');
  }

  // Validate args array if provided
  if (args.args !== undefined) {
    if (!Array.isArray(args.args)) {
      throw new Error('Command arguments must be an array');
    }

    for (const arg of args.args) {
      if (typeof arg !== 'string') {
        throw new Error('All command arguments must be strings');
      }
    }
  }

  // Validate cwd if provided
  if (args.cwd !== undefined) {
    if (typeof args.cwd !== 'string' || args.cwd.trim().length === 0) {
      throw new Error('Working directory must be a non-empty string');
    }
  }
}

/**
 * Validate HTTP/SSE server arguments
 */
function validateHttpArgs(args: any): void {
  if (!args.url) {
    throw new Error(`URL is required for ${args.type} servers`);
  }

  if (typeof args.url !== 'string') {
    throw new Error('URL must be a string');
  }

  try {
    const url = new URL(args.url);

    // Check protocol
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('URL must use HTTP or HTTPS protocol');
    }
  } catch (_error) {
    throw new Error(`Invalid URL format: ${args.url}`);
  }
}

/**
 * Validate environment variables
 */
export function validateEnvVars(envArray?: string[]): void {
  if (!envArray) return;

  if (!Array.isArray(envArray)) {
    throw new Error('Environment variables must be an array');
  }

  const seenKeys = new Set<string>();

  for (const envVar of envArray) {
    if (typeof envVar !== 'string') {
      throw new Error('Environment variable must be a string');
    }

    const equalIndex = envVar.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid environment variable format: ${envVar}. Expected key=value`);
    }

    const key = envVar.substring(0, equalIndex).trim();

    if (!key) {
      throw new Error(`Invalid environment variable format: ${envVar}. Key cannot be empty`);
    }

    // Check for valid environment variable name
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(
        `Invalid environment variable name: ${key}. Must start with letter or underscore, and contain only letters, numbers, and underscores`,
      );
    }

    // Check for duplicates
    if (seenKeys.has(key)) {
      throw new Error(`Duplicate environment variable: ${key}`);
    }
    seenKeys.add(key);
  }
}

/**
 * Validate headers
 */
export function validateHeaders(headersArray?: string[]): void {
  if (!headersArray) return;

  if (!Array.isArray(headersArray)) {
    throw new Error('Headers must be an array');
  }

  const seenKeys = new Set<string>();

  for (const header of headersArray) {
    if (typeof header !== 'string') {
      throw new Error('Header must be a string');
    }

    const equalIndex = header.indexOf('=');
    if (equalIndex === -1) {
      throw new Error(`Invalid header format: ${header}. Expected key=value`);
    }

    const key = header.substring(0, equalIndex).trim();

    if (!key) {
      throw new Error(`Invalid header format: ${header}. Key cannot be empty`);
    }

    // Check for valid HTTP header name
    if (!/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(key)) {
      throw new Error(`Invalid HTTP header name: ${key}`);
    }

    // Check for duplicates
    const lowerKey = key.toLowerCase();
    if (seenKeys.has(lowerKey)) {
      throw new Error(`Duplicate header: ${key}`);
    }
    seenKeys.add(lowerKey);
  }
}

/**
 * Validate tags
 */
export function validateTags(tagsString?: string): void {
  if (!tagsString) return;

  if (typeof tagsString !== 'string') {
    throw new Error('Tags must be a string');
  }

  const tags = tagsString
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

  if (tags.length === 0) {
    throw new Error('At least one tag must be provided when using --tags');
  }

  const seenTags = new Set<string>();

  for (const tag of tags) {
    // Check for valid tag format
    if (!/^[a-zA-Z0-9_-]+$/.test(tag)) {
      throw new Error(`Invalid tag format: ${tag}. Tags can only contain letters, numbers, hyphens, and underscores`);
    }

    // Check length
    if (tag.length > 20) {
      throw new Error(`Tag too long: ${tag}. Tags must be 20 characters or less`);
    }

    // Check for duplicates
    if (seenTags.has(tag.toLowerCase())) {
      throw new Error(`Duplicate tag: ${tag}`);
    }
    seenTags.add(tag.toLowerCase());
  }
}

/**
 * Validate timeout value
 */
export function validateTimeout(timeout?: number): void {
  if (timeout === undefined) return;

  if (typeof timeout !== 'number') {
    throw new Error('Timeout must be a number');
  }

  if (timeout < 0) {
    throw new Error('Timeout must be a positive number');
  }

  if (timeout > 300000) {
    // 5 minutes
    throw new Error('Timeout cannot exceed 300000 milliseconds (5 minutes)');
  }
}

/**
 * Validate complete server configuration
 */
export function validateCompleteServerConfig(name: string, config: MCPServerParams): void {
  validateServerName(name);

  // Use existing validation from configUtils
  if (!config.type) {
    throw new Error('Server type is required');
  }

  validateServerArgs(config.type, config);

  if (config.env) {
    // Convert env object back to array format for validation
    const envArray = Object.entries(config.env).map(([key, value]) => `${key}=${value}`);
    validateEnvVars(envArray);
  }

  if (config.headers) {
    // Convert headers object back to array format for validation
    const headersArray = Object.entries(config.headers).map(([key, value]) => `${key}=${value}`);
    validateHeaders(headersArray);
  }

  if (config.tags) {
    // Convert tags array back to string format for validation
    const tagsString = config.tags.join(',');
    validateTags(tagsString);
  }

  validateTimeout(config.timeout);
}
