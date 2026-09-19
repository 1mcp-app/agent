import { createHash } from 'node:crypto';

import { type InboundConnection, type OutboundConnection, ServerStatus } from '@src/core/types/index.js';
import { hasInteractionCapability } from '@src/gateway/interactions/interactionCapabilities.js';
import { InteractionOwner } from '@src/gateway/interactions/interactionOwner.js';
import { currentNativeInteractionRound } from '@src/gateway/interactions/interactionRoute.js';
import {
  validateInteractionRequest,
  validateInteractionResponse,
} from '@src/gateway/interactions/validateInteractionResponse.js';
import type { GatewayInteractionRequest } from '@src/gateway/ports/outboundEraAdapter.js';
import { withLegacyInteractionLease } from '@src/sdk/legacy/client/runtime/legacyInteractionLease.js';
import { setOutboundRequestHandler } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import {
  type ClientCapabilities,
  CreateMessageRequestSchema,
  CreateMessageResultSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  ListRootsRequestSchema,
  ListRootsResultSchema,
  McpError,
  PingRequestSchema,
  ServerNotification,
  ServerRequest,
} from '@src/sdk/legacy/types.js';

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
interface Scope {
  readonly inbound: InboundConnection;
  readonly adapter: OutboundConnection['adapter'];
  readonly extra: Extra;
  readonly callbacks: { pending: number };
  readonly abort: AbortController;
  readonly assertCurrent?: () => void;
}
const legacyOwners = new InteractionOwner();
const active = new WeakMap<OutboundConnection, Scope>();
const installed = new WeakMap<OutboundConnection, OutboundConnection['adapter']>();
const profiles = new WeakMap<OutboundConnection, ClientCapabilities>();
const notificationOwners = new WeakMap<OutboundConnection, Set<WeakRef<InboundConnection>>>();

export function registerLegacyNotificationOwner(connection: OutboundConnection, inbound: InboundConnection): void {
  if (inbound.requestOnly) return;
  let owners = notificationOwners.get(connection);
  if (!owners) notificationOwners.set(connection, (owners = new Set()));
  for (const ref of owners) {
    const owner = ref.deref();
    if (!owner || owner.status === ServerStatus.Disconnected) owners.delete(ref);
    else if (owner === inbound) return;
  }
  owners.add(new WeakRef(inbound));
}

export function unregisterLegacyNotificationOwner(
  connections: Iterable<OutboundConnection>,
  inbound: InboundConnection,
): void {
  for (const connection of connections) {
    const owners = notificationOwners.get(connection);
    if (!owners) continue;
    for (const ref of owners) if (!ref.deref() || ref.deref() === inbound) owners.delete(ref);
    if (!owners.size) notificationOwners.delete(connection);
  }
}

export function setRequestInteractionProfile(connection: OutboundConnection, capabilities: ClientCapabilities): void {
  profiles.set(connection, capabilities);
}

