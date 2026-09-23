import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { ClientStatus, type InboundConnection, ServerStatus } from '@src/core/types/index.js';
import { toJsonValue } from '@src/sdk/contracts/index.js';
import {
  type LegacyOutboundConnection,
  type LegacyOutboundConnections,
  requestLegacyOutbound,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import {
  type ModernSubscriptionHandle,
  openModernSubscription,
} from '@src/sdk/legacy/client/runtime/modernSubscriptions.js';
import { resolveResourceRoute } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import { ResourceUpdatedNotificationSchema } from '@src/sdk/legacy/types.js';

import { z } from 'zod';

// Limits include setup reservations and in-flight delivery, not just buffered work.
const MAX_PROCESS_WATCHES = 1024;
const MAX_OWNER_WATCHES = 64;
const MAX_URI_BYTES = 8192;
const MAX_PENDING_UPDATES = 64;
const MAX_PENDING_BYTES = 1024 * 1024;
let watchCount = 0;
let ownerCount = 0;
let setupCount = 0;
let pendingUpdates = 0;
let pendingBytes = 0;

interface Update {
  method: string;
  params?: Record<string, unknown>;
}
interface Watch {
  readonly owner: Owner;
  readonly uri: string;
  readonly abort: AbortController;
  modern?: ModernSubscriptionHandle;
  connection?: LegacyOutboundConnection;
  adapter?: LegacyOutboundConnection['adapter'];
  upstream?: UpstreamWatch;
  upstreamUri?: string;
  active: boolean;
  ready: Promise<void>;
  authorize?: () => Promise<boolean>;
}
interface Owner {
  readonly inbound: InboundConnection;
  readonly connections: LegacyOutboundConnections;
  readonly watches: Map<string, Watch>;
  readonly catalogs: Map<
    string,
    {
      connection: LegacyOutboundConnection;
      adapter: LegacyOutboundConnection['adapter'];
      connectionKey: string;
      kind: 'tools' | 'resources' | 'prompts';
    }
  >;
  readonly abort: AbortController;
  closed: boolean;
  setups: number;
  pending: number;
  bytes: number;
  delivery: Promise<void>;
  monitor?: ReturnType<typeof setInterval>;
  checking: boolean;
  authorize?: () => Promise<boolean>;
  requiresAuthorization?: boolean;
}
interface UpstreamWatch {
  readonly connection: LegacyOutboundConnection;
  readonly owners: Set<Watch>;
  operation: Promise<void>;
  subscribed: boolean;
}
const catalogOwners = new WeakMap<LegacyOutboundConnection, Set<Owner>>();
const owners = new WeakMap<InboundConnection, Owner>();
const upstreamWatches = new WeakMap<LegacyOutboundConnection, Map<string, UpstreamWatch>>();
const installed = new WeakMap<LegacyOutboundConnection, LegacyOutboundConnection['adapter']>();

async function resolve(owner: Owner, uri: string) {
  const visibility = resolveCapabilityVisibility(
    owner.connections,
    owner.inbound,
    getRequestSession(owner.inbound),
    'resources',
  );
  const snapshot = await acquireRuntimeCapabilityCatalog(owner.connections, visibility);
  return resolveResourceRoute(snapshot, uri);
}

export function setupOwnedResourceNotifications(connection: LegacyOutboundConnection): void {
  if (installed.get(connection) === connection.adapter) return;
  const adapter = connection.adapter;
  installed.set(connection, adapter);
  setOutboundNotificationHandler(connection, ResourceUpdatedNotificationSchema, (notification) => {
    if (connection.adapter === adapter) deliverOwnedResourceUpdate(connection, notification);
  });
  if (connection.adapter.protocol?.era === 'modern') {
    setOutboundNotificationHandler(
      connection,
      z.object({
        method: z.literal('notifications/1mcp/subscription_lost'),
        params: z.object({ uri: z.string().optional(), catalog: z.boolean().optional() }),
      }),
      (notification) => {
        if (connection.adapter !== adapter) return;
        if (notification.params?.catalog === true) {
          for (const owner of Array.from(catalogOwners.get(connection) ?? [])) terminate(owner);
        }
        if (typeof notification.params?.uri === 'string') {
          loseOwnedResourceCoverage(connection, notification.params.uri);
        }
      },
    );
  }
}

function removeReservation(watch: Watch): void {
  if (!watch.active) return;
  watch.active = false;
  watchCount--;
  if (watch.owner.watches.get(watch.uri) === watch) watch.owner.watches.delete(watch.uri);
  if (!watch.owner.watches.size && !watch.owner.authorize && !watch.owner.catalogs.size) {
    clearInterval(watch.owner.monitor);
    watch.owner.monitor = undefined;
  }
}

async function detach(watch: Watch): Promise<void> {
  removeReservation(watch);
  watch.abort.abort();
  if (watch.modern) {
    await watch.modern.close();
    return;
  }
  const { connection, upstreamUri } = watch;
  if (!connection || upstreamUri === undefined) return;
  const watches = upstreamWatches.get(connection);
  const upstream = watch.upstream;
  if (!upstream || !upstream.owners.delete(watch)) return;
  const operation = upstream.operation
    .catch(() => {})
    .then(async () => {
      if (upstream.owners.size) return;
      if (!upstream.subscribed) return;
      await requestLegacyOutbound(upstream.connection, 'resources/unsubscribe', { uri: upstreamUri });
      upstream.subscribed = false;
    });
  upstream.operation = operation;
  try {
    await operation;
  } finally {
    // A later attachment may have queued behind this unsubscribe.
    if (!upstream.owners.size && upstream.operation === operation && watches?.get(upstreamUri) === upstream) {
      watches.delete(upstreamUri);
    }
  }
}

export async function cleanupOwnedResources(inbound: InboundConnection): Promise<void> {
  const owner = owners.get(inbound);
  if (!owner || owner.closed) return;
  owner.closed = true;
  ownerCount--;
  owner.abort.abort();
  clearInterval(owner.monitor);
  for (const { connection } of owner.catalogs.values()) catalogOwners.get(connection)?.delete(owner);
  owner.catalogs.clear();
  await Promise.allSettled(Array.from(owner.watches.values(), detach));
}

function terminate(owner: Owner): void {
  if (owner.closed) return;
  // Revoke ownership synchronously, without waiting for an upstream or a slow recipient.
  void cleanupOwnedResources(owner.inbound);
  void (owner.inbound.adapter.closeWhenIdle?.() ?? owner.inbound.adapter.close()).catch(() => {});
}

function getOwner(connections: LegacyOutboundConnections, inbound: InboundConnection): Owner {
  let owner = owners.get(inbound);
  if (!owner) {
    if (ownerCount >= MAX_PROCESS_WATCHES) throw new Error('Subscription owner admission limit exceeded');
    ownerCount++;
    owner = {
      inbound,
      connections,
      watches: new Map(),
      catalogs: new Map(),
      abort: new AbortController(),
      closed: false,
      setups: 0,
      pending: 0,
      bytes: 0,
      delivery: Promise.resolve(),
      checking: false,
    };
    owners.set(inbound, owner);
  }
  return owner;
}

async function assertWatchCurrent(watch: Watch): Promise<void> {
  if (!watch.active || watch.owner.closed) return;
  if (watch.owner.inbound.status !== ServerStatus.Connected) throw new Error('Resource subscription disconnected');
  if (watch.authorize && !(await watch.authorize())) throw new Error('Resource subscription authorization lost');
  const route = await resolve(watch.owner, watch.uri);
  if (!watch.active || watch.owner.closed) return;
  if (
    route.connection !== watch.connection ||
    route.connection.adapter !== watch.adapter ||
    route.upstreamIdentity !== watch.upstreamUri
  ) {
    throw new Error('Resource subscription coverage changed');
  }
}

function supportsListChanged(connection: LegacyOutboundConnection, kind: 'tools' | 'resources' | 'prompts'): boolean {
  const capability = connection.capabilities?.[kind];
  if (!capability || typeof capability !== 'object' || Array.isArray(capability)) return false;
  return capability.listChanged === true;
}

function assertCatalogCurrent(owner: Owner): void {
  for (const source of owner.catalogs.values()) {
    const visibility = resolveCapabilityVisibility(
      owner.connections,
      owner.inbound,
      getRequestSession(owner.inbound),
      source.kind,
    );
    if (
      owner.connections.get(source.connectionKey) !== source.connection ||
      source.connection.adapter !== source.adapter ||
      source.connection.status !== ClientStatus.Connected ||
      !supportsListChanged(source.connection, source.kind) ||
      !visibility.serverCandidates.has(source.connectionKey)
    ) {
      throw new Error('Catalog subscription coverage changed');
    }
  }
}

function monitorOwner(owner: Owner): void {
  if (owner.monitor) return;
  owner.monitor = setInterval(() => {
    if (owner.closed || owner.checking) return;
    owner.checking = true;
    void deliverBounded(owner, async () => {
      if (owner.inbound.status === ServerStatus.Connecting) return;
      if (owner.inbound.status !== ServerStatus.Connected) throw new Error('Subscription owner disconnected');
      assertCatalogCurrent(owner);
      if (owner.requiresAuthorization && !owner.authorize) return;
      if (owner.authorize && !(await owner.authorize())) throw new Error('Subscription authorization lost');
      for (const watch of owner.watches.values()) {
        if (!watch.active || !watch.connection) continue;
        await assertWatchCurrent(watch);
      }
    })
      .catch(() => terminate(owner))
      .finally(() => {
        owner.checking = false;
      });
  }, 1000);
  owner.monitor.unref();
}

async function deliverBounded(owner: Owner, delivery: () => Promise<void>): Promise<void> {
  if (owner.closed) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Subscription delivery stopped'));
    owner.abort.signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('Subscription delivery deadline exceeded')), 30_000);
    timer.unref();
  });
  try {
    await Promise.race([delivery(), stopped]);
  } finally {
    clearTimeout(timer);
    owner.abort.signal.removeEventListener('abort', abort);
  }
}

