import { createHash, randomUUID } from 'node:crypto';

import { getConfiguredServerTargets } from '@src/config/configuredServerTargets.js';
import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationForwarder,
} from '@src/core/capabilities/capabilityPagination.js';
import { createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { FilteringService } from '@src/core/filtering/filteringService.js';
import { filterConnectionsForSession } from '@src/core/protocol/requestHandlerUtils.js';
import { resolveResourceRoute } from '@src/core/protocol/resourceTemplateRouting.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import type { GatewayOperation } from '@src/gateway/contracts/gatewayRequest.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import type { InteractionBinding } from '@src/gateway/interactions/interactionOwner.js';
import { withInteractionRoute } from '@src/gateway/interactions/interactionRoute.js';
import type { AuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

const identities = new WeakMap<object, string>();
const sourceEpochs = new WeakMap<OutboundConnection, OutboundConnections>();
const bindingSources = new WeakMap<
  InteractionBinding,
  {
    connection: OutboundConnection;
    connections: OutboundConnections;
    kind: 'tools' | 'resources' | 'prompts';
    pin: Parameters<typeof withInteractionRoute>[0];
  }
>();

/** Only the selected provider's relevant invalidation can terminate this live operation. */
export function watchModernInteractionBinding(binding: InteractionBinding, invalidate: () => void): () => void {
  const source = bindingSources.get(binding);
  if (!source) return () => undefined;
  const key = {};
  registerCapabilityPaginationNotifications(source.connections, source.connection, key, async (notification) => {
    if (notification.method === `notifications/${source.kind}/list_changed`) invalidate();
  });
  return () => unregisterCapabilityPaginationForwarder(source.connections, key);
}
function identity(value: object): string {
  let id = identities.get(value);
  if (!id) identities.set(value, (id = randomUUID()));
  return id;
}

function digest(value: unknown): string {
  const json = JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

  return createHash('sha256').update(json).digest('hex');
}

/** Synchronous source fence used after the final asynchronous authorization check. */
export function isModernInteractionBindingCurrent(binding: InteractionBinding): boolean {
  return bindingSources.get(binding)?.pin.isCurrent?.() === true;
}

/** Carry the resolved route through the private bridge to the actual upstream dispatch guard. */
export function withModernInteractionBinding<T>(binding: InteractionBinding, operation: () => Promise<T>): Promise<T> {
  const source = bindingSources.get(binding);
  if (!source) throw new Error('Interaction route is unavailable');
  return withInteractionRoute(source.pin, operation);
}

/** Reauthorize a continuation against the same public route, never a private bridge's temporary id. */
export async function createModernInteractionBinding(
  manager: Pick<ServerManager, 'getClients'>,
  config: InboundConnectionConfig,
  operation: GatewayOperation,
  params: unknown,
  auth: AuthInfo | undefined,
  capabilities: unknown,
): Promise<InteractionBinding | undefined> {
  // Anonymous bearer continuations need an explicit listener policy; they are not enabled implicitly.
  if (!auth || !['tools/call', 'prompts/get', 'resources/read'].includes(operation)) return undefined;
  const captured = toImmutableJsonValue(params ?? {});
  if (!captured || typeof captured !== 'object' || Array.isArray(captured)) return undefined;
  const kind = operation === 'tools/call' ? 'tools' : operation === 'prompts/get' ? 'prompts' : 'resources';
  const record = captured as Readonly<
    Record<string, import('@src/gateway/contracts/immutableJson.js').ImmutableJsonValue>
  >;
  const publicIdentity = record[kind === 'resources' ? 'uri' : 'name'];
  if (typeof publicIdentity !== 'string') return undefined;
  const connections = manager.getClients();
  const visible = FilteringService.getFilteredConnections(filterConnectionsForSession(connections, undefined), config);
  const visibility = createCapabilityVisibility(
    Array.from(visible, ([key, connection]) => [key, connection.name || key] as const),
    undefined,
    { ...config },
  );
  const serverConfigs = getConfiguredServerTargets();
  const snapshot = await acquireRuntimeCapabilityCatalog(connections, visibility, { serverConfigs });
  const selected =
    kind === 'resources' ? resolveResourceRoute(snapshot, publicIdentity) : snapshot.resolve(kind, publicIdentity);
  if (!selected?.connection) return undefined;
  const { entry, connection } = selected;
  let epochConnections = sourceEpochs.get(connection);
  if (!epochConnections) {
    epochConnections = new Map([[entry.route.connectionKey, connection]]);
    sourceEpochs.set(connection, epochConnections);
  }
  registerCapabilityPaginationNotifications(epochConnections, connection);
  const adapter = connection.adapter;
  const epoch = epochConnections;
  const generation = () =>
    digest([
      identity(connection),
      identity(connection.adapter),
      connection.adapter.connectionId,
      entry.sourceObject,
      getConfiguredServerTargets()[entry.route.server],
      connection.capabilities,
      getCapabilityPaginationGeneration(epoch, kind),
      ...(kind === 'resources' ? [getCapabilityPaginationGeneration(epoch, 'resourceTemplates')] : []),
    ]);
  const pin = connection.adapter.protocol ?? {
    era: 'legacy',
    revision: connection.adapter.protocolRevision ?? '2025-11-25',
  };
  const { _meta: _meta, ...semanticParams } = record;
  const binding = Object.freeze({
    // Tokens are already verified by middleware. Hashing also prevents unrelated grants of one OAuth client sharing flows.
    principal: digest([auth.clientId, auth.token]),
    request: digest([
      operation,
      semanticParams,
      toImmutableJsonValue(capabilities ?? {}),
      [...auth.grantedScopes].sort(),
      [...auth.grantedTags].sort(),
      config,
    ]),
    route: digest(entry.route),
    provider: connection.adapter.connectionId,
    generation: generation(),
    inbound: 'modern:2026-07-28',
    outbound: `${pin.era}:${pin.revision}`,
  });
  bindingSources.set(binding, {
    connection,
    connections: epochConnections,
    kind,
    pin: {
      adapter,
      method: operation,
      identity:
        'upstreamIdentity' in selected && typeof selected.upstreamIdentity === 'string'
          ? selected.upstreamIdentity
          : entry.route.upstreamIdentity,
      isCurrent: () =>
        snapshot.isCurrent() &&
        manager.getClients().get(entry.route.connectionKey) === connection &&
        connection.adapter === adapter &&
        generation() === binding.generation,
    },
  });
  return binding;
}