/** Legacy reverse requests have no portable parent id; reserve one operation before invoking it. */
export async function withRequestInteractionScope<T>(
  connection: OutboundConnection,
  inbound: InboundConnection,
  extra: Extra,
  operation: () => Promise<T>,
  sourceProviderId?: string,
  assertCurrent?: () => void,
): Promise<T> {
  if (active.has(connection)) throw new McpError(-32000, 'interaction_capacity_exceeded');
  if (extra.signal.aborted) throw new McpError(-32000, 'interaction_lost');
  const auth = extra.authInfo;
  if (auth && (typeof auth.clientId !== 'string' || !auth.clientId || typeof auth.token !== 'string' || !auth.token))
    throw new McpError(-32000, 'interaction_lost');
  const principal = auth
    ? createHash('sha256')
        .update(JSON.stringify([auth.clientId, auth.token]))
        .digest('hex')
    : `legacy:${inbound.connectionId}`;
  // The trusted modern bridge already owns a process/owner reservation across its rounds.
  const admission = currentNativeInteractionRound()
    ? undefined
    : legacyOwners.start(
        {
          principal,
          request: String(extra.requestId),
          route: connection.adapter.connectionId,
          provider: sourceProviderId ?? connection.adapter.connectionId,
          generation: connection.adapter.connectionId,
          inbound: 'legacy',
          outbound: connection.adapter.protocol?.era ?? 'legacy',
        },
        Date.now() + 600_000,
      );
  const abort = new AbortController();
  const scopedExtra = {
    ...extra,
    signal: AbortSignal.any([extra.signal, abort.signal, ...(admission ? [admission.signal] : [])]),
  };
  try {
    if (installed.get(connection) !== connection.adapter) {
      const installedAdapter = connection.adapter;
      setOutboundRequestHandler(connection, PingRequestSchema, async () => ({}));
      const schemas = [
        [CreateMessageRequestSchema, CreateMessageResultSchema, 'sampling'],
        [ElicitRequestSchema, ElicitResultSchema, 'elicitation'],
        [ListRootsRequestSchema, ListRootsResultSchema, 'roots'],
      ] as const;
      for (const [schema, resultSchema, capability] of schemas) {
        const profile = profiles.get(connection);
        if (profile && !profile[capability]) continue;
        try {
          setOutboundRequestHandler(connection, schema, async (request: ServerRequest) => {
            const scope = active.get(connection);
            if (
              !scope ||
              scope.adapter !== installedAdapter ||
              connection.adapter !== installedAdapter ||
              scope.extra.signal.aborted
            )
              throw new McpError(-32000, 'interaction_lost');
            const assertRoute = () => {
              try {
                scope.assertCurrent?.();
              } catch {
                scope.abort.abort();
                throw new McpError(-32000, 'interaction_lost');
              }
            };
            assertRoute();
            if (
              !hasInteractionCapability(
                getLegacyInboundServer(scope.inbound).getClientCapabilities(),
                request as GatewayInteractionRequest,
              )
            )
              throw new McpError(-32000, 'interaction_capability_required');
            const assertCapability = () => {
              const capabilities = getLegacyInboundServer(scope.inbound).getClientCapabilities();
              if (!hasInteractionCapability(capabilities, request as GatewayInteractionRequest)) {
                scope.abort.abort();
                throw new McpError(-32000, 'interaction_capability_required');
              }
            };
            if (scope.callbacks.pending >= 32) {
              scope.abort.abort();
              throw new McpError(-32000, 'interaction_capacity_exceeded');
            }
            scope.callbacks.pending++;
            try {
              const input = request as unknown as GatewayInteractionRequest;
              const binding = {
                principal: 'request-scoped-provider',
                request: String(scope.extra.requestId),
                route: scope.adapter.connectionId,
                generation: scope.adapter.connectionId,
                inbound: 'legacy',
                outbound: 'legacy',
              };
              await validateInteractionRequest(input, binding, scope.extra.signal);
              scope.extra.signal.throwIfAborted();
              assertCapability();
              assertRoute();
              const response = await scope.extra.sendRequest(request, resultSchema, { signal: scope.extra.signal });
              await validateInteractionResponse(input, response, binding, scope.extra.signal);
              assertCapability();
              assertRoute();
              if (
                scope.extra.signal.aborted ||
                active.get(connection) !== scope ||
                connection.adapter !== installedAdapter ||
                scope.adapter !== installedAdapter
              )
                throw new McpError(-32000, 'interaction_lost');
              return response;
            } finally {
              scope.callbacks.pending--;
            }
          });
        } catch (error) {
          // Legacy SDKs reject registration for capabilities absent at initialize. Leave
          // those methods unregistered (and fail closed if requested), without blocking ordinary calls.
          if (!(
            error instanceof Error &&
            error.message ===
              `Client does not support ${capability} capability (required for ${schema.shape.method.value})`
          ))
            throw error;
        }
      }
      installed.set(connection, connection.adapter);
    }
    return await withLegacyInteractionLease(
      connection.adapter,
      async () => {
        const scope = Object.freeze({
          inbound,
          extra: scopedExtra,
          adapter: connection.adapter,
          callbacks: { pending: 0 },
          abort,
          assertCurrent,
        });
        active.set(connection, scope);
        try {
          assertCurrent?.();
          return await operation();
        } finally {
          abort.abort();
          if (active.get(connection) === scope) active.delete(connection);
        }
      },
      scopedExtra.signal,
      sessionLogLevels.get(inbound),
      getLegacyInboundServer(inbound).getClientCapabilities(),
    );
  } finally {
    if (admission) legacyOwners.finish(admission.id);
  }
}

const logLevels = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];
export const sessionLogLevels = new WeakMap<InboundConnection, string>();

export async function forwardScopedNotification(
  connection: OutboundConnection,
  notification: { method: string; params?: Record<string, unknown> },
): Promise<void> {
  const scope = active.get(connection);
  if (!scope) {
    if (notification.method !== 'notifications/message') return;
    const owners = Array.from(notificationOwners.get(connection) ?? []).flatMap((ref) => {
      const owner = ref.deref();
      return owner?.status === ServerStatus.Connected && !owner.requestOnly ? [owner] : [];
    });
    if (owners.length !== 1) return;
    const level = notification.params?.level;
    if (
      typeof level !== 'string' ||
      logLevels.indexOf(level) < logLevels.indexOf(sessionLogLevels.get(owners[0]) ?? 'info')
    )
      return;
    await getLegacyInboundServer(owners[0]).notification(notification as ServerNotification);
    return;
  }
  if (scope.extra.signal.aborted) return;
  if (notification.method === 'notifications/message') {
    const level = notification.params?.level;
    if (
      typeof level !== 'string' ||
      logLevels.indexOf(level) < logLevels.indexOf(sessionLogLevels.get(scope.inbound) ?? 'info')
    )
      return;
  }
  await scope.extra.sendNotification(notification as ServerNotification);
}

export function ownsActiveInteraction(connection: OutboundConnection, inbound: InboundConnection): boolean {
  const scope = active.get(connection);
  return scope?.inbound === inbound && !scope.extra.signal.aborted;
}