function enqueue(owner: Owner, bytes: number, delivery: () => Promise<void>): void {
  if (owner.closed) return;
  if (owner.requiresAuthorization && !owner.authorize) return;
  if (
    owner.pending >= MAX_PENDING_UPDATES ||
    owner.bytes + bytes > MAX_PENDING_BYTES ||
    pendingUpdates >= 4096 ||
    pendingBytes + bytes > 16 * MAX_PENDING_BYTES
  ) {
    terminate(owner);
    return;
  }
  owner.pending++;
  pendingUpdates++;
  pendingBytes += bytes;
  owner.bytes += bytes;
  owner.delivery = owner.delivery
    .then(async () => {
      if (owner.closed) return;
      await deliverBounded(owner, async () => {
        if (owner.inbound.status !== ServerStatus.Connected) throw new Error('Subscription owner disconnected');
        assertCatalogCurrent(owner);
        if (owner.authorize && !(await owner.authorize())) throw new Error('Subscription authorization lost');
        if (owner.closed) return;
        await delivery();
      });
    })
    .catch(() => terminate(owner))
    .finally(() => {
      owner.pending--;
      pendingUpdates--;
      pendingBytes -= bytes;
      owner.bytes -= bytes;
    });
}

/** Legacy inbound connections implicitly receive supported catalog changes; private modern bridges pin their filters. */
export function registerOwnedCatalogConnection(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  connection: LegacyOutboundConnection,
  kind: 'tools' | 'resources' | 'prompts',
): void {
  if (inbound.requestOnly) return;
  const selected = inbound.subscriptionListKinds;
  if (selected && !selected.includes(kind)) return;
  if (!supportsListChanged(connection, kind)) return;
  const key = Array.from(connections).find(([, candidate]) => candidate === connection)?.[0];
  if (key === undefined) return;
  const visibility = resolveCapabilityVisibility(connections, inbound, getRequestSession(inbound), kind);
  if (!visibility.serverCandidates.has(key)) return;
  const owner = getOwner(connections, inbound);
  const coverageKey = `${key}\0${kind}`;
  const existing = owner.catalogs.get(coverageKey);
  if (existing) {
    if (existing.connection !== connection || existing.adapter !== connection.adapter) terminate(owner);
    return;
  }
  if (owner.catalogs.size >= 128) {
    terminate(owner);
    throw new Error('Catalog subscription source limit exceeded');
  }
  owner.catalogs.set(coverageKey, { connection, adapter: connection.adapter, connectionKey: key, kind });
  let listeners = catalogOwners.get(connection);
  if (!listeners) catalogOwners.set(connection, (listeners = new Set()));
  listeners.add(owner);
  setupOwnedResourceNotifications(connection);
  monitorOwner(owner);
}

