import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
} from '@src/core/capabilities/capabilityPagination.js';
import type { CatalogEntry } from '@src/core/capabilities/catalogGeneration.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ClientStatus, type InboundConnection, type OutboundConnection } from '@src/core/types/index.js';
import { captureJson } from '@src/core/validation/schemaPolicy.js';
import { hasInteractionCapability } from '@src/gateway/interactions/interactionCapabilities.js';
import { withDerivedInteractionRoute } from '@src/gateway/interactions/interactionRoute.js';
import { ClientFactory, getAdvertisedClientCapabilities } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import {
  createLegacyOutboundConnection,
  getLegacyClient,
  getLegacyTransport,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import {
  ClientCapabilitiesSchema,
  McpError,
  type ServerNotification,
  type ServerRequest,
} from '@src/sdk/legacy/types.js';

import { setRequestInteractionProfile, withRequestInteractionScope } from './requestInteractionScope.js';

let active = 0;
const capacity = 128;

/** Keep each operation pinned to notifications from its selected provider only. */
export async function withPrivateInteractionConnection<T>(
  source: OutboundConnection,
  inbound: InboundConnection,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  entry: CatalogEntry,
  operation: (connection: OutboundConnection) => Promise<T>,
  assertCurrent?: () => void,
): Promise<T> {
  const adapter = source.adapter;
  const observed = new Map([[entry.route.connectionKey, source]]);
  registerCapabilityPaginationNotifications(observed, source);
  const kinds = entry.route.kind === 'resources' ? (['resources', 'resourceTemplates'] as const) : [entry.route.kind];
  const generations = kinds.map((kind) => getCapabilityPaginationGeneration(observed, kind));
  const assertProviderCurrent = () => {
    if (
      source.adapter !== adapter ||
      source.status !== ClientStatus.Connected ||
      kinds.some((kind, index) => getCapabilityPaginationGeneration(observed, kind) !== generations[index])
    )
      throw new McpError(-32000, 'interaction_lost');
    assertCurrent?.();
  };
  try {
    return await withSelectedInteractionConnection(source, inbound, extra, entry, operation, assertProviderCurrent);
  } finally {
    unregisterCapabilityPaginationConnections(observed);
  }
}

/** Reuse an empty legacy profile only with factory evidence; unknown or wider profiles require isolation. */
async function withSelectedInteractionConnection<T>(
  source: OutboundConnection,
  inbound: InboundConnection,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  entry: CatalogEntry,
  operation: (connection: OutboundConnection) => Promise<T>,
  assertCurrent?: () => void,
): Promise<T> {
  if (!inbound.canonicalSchemaProjection || source.adapter.protocol?.era === 'modern') {
    return withRequestInteractionScope(source, inbound, extra, () => operation(source), undefined, assertCurrent);
  }
  const callerCapabilities = getLegacyInboundServer(inbound).getClientCapabilities() ?? {};
  const interactive =
    hasInteractionCapability(callerCapabilities, { method: 'roots/list' }) ||
    hasInteractionCapability(callerCapabilities, { method: 'sampling/createMessage' }) ||
    hasInteractionCapability(callerCapabilities, { method: 'elicitation/create' }) ||
    hasInteractionCapability(callerCapabilities, { method: 'elicitation/create', params: { mode: 'url' } });
  const advertised = getAdvertisedClientCapabilities(getLegacyClient(source));
  const provenEmpty = advertised !== undefined && Object.keys(advertised).length === 0;
  if (!interactive && provenEmpty) {
    return withRequestInteractionScope(source, inbound, extra, () => operation(source), undefined, assertCurrent);
  }
  const originalTransport = getLegacyTransport(source);
  if (!originalTransport.recreate) throw new McpError(-32000, 'interaction_unsupported');
  if (active >= capacity) throw new McpError(-32000, 'interaction_capacity_exceeded');
  extra.signal.throwIfAborted();
  active++;
  let transport: AuthProviderTransport | undefined;
  let child: OutboundConnection | undefined;
  let removeAbort: () => void = () => undefined;
  try {
    const recreated = originalTransport.recreate({ preserveSessionId: false });
    if (recreated === originalTransport) throw new McpError(-32000, 'interaction_unsupported');
    transport = recreated;
    transport.outboundProtocolVersion = 'legacy';
    const timeout = Math.max(1, Math.min(source.requestTimeoutMs ?? 60_000, 600_000));
    transport.requestTimeout = timeout;
    const capabilities = ClientCapabilitiesSchema.parse(captureJson(callerCapabilities, false).value);
    const client = new ClientFactory().createClient(transport, {
      ...(capabilities.roots === undefined ? {} : { roots: capabilities.roots }),
      ...(capabilities.sampling === undefined ? {} : { sampling: capabilities.sampling }),
      ...(capabilities.elicitation === undefined ? {} : { elicitation: capabilities.elicitation }),
    });
    const signal = AbortSignal.any([extra.signal, AbortSignal.timeout(timeout)]);
    const aborted = new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new McpError(-32000, 'interaction_lost'));
      signal.addEventListener('abort', abort, { once: true });
      removeAbort = () => signal.removeEventListener('abort', abort);
      if (signal.aborted) abort();
    });
    const connected = client.connect(transport);
    await Promise.race([connected, aborted]);
    child = createLegacyOutboundConnection({
      name: source.name,
      client,
      transport,
      status: ClientStatus.Connected,
      capabilities: client.getServerCapabilities() ?? {},
    });
    const privateSource = child;
    const expectedRevision = source.adapter.protocolRevision ?? source.adapter.protocol?.revision ?? '2025-11-25';
    if (privateSource.adapter.protocolRevision !== expectedRevision) throw new McpError(-32000, 'interaction_lost');
    setRequestInteractionProfile(privateSource, capabilities);
    return await Promise.race([
      withDerivedInteractionRoute(source.adapter, privateSource.adapter, async () => {
        // A changed contract on the new peer must fail before any side-effecting operation.
        const snapshot = await acquireRuntimeCapabilityCatalog(
          new Map([[entry.route.connectionKey, privateSource]]),
          undefined,
          { signal },
        );
        const matches = snapshot.generation.entries.filter(
          (candidate) =>
            candidate.route.kind === entry.route.kind &&
            candidate.route.upstreamIdentity === entry.route.upstreamIdentity,
        );
        if (
          matches.length !== 1 ||
          captureJson(matches[0].sourceObject, false, true).json !== captureJson(entry.sourceObject, false, true).json
        ) {
          throw new McpError(-32000, 'interaction_lost');
        }
        signal.throwIfAborted();
        return withRequestInteractionScope(
          privateSource,
          inbound,
          { ...extra, signal },
          () => operation(privateSource),
          source.adapter.connectionId,
          assertCurrent,
        );
      }),
      aborted,
    ]);
  } finally {
    removeAbort();
    // Retain the capacity reservation if an uncooperative transport never closes.
    const closing = Promise.resolve().then(() => (child ? child.adapter.close() : transport?.close()));
    void closing.then(
      () => {
        active--;
      },
      () => undefined,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closing.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
