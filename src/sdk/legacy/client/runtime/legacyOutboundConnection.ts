import type { Client } from '@src/sdk/legacy/client/index.js';

import type { BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
import type { ClientStatus, OutboundConnection, OutboundErrorSnapshot } from '@src/core/types/client.js';
import { type JsonObject, toJsonValue } from '@src/sdk/contracts/index.js';

import {
  bindLegacySdkConnection,
  getLegacySdkClient,
  getLegacySdkTransport,
  LegacySdkClientAdapter,
  setLegacySdkTransport,
} from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';

/** Live legacy values. This type must not be imported outside src/sdk/legacy/**. */
export type LegacyOutboundConnection = OutboundConnection;

export type LegacyOutboundConnections = Map<string, LegacyOutboundConnection>;

interface CreateLegacyOutboundConnectionOptions {
  readonly name: string;
  readonly client: Client;
  readonly transport: AuthProviderTransport;
  readonly status: ClientStatus;
  readonly lastError?: unknown;
  readonly lastConnected?: Date;
  readonly capabilities?: unknown;
  readonly instructions?: string;
  readonly authorizationUrl?: string;
  readonly oauthStartTime?: Date;
  readonly supervision?: BackendSupervisionSnapshot;
}

export function snapshotError(error: unknown): OutboundErrorSnapshot {
  return error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) };
}

export function snapshotSupervision(snapshot: BackendSupervisionSnapshot) {
  return {
    backendId: snapshot.backendId,
    state: snapshot.state,
    attempt: snapshot.attempt,
    limit: snapshot.limit,
    nextRetryAt: snapshot.nextRetryAt?.toISOString() ?? null,
    lastExit: snapshot.lastExit ? { ...snapshot.lastExit, at: snapshot.lastExit.at.toISOString() } : null,
    lastError: snapshot.lastError ? snapshotError(snapshot.lastError) : null,
    currentPid: snapshot.currentPid,
  };
}

function snapshotCapabilities(capabilities: unknown): JsonObject {
  const snapshot = toJsonValue(capabilities);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== 'object') {
    throw new TypeError('Legacy server capabilities must be a JSON object');
  }
  return snapshot;
}

export function createLegacyOutboundConnection(
  options: CreateLegacyOutboundConnectionOptions,
): LegacyOutboundConnection {
  const adapter = new LegacySdkClientAdapter(options.client, options.transport);
  const connection: LegacyOutboundConnection = {
    name: options.name,
    adapter,
    status: options.status,
    tags: [...(options.transport.tags ?? [])],
    requestTimeoutMs: options.transport.requestTimeout ?? options.transport.timeout,
    requiresOAuth: Boolean(options.transport.oauthProvider),
    ...(options.lastError === undefined ? {} : { lastError: snapshotError(options.lastError) }),
    ...(options.lastConnected === undefined ? {} : { lastConnected: options.lastConnected.toISOString() }),
    ...(options.capabilities === undefined ? {} : { capabilities: snapshotCapabilities(options.capabilities) }),
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    ...(options.authorizationUrl === undefined ? {} : { authorizationUrl: options.authorizationUrl }),
    ...(options.oauthStartTime === undefined ? {} : { oauthStartTime: options.oauthStartTime.toISOString() }),
    ...(options.supervision === undefined ? {} : { supervision: snapshotSupervision(options.supervision) }),
  };
  bindLegacySdkConnection(adapter, connection);
  return connection;
}

export function getLegacyClient(connection: LegacyOutboundConnection): Client {
  const compatibilityClient = (connection as unknown as { client?: Client }).client;
  if (compatibilityClient) return compatibilityClient;
  return getLegacySdkClient(connection.adapter);
}

export function getLegacyTransport(connection: LegacyOutboundConnection): AuthProviderTransport {
  const compatibilityTransport = (connection as unknown as { transport?: AuthProviderTransport }).transport;
  if (compatibilityTransport) return compatibilityTransport;
  return getLegacySdkTransport(connection.adapter);
}

export function setLegacyTransport(
  connection: LegacyOutboundConnection,
  transport: AuthProviderTransport,
): void {
  setLegacySdkTransport(connection.adapter, transport);
  connection.tags = [...(transport.tags ?? [])];
  connection.requestTimeoutMs = transport.requestTimeout ?? transport.timeout;
  connection.requiresOAuth = Boolean(transport.oauthProvider);
}
