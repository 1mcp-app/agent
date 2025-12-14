import { getAllServers } from '@src/commands/mcp/utils/mcpServerConfig.js';
import { MCPServerParams } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { validateServer1mcpUrl } from '@src/utils/validation/urlDetection.js';

import { ValidationResult } from './types.js';

/**
 * Validate server configuration
 */
export async function validateServerConfig(
  serverName: string,
  config: Partial<MCPServerParams & { newName?: string }>,
): Promise<ValidationResult> {
  debugIf(() => ({
    message: 'Adapter: Validating server config',
    meta: { serverName, config },
  }));

  try {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Get all servers for duplicate name checking
    const allServers = getAllServers();

    // Name validation (for server renaming)
    if (config.newName !== undefined) {
      const newName = config.newName;
      if (!newName || newName.trim().length === 0) {
        errors.push('Server name cannot be empty');
      } else if (newName !== serverName && allServers[newName]) {
        errors.push(`Server name '${newName}' already exists`);
      } else if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
        errors.push('Server name can only contain letters, numbers, hyphens, and underscores');
      } else if (newName.length > 100) {
        errors.push('Server name cannot exceed 100 characters');
      }
    }

    // Timeout validation
    const timeoutFields = ['timeout', 'connectionTimeout', 'requestTimeout'];
    for (const field of timeoutFields) {
      if (field in config && config[field as keyof typeof config] !== undefined) {
        const value = config[field as keyof typeof config] as number;
        if (typeof value !== 'number' || value < 0) {
          errors.push(`${field} must be a positive number`);
        } else if (value > 300000) {
          // 5 minutes
          warnings.push(`${field} value (${value}ms) is very high and may cause issues`);
        }
      }
    }

    // Basic transport validation
    if (!config.command && !config.url) {
      errors.push('Server must have either a command or URL');
    }

    if (config.url !== undefined) {
      if (!config.url) {
        errors.push('URL cannot be empty');
      } else {
        try {
          new URL(config.url); // Basic URL validation
          const urlValidation = await validateServer1mcpUrl(config.url);
          if (!urlValidation.valid) {
            errors.push(`Invalid URL: ${urlValidation.error}`);
          }
        } catch {
          errors.push('Invalid URL format');
        }
      }
    }

    // Command and arguments validation
    if (config.command !== undefined) {
      if (!config.command) {
        errors.push('Command cannot be empty');
      } else if (config.command.length > 1000) {
        errors.push('Command cannot exceed 1000 characters');
      }
    }

    if (config.args !== undefined) {
      if (!Array.isArray(config.args)) {
        errors.push('Arguments must be an array');
      } else if (config.args.some((arg) => typeof arg !== 'string')) {
        errors.push('All arguments must be strings');
      }
    }

    // Working directory validation
    if (config.cwd !== undefined) {
      if (config.cwd && !config.cwd.startsWith('/')) {
        warnings.push('Working directory should be an absolute path');
      }
    }

    // Environment variables validation
    if (config.env !== undefined) {
      if (typeof config.env !== 'object' || config.env === null) {
        errors.push('Environment variables must be an object');
      } else {
        const envArray = Array.isArray(config.env);
        const envObject = typeof config.env === 'object' && !envArray;

        if (envArray) {
          errors.push('Environment variables array format is not supported - use object format');
        } else if (envObject) {
          const env = config.env as Record<string, string>;
          for (const [key, value] of Object.entries(env)) {
            if (!key || typeof key !== 'string') {
              errors.push('Environment variable keys must be non-empty strings');
            } else if (typeof value !== 'string') {
              errors.push(`Environment variable ${key} must be a string`);
            }
          }
        }
      }
    }

    // Restart parameters validation
    const restartFields = ['maxRestarts', 'restartDelay'];
    for (const field of restartFields) {
      if (field in config && config[field as keyof typeof config] !== undefined) {
        const value = config[field as keyof typeof config] as number;
        if (typeof value !== 'number' || value < 0) {
          errors.push(`${field} must be a non-negative number`);
        }
      }
    }

    // Tags validation
    if (config.tags !== undefined) {
      if (!Array.isArray(config.tags)) {
        errors.push('Tags must be an array');
      } else if (config.tags.some((tag) => typeof tag !== 'string')) {
        errors.push('All tags must be strings');
      } else {
        const invalidTags = config.tags.filter((tag) => !tag || tag.length > 50 || !/^[a-zA-Z0-9_-]+$/.test(tag));
        if (invalidTags.length > 0) {
          errors.push(`Invalid tags: ${invalidTags.join(', ')}`);
        }
      }
    }

    // Headers validation
    if (config.headers !== undefined) {
      if (typeof config.headers !== 'object' || config.headers === null || Array.isArray(config.headers)) {
        errors.push('Headers must be an object');
      } else {
        for (const [key, value] of Object.entries(config.headers)) {
          if (!key || typeof key !== 'string') {
            errors.push('Header keys must be non-empty strings');
          } else if (typeof value !== 'string') {
            errors.push(`Header ${key} must be a string`);
          }
        }
      }
    }

    // OAuth validation
    if (config.oauth !== undefined) {
      if (typeof config.oauth !== 'object' || config.oauth === null || Array.isArray(config.oauth)) {
        errors.push('OAuth configuration must be an object');
      } else {
        const oauth = config.oauth;
        if (oauth.clientId !== undefined && typeof oauth.clientId !== 'string') {
          errors.push('OAuth client ID must be a string');
        }
        if (oauth.clientSecret !== undefined && typeof oauth.clientSecret !== 'string') {
          errors.push('OAuth client secret must be a string');
        }
        if (oauth.scopes !== undefined) {
          if (!Array.isArray(oauth.scopes) || oauth.scopes.some((scope) => typeof scope !== 'string')) {
            errors.push('OAuth scopes must be an array of strings');
          }
        }
      }
    }

    // Warnings and suggestions
    if (config.command && config.url) {
      warnings.push('Both command and URL specified - URL will take precedence');
    }

    if (config.command && !config.url && config.url === undefined) {
      suggestions.push('Consider using URL-based transport for better compatibility');
    }

    if (config.timeout !== undefined) {
      warnings.push('Using deprecated timeout field - consider using connectionTimeout and requestTimeout instead');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Server config validation failed', { error: errorMessage, serverName });
    return {
      valid: false,
      errors: [errorMessage],
      warnings: [],
    };
  }
}
