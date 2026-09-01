import type { JsonObject, LegacySdkAdapter } from '@src/sdk/contracts/index.js';

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

/** Capability names exposed by downstream servers. */
export type ServerCapability = 'experimental' | 'logging' | 'prompts' | 'resources' | 'tools';

export interface OutboundErrorSnapshot {
  readonly name: string;
  readonly message: string;
}

export interface OutboundSupervisionSnapshot {
  readonly backendId: string;
  readonly state: 'connected' | 'restarting' | 'crash-loop' | 'stopped';
  readonly attempt: number;
  readonly limit: number | null;
  readonly nextRetryAt: string | null;
  readonly lastExit: {
    readonly code: number | null;
    readonly signal: string | null;
    readonly pid: number | null;
    readonly at: string;
  } | null;
  readonly lastError: OutboundErrorSnapshot | null;
  readonly currentPid: number | null;
}

/**
 * Complete outbound connection information including transport, status and history
 */
export interface OutboundConnection {
  readonly name: string;
  readonly adapter: LegacySdkAdapter;
  tags: string[];
  requestTimeoutMs?: number;
  lastError?: OutboundErrorSnapshot;
  lastConnected?: string;
  status: ClientStatus;
  capabilities?: JsonObject;
  /** Instructions provided by the server during initialization */
  instructions?: string;
  /** OAuth authorization URL for user to complete authentication */
  authorizationUrl?: string;
  /** When OAuth authorization was initiated */
  oauthStartTime?: string;
  requiresOAuth: boolean;
  /** Runtime-owned stdio supervision facts, when enabled for this backend. */
  supervision?: OutboundSupervisionSnapshot;
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
