import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { unwrapBackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import type { BackendSupervisionSnapshot } from '@src/core/server/backendStdioSupervisor.js';
import type { ClientStatus, OutboundConnection, OutboundErrorSnapshot } from '@src/core/types/client.js';
import { type JsonObject, toJsonValue } from '@src/sdk/contracts/index.js';
import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { LegacyGatewayClientAdapter } from './legacyGatewayClientAdapter.js';
import {
  bindLegacySdkConnection,
  getLegacySdkClient,
  getLegacySdkTransport,
  type LegacySdkClientAdapterOptions,
  setLegacySdkTransport,
} from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';
import {
  getModernSdkClient,
  getModernSdkTransport,
  ModernSdkClientAdapter,
  setModernSdkTransport,
} from './modernSdkClientAdapter.js';
import { isModernSdkClient, type OutboundSdkClient } from './sdkClient.js';

/** Live legacy values. This type must not be imported outside src/sdk/legacy/**. */
export type LegacyOutboundConnection = OutboundConnection;

export type LegacyOutboundConnections = Map<string, LegacyOutboundConnection>;

interface CreateLegacyOutboundConnectionOptions {
  readonly name: string;
  readonly client: OutboundSdkClient;
  readonly transport: AuthProviderTransport;
  readonly status: ClientStatus;
  readonly lastError?: unknown;
  readonly lastConnected?: Date;
  readonly capabilities?: unknown;
  readonly instructions?: string;
  readonly authorizationUrl?: string;
  readonly oauthStartTime?: Date;
  readonly supervision?: BackendSupervisionSnapshot;
  readonly adapterOptions?: LegacySdkClientAdapterOptions;
}

export function snapshotError(error: unknown): OutboundErrorSnapshot {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
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
  const adapter: LegacySdkAdapter = isModernSdkClient(options.client)
    ? new ModernSdkClientAdapter(options.client, options.transport)
    : new LegacyGatewayClientAdapter(options.client, options.transport, options.adapterOptions);
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
  if (!(adapter instanceof ModernSdkClientAdapter)) bindLegacySdkConnection(adapter, connection);
  return connection;
}

export function getLegacyClient(connection: LegacyOutboundConnection): OutboundSdkClient {
  const adapter = unwrapBackendSleepAdapter(connection.adapter);
  return adapter instanceof ModernSdkClientAdapter ? getModernSdkClient(adapter) : getLegacySdkClient(adapter);
}

export function getLegacyTransport(connection: LegacyOutboundConnection): AuthProviderTransport {
  const adapter = unwrapBackendSleepAdapter(connection.adapter);
  return adapter instanceof ModernSdkClientAdapter ? getModernSdkTransport(adapter) : getLegacySdkTransport(adapter);
}

export function setLegacyTransport(connection: LegacyOutboundConnection, transport: AuthProviderTransport): void {
  const adapter = unwrapBackendSleepAdapter(connection.adapter);
  if (adapter instanceof ModernSdkClientAdapter) setModernSdkTransport(adapter, transport);
  else setLegacySdkTransport(adapter, transport);
  connection.tags = [...(transport.tags ?? [])];
  connection.requestTimeoutMs = transport.requestTimeout ?? transport.timeout;
  connection.requiresOAuth = Boolean(transport.oauthProvider);
}

export function setOutboundRequestHandler(
  connection: LegacyOutboundConnection,
  schema: unknown,
  handler: (request: never) => unknown,
): void {
  const adapter = unwrapBackendSleepAdapter(connection.adapter);
  if (adapter instanceof ModernSdkClientAdapter) {
    adapter.registerRequestHandler(schema, handler);
    return;
  }
  getLegacySdkClient(adapter).setRequestHandler(schema as never, handler as never);
}

export function setOutboundNotificationHandler(
  connection: LegacyOutboundConnection,
  schema: unknown,
  handler: (notification: { method: string; params?: Record<string, unknown> }) => unknown,
): void {
  const adapter = unwrapBackendSleepAdapter(connection.adapter);
  if (adapter instanceof ModernSdkClientAdapter) {
    adapter.registerNotificationHandler(schema, handler);
    return;
  }
  getLegacySdkClient(adapter).setNotificationHandler(schema as never, handler as never);
}

export function requestLegacyOutbound<T>(
  connection: LegacyOutboundConnection,
  method: string,
  params?: unknown,
): Promise<T> {
  const transport = getLegacyTransport(connection);
  return requestLegacyAdapter<T>(connection.adapter, method, params === undefined ? undefined : toJsonValue(params), {
    timeoutMs: connection.requestTimeoutMs ?? transport.requestTimeout ?? transport.timeout,
  });
}
