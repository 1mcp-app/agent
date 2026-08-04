import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

import { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import type { BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';

import { EnhancedTransport } from './transport.js';

/**
 * Enum representing possible client connection states
 */
export enum ClientStatus {
  /** Client is successfully connected */
  Connected = 'connected',
  /** Client is disconnected */
  Disconnected = 'disconnected',
  /** Client encountered an error */
  Error = 'error',
  /** Client is waiting for OAuth authorization */
  AwaitingOAuth = 'awaiting_oauth',
  /** Supervised backend is waiting for or initializing a replacement. */
  Restarting = 'restarting',
  /** Supervised backend exhausted its consecutive restart budget. */
  CrashLoop = 'crash-loop',
}

/**
 * Transport that includes an OAuth provider
 */
export interface AuthProviderTransport extends EnhancedTransport {
  oauthProvider?: SDKOAuthClientProvider;
}

/**
 * Complete outbound connection information including transport, status and history
 */
export interface OutboundConnection {
  readonly name: string;
  transport: AuthProviderTransport;
  client: Client;
  lastError?: Error;
  lastConnected?: Date;
  status: ClientStatus;
  capabilities?: ServerCapabilities;
  /** Instructions provided by the server during initialization */
  instructions?: string;
  /** OAuth authorization URL for user to complete authentication */
  authorizationUrl?: string;
  /** When OAuth authorization was initiated */
  oauthStartTime?: Date;
  /** Runtime-owned stdio supervision facts, when enabled for this backend. */
  supervision?: BackendSupervisionSnapshot;
}

/**
 * Map of outbound connections indexed by connection name
 */
export type OutboundConnections = Map<string, OutboundConnection>;

/**
 * Options for client operations
 */
export interface OperationOptions {
  readonly retryCount?: number;
  readonly retryDelay?: number;
}
