/**
 * Application constants
 */

import os from 'os';
import { ClientCapabilities, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

// Server configuration
export const PORT = 3050;
export const HOST = '127.0.0.1';

// API endpoints
export const SSE_ENDPOINT = '/sse';
export const MESSAGES_ENDPOINT = '/messages';
export const STREAMABLE_HTTP_ENDPOINT = '/mcp';
export const HEALTH_ENDPOINT = '/health';

// MCP constants
export const MCP_CONFIG_FILE = 'mcp.json';
export const MCP_SERVER_NAME = '1mcp';
export const MCP_SERVER_VERSION = '0.21.0';

export const MCP_URI_SEPARATOR = '_1mcp_';

// Global config paths
export const CONFIG_DIR_NAME = '1mcp';
export const BACKUP_DIR_NAME = 'backups';
export const DEFAULT_CONFIG = {
  mcpServers: {},
};

/**
 * Get the global config directory path based on OS
 */
export function getGlobalConfigDir(): string {
  const homeDir = os.homedir();

  const configDir =
    process.platform === 'darwin' || process.platform === 'linux'
      ? `${homeDir}/.config/${CONFIG_DIR_NAME}`
      : `${homeDir}/AppData/Roaming/${CONFIG_DIR_NAME}`;

  return configDir;
}

/**
 * Get the config directory path with CLI option override support
 * Priority: CLI option (includes env var via yargs ONE_MCP prefix) -> Default global config dir
 */
export function getConfigDir(configDirOption?: string): string {
  if (configDirOption !== undefined) {
    return configDirOption;
  }

  return getGlobalConfigDir();
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return `${getGlobalConfigDir()}/${MCP_CONFIG_FILE}`;
}

/**
 * Get the global backup directory path
 */
export function getGlobalBackupDir(): string {
  return `${getGlobalConfigDir()}/${BACKUP_DIR_NAME}`;
}

/**
 * Get app-specific backup directory path
 */
export function getAppBackupDir(appName: string): string {
  return `${getGlobalBackupDir()}/${appName}`;
}

// Connection retry settings
export const CONNECTION_RETRY = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000,
};

// Authentication and session settings
export const AUTH_CONFIG = {
  // Server-side authentication
  SERVER: {
    DEFAULT_ENABLED: false,

    // File storage configuration
    STORAGE: {
      DIR: 'sessions',
      FILE_EXTENSION: '.json',
    },

    // Session management
    SESSION: {
      TTL_MINUTES: 24 * 60, // 24 hours
      ID_PREFIX: 'sess-',
      FILE_PREFIX: 'session_',
    },

    // OAuth authorization codes (permanent, for token exchange)
    AUTH_CODE: {
      TTL_MS: 60 * 1000, // 1 minute
      ID_PREFIX: 'code-',
      FILE_PREFIX: 'auth_code_',
    },

    // OAuth authorization requests (temporary, for consent flow)
    AUTH_REQUEST: {
      TTL_MS: 10 * 60 * 1000, // 10 minutes
      ID_PREFIX: 'code-', // Same as auth codes for compatibility
      FILE_PREFIX: 'auth_request_',
    },

    // OAuth tokens
    TOKEN: {
      TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
      ID_PREFIX: 'tk-',
    },

    // Client management
    CLIENT: {
      ID_PREFIX: 'client-',
    },
  },

  // Client-side authentication
  CLIENT: {
    OAUTH: {
      TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
      CODE_VERIFIER_TTL_MS: 10 * 60 * 1000, // 10 minutes
      STATE_TTL_MS: 10 * 60 * 1000, // 10 minutes
      DEFAULT_TOKEN_EXPIRY_SECONDS: 3600, // 1 hour
      DEFAULT_CALLBACK_PATH: '/oauth/callback',
      DEFAULT_SCOPES: [],
    },
    SESSION: {
      TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
      ID_PREFIX: 'oauth_',
      FILE_PREFIX: '',
    },
    PREFIXES: {
      CLIENT: 'cli_',
      TOKENS: 'tok_',
      VERIFIER: 'ver_',
      STATE: 'sta_',
    },
  },
};

// Rate limiting configuration for OAuth endpoints
export const RATE_LIMIT_CONFIG = {
  OAUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX: 100, // max requests per window per IP
    MESSAGE: { error: 'Too many requests, please try again later.' },
  },
};

export const MCP_SERVER_CAPABILITIES: ServerCapabilities = {
  completions: {},
  resources: {
    listChanged: true,
  },
  tools: {
    listChanged: true,
  },
  prompts: {
    listChanged: true,
  },
  logging: {},
};

export const MCP_CLIENT_CAPABILITIES: ClientCapabilities = {
  roots: {
    listChanged: false,
  },
  sampling: {
    listChanged: false,
  },
  elicitation: {
    listChanged: false,
  },
};