export function bindOwnedCatalogConnections(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  kind: 'tools' | 'resources' | 'prompts',
): void {
  for (const connection of connections.values()) registerOwnedCatalogConnection(connections, inbound, connection, kind);
}

/** HTTP sessions cannot send unsolicited data before their initializing request binds its grant. */
export function requireOwnedNotificationAuthorization(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
): void {
  getOwner(connections, inbound).requiresAuthorization = true;
}

/** Bind the admitted request grant before allowing unsolicited catalog delivery. */
export function bindOwnedNotificationAuthorization(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  authorize: () => Promise<boolean>,
): void {
  if (inbound.requestOnly) return;
  const owner = getOwner(connections, inbound);
  owner.authorize ??= authorize;
  monitorOwner(owner);
}

/** Only the exact source/kind whose coverage belongs to this owner may enqueue a catalog event. */
export function enqueueOwnedCatalogNotification(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  connection: LegacyOutboundConnection,
  notification: Update,
): void {
  const owner = owners.get(inbound);
  if (!owner || owner.closed) return;
  const kind = notification.method.split('/')[1];
  const covered = Array.from(owner.catalogs.values()).some(
    (source) => source.connection === connection && source.adapter === connection.adapter && source.kind === kind,
  );
  if (!covered) return;
  enqueueOwnedNotification(connections, inbound, notification);
}

