/**
 * API and server configuration constants
 */

// Server configuration
export const PORT = 3050;
export const HOST = '127.0.0.1';

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
