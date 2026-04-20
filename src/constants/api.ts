/**
 * API and server configuration constants
 */

// Server configuration
export const PORT = 3050;
export const HOST = '127.0.0.1';

// API versioning
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;
export const API_INSPECT_ENDPOINT = `${API_BASE_PATH}/inspect`;
export const API_SERVERS_ENDPOINT = `${API_BASE_PATH}/servers`;
export const API_TOOLS_ENDPOINT = `${API_BASE_PATH}/tools`;
export const API_TOOL_INVOCATIONS_ENDPOINT = `${API_BASE_PATH}/tool-invocations`;

// API endpoints
export const SSE_ENDPOINT = '/sse';
export const MESSAGES_ENDPOINT = '/messages';
export const STREAMABLE_HTTP_ENDPOINT = '/mcp';
export const HEALTH_ENDPOINT = '/health';

// Connection retry settings
export const CONNECTION_RETRY = {
  MAX_ATTEMPTS: 3,
  INITIAL_DELAY_MS: 1000,
};