/** Catalog invalidation remains synchronous upstream; recipient delivery never blocks its peers. */
export function enqueueOwnedNotification(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  notification: Update,
): void {
  if (inbound.requestOnly) return;
  const kinds = {
    'notifications/tools/list_changed': 'tools',
    'notifications/resources/list_changed': 'resources',
    'notifications/prompts/list_changed': 'prompts',
  } as const;
  const kind = kinds[notification.method as keyof typeof kinds];
  if (kind && inbound.subscriptionListKinds && !inbound.subscriptionListKinds.includes(kind)) return;
  const owner = getOwner(connections, inbound);
  const encoded = JSON.stringify(notification);
  const snapshot = structuredClone(notification);
  enqueue(owner, Buffer.byteLength(encoded), async () => {
    await inbound.adapter.notify({ method: snapshot.method, params: toJsonValue(snapshot.params ?? {}) });
  });
}

export async function subscribeOwnedResource(
  connections: LegacyOutboundConnections,
  inbound: InboundConnection,
  uri: string,
  signal?: AbortSignal,
  authorize?: () => Promise<boolean>,
): Promise<void> {
  if (signal?.aborted) throw new Error('Resource subscription cancelled');
  const owner = getOwner(connections, inbound);
  if (owner.closed) throw new Error('Resource subscription owner is closed');
  if (authorize) owner.authorize ??= authorize;
  const existing = owner.watches.get(uri);
  if (existing) return existing.ready;
  if (Buffer.byteLength(uri) > MAX_URI_BYTES) throw new Error('Resource subscription URI exceeds limit');
  if (
    owner.watches.size >= MAX_OWNER_WATCHES ||
    owner.setups >= MAX_OWNER_WATCHES ||
    watchCount >= MAX_PROCESS_WATCHES ||
    setupCount >= MAX_PROCESS_WATCHES
  ) {
    throw new Error('Resource subscription admission limit exceeded');
  }
  const watch: Watch = { owner, uri, abort: new AbortController(), active: true, ready: Promise.resolve(), authorize };
  owner.watches.set(uri, watch);
  watchCount++;
  setupCount++;
  owner.setups++;
  const cancel = () => {
    void detach(watch).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  watch.ready = (async () => {
    try {
      if (authorize && !(await authorize())) throw new Error('Resource subscription authorization lost');
      const route = await resolve(owner, uri);
      if (!watch.active || owner.closed) throw new Error('Resource subscription cancelled');
      watch.connection = route.connection;
      watch.adapter = route.connection.adapter;
      watch.upstreamUri = route.upstreamIdentity;
      setupOwnedResourceNotifications(route.connection);
      if (route.connection.adapter.protocol?.era === 'modern') {
        const handle = await openModernSubscription(
          route.connection.adapter,
          { resourceSubscriptions: [route.upstreamIdentity] },
          (notification) => deliverWatch(watch, notification),
          () => terminate(owner),
          AbortSignal.any([owner.abort.signal, watch.abort.signal]),
        );
        watch.modern = handle;
        if (!handle.honoredFilter.resourceSubscriptions?.includes(route.upstreamIdentity)) {
          await handle.close();
          throw new Error('Upstream did not accept resource subscription');
        }
        if (!watch.active || owner.closed) throw new Error('Resource subscription cancelled');
        await assertWatchCurrent(watch);
        monitorOwner(owner);
        return;
      }

      let watches = upstreamWatches.get(route.connection);
      if (!watches) {
        watches = new Map();
        upstreamWatches.set(route.connection, watches);
      }
      let upstream = watches.get(route.upstreamIdentity);
      if (!upstream || upstream.connection.adapter !== watch.adapter) {
        upstream = {
          connection: { ...route.connection, adapter: watch.adapter },
          owners: new Set(),
          operation: Promise.resolve(),
          subscribed: false,
        };
        watches.set(route.upstreamIdentity, upstream);
      }
      watch.upstream = upstream;
      upstream.owners.add(watch);
      const selected = upstream;
      const operation = upstream.operation
        .catch(() => {})
        .then(async () => {
          if (!watch.active) return;
          if (selected.subscribed) return;
          await requestLegacyOutbound(selected.connection, 'resources/subscribe', { uri: route.upstreamIdentity });
          selected.subscribed = true;
        });
      upstream.operation = operation;
      await operation;
      if (!watch.active || owner.closed) throw new Error('Resource subscription cancelled');
      await assertWatchCurrent(watch);
      monitorOwner(owner);
    } catch (error) {
      await detach(watch).catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      setupCount--;
      owner.setups--;
    }
  })();
  return watch.ready;
}

export async function unsubscribeOwnedResource(inbound: InboundConnection, uri: string): Promise<void> {
  const watch = owners.get(inbound)?.watches.get(uri);
  if (watch) await detach(watch);
}

/** One upstream callback fans out without awaiting any recipient's delivery queue. */
export function deliverOwnedResourceUpdate(connection: LegacyOutboundConnection, notification: Update): void {
  const uri = notification.params?.uri;
  if (typeof uri !== 'string') return;
  const upstream = upstreamWatches.get(connection)?.get(uri);
  if (!upstream) return;
  for (const watch of upstream.owners) deliverWatch(watch, notification);
}

function deliverWatch(watch: Watch, notification: Update): void {
  if (
    !watch.active ||
    notification.method !== 'notifications/resources/updated' ||
    notification.params?.uri !== watch.upstreamUri
  )
    return;
  const encoded = JSON.stringify(notification);
  const snapshot = structuredClone(notification);
  enqueue(watch.owner, Buffer.byteLength(encoded), async () => {
    await watch.ready;
    if (!watch.active || watch.owner.closed) return;
    await assertWatchCurrent(watch);
    if (!watch.active || watch.owner.closed) return;
    const params = { ...snapshot.params, uri: watch.uri, server: watch.connection?.name };
    const meta = snapshot.params?._meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      Object.assign(params, {
        _meta: Object.fromEntries(
          Object.entries(meta).filter(([key]) => key !== 'io.modelcontextprotocol/subscriptionId'),
        ),
      });
    }
    await watch.owner.inbound.adapter.notify({
      method: snapshot.method,
      params: toJsonValue(params),
    });
  });
}

/** Coverage loss is terminal; streams are never silently reattached or replayed. */
export function loseOwnedResourceCoverage(connection: LegacyOutboundConnection, uri?: string): void {
  const watches = upstreamWatches.get(connection);
  if (!watches) return;
  for (const [upstreamUri, upstream] of watches) {
    if (uri !== undefined && upstreamUri !== uri) continue;
    for (const watch of Array.from(upstream.owners)) terminate(watch.owner);
  }
}
