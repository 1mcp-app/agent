/**
 * Application constants
 */

import { ClientCapabilities, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

// Server configuration
export const PORT = 3050;
export const HOST = '127.0.0.1';

// API endpoints
export const SSE_ENDPOINT = '/sse';
export const MESSAGES_ENDPOINT = '/messages';
export const STREAMABLE_HTTP_ENDPOINT = '/mcp';

// Error codes
export const ERROR_CODES = {
  INTERNAL_SERVER_ERROR: -32000,
  TRANSPORT_NOT_FOUND: -32001,
  INVALID_PARAMS: -32602,
  CLIENT_CONNECTION_ERROR: -32003,
  RESOURCE_NOT_FOUND: -32004,
  TOOL_NOT_FOUND: -32005,
  PROMPT_NOT_FOUND: -32006,
  OPERATION_TIMEOUT: -32007,
  BACKEND_ERROR: -32008,
  CAPABILITY_NOT_SUPPORTED: -32009,
};

// MCP constants
export const MCP_CONFIG_FILE = 'mcp.json';
export const MCP_SERVER_NAME = '1mcp';
export const MCP_SERVER_VERSION = '0.8.2';

export const MCP_URI_SEPARATOR = '_1mcp_';

// Global config paths
export const CONFIG_DIR_NAME = '1mcp';
export const DEFAULT_CONFIG = {
  mcpServers: {},
};

/**
 * Get the global config directory path based on OS
 */
export function getGlobalConfigDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error('Could not determine home directory');
  }

  const configDir =
    process.platform === 'darwin' || process.platform === 'linux'
      ? `${homeDir}/.config/${CONFIG_DIR_NAME}`
      : `${homeDir}/AppData/Roaming/${CONFIG_DIR_NAME}`;

  return configDir;
}

/**
 * Get the global config file path
 */
export function getGlobalConfigPath(): string {
  return `${getGlobalConfigDir()}/${MCP_CONFIG_FILE}`;
}

// Connection retry settings
export const CONNECTION_RETRY = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000,
};

export const MCP_SERVER_CAPABILITIES: ServerCapabilities = {
  logging: {},
  resources: {
    listChanged: false,
  },
  tools: {
    listChanged: false,
  },
  prompts: {
    listChanged: false,
  },
};

export const MCP_CLIENT_CAPABILITIES: ClientCapabilities = {
  roots: {
    listChanged: false,
  },
  sampling: {
    listChanged: false,
  },
};
