export const CLIENT_SERVER_STATUSES = [
  'pending',
  'loading',
  'initializing',
  'connected',
  'failed',
  'awaiting_oauth',
  'cancelled',
  'disconnected',
  'error',
  'unknown',
] as const;

export type ClientServerStatus = (typeof CLIENT_SERVER_STATUSES)[number];
