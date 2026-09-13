import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { ErrorCode } from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { clearConfiguredToolSnapshot } from './configuredToolSnapshot.js';

export class CapabilityProvidersUnavailableError extends MCPError {
  constructor() {
    super('Capability providers are unavailable', -32000);
    Object.setPrototypeOf(this, CapabilityProvidersUnavailableError.prototype);
  }
}

export class CapabilityCursorCapacityError extends MCPError {
  constructor() {
    super('Capability cursor capacity exceeded', -32000, {
      'app.1mcp/failure': { kind: 'transport', code: 'gateway_overloaded' },
    });
    Object.setPrototypeOf(this, CapabilityCursorCapacityError.prototype);
  }
}

/** MCP result metadata key used to describe a partial aggregate walk. */
export const CAPABILITY_PAGINATION_META_KEY = 'app.1mcp/capability-pagination';

/** Capability collections supported by aggregate pagination. */
export type CapabilityKind = 'tools' | 'resources' | 'resourceTemplates' | 'prompts';

/** One page returned by a capability provider. */
export interface CapabilityPage<T> {
  items: T[];
  nextCursor?: string;
}

/** A catalog-owned provider participating in a capability walk. */
export interface CapabilityPageProvider<T> {
  id: string;
  name: string;
  list(cursor?: string): Promise<CapabilityPage<T>>;
}

/** Aggregate page plus optional partial-walk metadata. */
export interface CapabilityPaginationResult<T> extends CapabilityPage<T> {
  _meta?: Record<string, unknown>;
}

interface CapabilityPaginationCursor {
  v: 2;
  e: number;
  k: CapabilityKind;
  g: string;
  f: string;
  p: string;
  u?: string;
  x?: string;
}

interface RuntimePaginationState {
  nonce: string;
  generation: Record<CapabilityKind, number>;
  signature: Partial<Record<CapabilityKind, string>>;
}

interface CapabilityNotificationState {
  connections: Set<OutboundConnections>;
  forwarders: Map<object, (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>>;
  pumping: boolean;
}

const runtimeStates = new WeakMap<OutboundConnections, RuntimePaginationState>();
const notificationStates = new WeakMap<object, CapabilityNotificationState>();
const registeredAdapters = new WeakMap<OutboundConnections, Set<object>>();
const clientIds = new WeakMap<object, number>();
const MAX_DISABLED_PAGINATION_PAGES = 1000;
const CURSOR_TTL_MS = 15 * 60 * 1000;
const MAX_CURSOR_LENGTH = 4 * 1024;
const upstreamCursors = new Map<
  string,
  {
    value: string;
    expiresAt: number;
    scope: string;
    runtimeNonce: string;
    kind: CapabilityKind;
    generation: string;
    bytes: number;
  }
>();
const MAX_GLOBAL_CURSOR_ENTRIES = 4000;
const MAX_SCOPE_CURSOR_ENTRIES = 1000;
const MAX_GLOBAL_CURSOR_BYTES = 64 * 1024 * 1024;
const MAX_SCOPE_CURSOR_BYTES = 32 * 1024 * 1024;
const cursorSecret = randomBytes(32);
let nextClientId = 1;

function getClientId(client: object): number {
  let id = clientIds.get(client);
  if (id === undefined) {
    id = nextClientId;
    nextClientId += 1;
    clientIds.set(client, id);
  }
  return id;
}

function getRuntimeState(connections: OutboundConnections): RuntimePaginationState {
  let state = runtimeStates.get(connections);
  if (!state) {
    state = {
      nonce: randomUUID(),
      generation: { tools: 1, resources: 1, resourceTemplates: 1, prompts: 1 },
      signature: {},
    };
    runtimeStates.set(connections, state);
  }
  return state;
}

/** Stable process-local invalidation epoch for operations pinned to these connections. */
export function getCapabilityPaginationGeneration(connections: OutboundConnections, kind: CapabilityKind): string {
  const state = getRuntimeState(connections);
  return `${state.nonce}:${state.generation[kind]}`;
}

/** Invalidate outstanding cursors for one capability collection. */
export function advanceCapabilityPaginationGeneration(connections: OutboundConnections, kind: CapabilityKind): void {
  const state = getRuntimeState(connections);
  state.generation[kind] += 1;
  pruneCursorStore(state);
}

/** Register generation invalidation for a provider created after inbound setup. */
export function registerCapabilityPaginationNotifications(
  connections: OutboundConnections,
  connection: OutboundConnection,
  forwardingKey?: object,
  forward?: (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>,
): void {
  let state = notificationStates.get(connection.adapter);
  if (!state) {
    state = { connections: new Set(), forwarders: new Map(), pumping: false };
    notificationStates.set(connection.adapter, state);
  }
  if (!state.connections.has(connections)) {
    state.connections.add(connections);
    let adapters = registeredAdapters.get(connections);
    if (!adapters) {
      adapters = new Set();
      registeredAdapters.set(connections, adapters);
    }
    adapters.add(connection.adapter);
    for (const kind of ['tools', 'resources', 'resourceTemplates', 'prompts'] as const) {
      advanceCapabilityPaginationGeneration(connections, kind);
    }
  }
  if (forwardingKey && forward) state.forwarders.set(forwardingKey, forward);

  if (!state.pumping) {
    state.pumping = true;
    void pumpCapabilityNotifications(connection, state);
  }
}

async function pumpCapabilityNotifications(
  connection: OutboundConnection,
  state: CapabilityNotificationState,
): Promise<void> {
  while (true) {
    const event = await connection.adapter.nextEvent();
    if (event.type === 'closed') return;
    if (event.type !== 'notification') continue;

    if (event.notification.method === 'notifications/tools/list_changed') {
      clearConfiguredToolSnapshot(connection);
      for (const connections of state.connections) advanceCapabilityPaginationGeneration(connections, 'tools');
    } else if (event.notification.method === 'notifications/resources/list_changed') {
      for (const connections of state.connections) {
        advanceCapabilityPaginationGeneration(connections, 'resources');
        advanceCapabilityPaginationGeneration(connections, 'resourceTemplates');
      }
    } else if (event.notification.method === 'notifications/prompts/list_changed') {
      for (const connections of state.connections) advanceCapabilityPaginationGeneration(connections, 'prompts');
    } else {
      continue;
    }

    const notification = {
      method: event.notification.method,
      ...(event.notification.params &&
      typeof event.notification.params === 'object' &&
      !Array.isArray(event.notification.params)
        ? { params: event.notification.params as Record<string, unknown> }
        : {}),
    };
    await Promise.all(Array.from(state.forwarders.values(), (handler) => handler(notification)));
  }
}

/** Remove one inbound notification forwarder from every connected provider. */
export function unregisterCapabilityPaginationForwarder(connections: OutboundConnections, forwardingKey: object): void {
  for (const connection of connections.values()) {
    notificationStates.get(connection.adapter)?.forwarders.delete(forwardingKey);
  }
}

/** Detach a disposed catalog scope from every adapter it observed, including replaced adapters. */
export function unregisterCapabilityPaginationConnections(connections: OutboundConnections): void {
  for (const adapter of registeredAdapters.get(connections) ?? []) {
    notificationStates.get(adapter)?.connections.delete(connections);
  }
  registeredAdapters.delete(connections);
  const state = runtimeStates.get(connections);
  if (state)
    for (const [key, entry] of upstreamCursors) {
      if (entry.runtimeNonce === state.nonce) upstreamCursors.delete(key);
    }
  runtimeStates.delete(connections);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHmac('sha256', cursorSecret)
    .update(JSON.stringify(stableValue(value)))
    .digest('base64url');
}

export function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0)!);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function observeGeneration(connections: OutboundConnections, kind: CapabilityKind, extraSignature: unknown): string {
  const state = getRuntimeState(connections);
  const signature = digest({
    connections: Array.from(connections.entries())
      .map(([id, connection]) => ({
        id,
        name: connection.name,
        status: connection.status,
        clientId: getClientId(connection.adapter),
        supervision: connection.supervision,
        capabilities: connection.capabilities?.[kind === 'resourceTemplates' ? 'resources' : kind],
        tags: connection.tags,
      }))
      .sort((left, right) => compareCodePoints(left.id, right.id)),
    extraSignature,
  });

  if (state.signature[kind] !== undefined && state.signature[kind] !== signature) {
    state.generation[kind] += 1;
  }
  state.signature[kind] = signature;
  pruneCursorStore(state);
  return `${state.nonce}:${state.generation[kind]}`;
}

function invalidCursor(reason: string): never {
  throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams, { reason });
}

function pruneCursorStore(state?: RuntimePaginationState): void {
  const now = Date.now();
  for (const [key, entry] of upstreamCursors) {
    if (
      entry.expiresAt <= now ||
      (state?.nonce === entry.runtimeNonce && entry.generation !== `${state.nonce}:${state.generation[entry.kind]}`)
    )
      upstreamCursors.delete(key);
  }
}

function encodeCursor(cursor: CapabilityPaginationCursor, scope: string, runtimeNonce: string): string {
  const bytes = cursor.u === undefined ? 0 : Buffer.byteLength(cursor.u);
  if (bytes > 64 * 1024) throw new Error('Upstream cursor exceeds the limit');
  const upstreamKey = cursor.u === undefined ? undefined : digest([scope, cursor.g, cursor.u]);
  const payload = Buffer.from(JSON.stringify({ ...cursor, u: upstreamKey })).toString('base64url');
  const signature = createHmac('sha256', cursorSecret).update(payload).digest('base64url');
  const encoded = `${payload}.${signature}`;
  if (encoded.length > MAX_CURSOR_LENGTH) throw new Error('Upstream pagination cursor exceeds the limit');
  if (upstreamKey !== undefined && cursor.u !== undefined) {
    pruneCursorStore();
    const existing = upstreamCursors.get(upstreamKey);
    if (!existing) {
      let globalBytes = 0;
      let scopeBytes = 0;
      let scopeEntries = 0;
      for (const entry of upstreamCursors.values()) {
        globalBytes += entry.bytes;
        if (entry.scope === scope) {
          scopeBytes += entry.bytes;
          scopeEntries++;
        }
      }
      if (
        upstreamCursors.size >= MAX_GLOBAL_CURSOR_ENTRIES ||
        scopeEntries >= MAX_SCOPE_CURSOR_ENTRIES ||
        globalBytes + bytes > MAX_GLOBAL_CURSOR_BYTES ||
        scopeBytes + bytes > MAX_SCOPE_CURSOR_BYTES
      ) {
        throw new CapabilityCursorCapacityError();
      }
    }
    upstreamCursors.set(upstreamKey, {
      value: cursor.u,
      expiresAt: Math.max(cursor.e, existing?.expiresAt ?? 0),
      scope,
      runtimeNonce,
      kind: cursor.k,
      generation: cursor.g,
      bytes,
    });
  }
  return encoded;
}

function decodeCursor(value: string): CapabilityPaginationCursor {
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) {
    invalidCursor('malformed');
  }
  const [payload, signature] = value.split('.');
  const expected = createHmac('sha256', cursorSecret).update(payload).digest();
  const actual = Buffer.from(signature, 'base64url');
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected) ||
    actual.toString('base64url') !== signature
  ) {
    invalidCursor('authentication_failed');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    invalidCursor('malformed');
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidCursor('malformed');
  const cursor = decoded as Partial<CapabilityPaginationCursor>;
  if (
    cursor.v !== 2 ||
    !Number.isSafeInteger(cursor.e) ||
    Object.keys(cursor).some((key) => !['v', 'e', 'k', 'g', 'f', 'p', 'u', 'x'].includes(key)) ||
    !['tools', 'resources', 'resourceTemplates', 'prompts'].includes(cursor.k ?? '') ||
    typeof cursor.g !== 'string' ||
    typeof cursor.f !== 'string' ||
    typeof cursor.p !== 'string' ||
    (cursor.u !== undefined && typeof cursor.u !== 'string') ||
    (cursor.x !== undefined && (typeof cursor.x !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor.x)))
  )
    invalidCursor('malformed');
  if (cursor.e! <= Date.now()) invalidCursor('expired');
  return cursor as CapabilityPaginationCursor;
}

function partialMeta(failurePositions: number[], generation: string): Record<string, unknown> | undefined {
  if (failurePositions.length === 0) return undefined;
  return {
    [CAPABILITY_PAGINATION_META_KEY]: {
      partial: true,
      complete: false,
      generation,
      failedSourceCount: failurePositions.length,
      failureCategories: { upstream_list_failed: failurePositions.length },
      retryable: true,
      recovery: 'restart-walk',
    },
  };
}

function encodeFailurePositions(positions: number[], providerCount: number): string | undefined {
  if (positions.length === 0) return undefined;
  const bytes = Buffer.alloc(Math.ceil(providerCount / 8));
  for (const position of positions) bytes[Math.floor(position / 8)] |= 1 << (position % 8);
  return bytes.toString('base64url');
}

function decodeFailurePositions(value: string | undefined, providerCount: number): number[] {
  if (!value) return [];
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== Math.ceil(providerCount / 8)) invalidCursor('malformed');
  const positions: number[] = [];
  for (let position = 0; position < providerCount; position += 1) {
    if ((bytes[Math.floor(position / 8)] & (1 << (position % 8))) !== 0) positions.push(position);
  }
  const unusedBits = bytes.length * 8 - providerCount;
  if (unusedBits > 0 && bytes.at(-1)! >> (8 - unusedBits) !== 0) invalidCursor('malformed');
  return positions;
}

/** Walk visible capability providers using one aggregate cursor contract. */
export async function walkCapabilityPages<T>(options: {
  connections: OutboundConnections;
  providers: CapabilityPageProvider<T>[];
  kind: CapabilityKind;
  cursor?: string;
  filterSelection: unknown;
  extraGenerationSignature?: unknown;
  enablePagination: boolean;
  failedProviderIds?: readonly string[];
}): Promise<CapabilityPaginationResult<T>> {
  const providers = [...options.providers].sort(
    (left, right) => compareCodePoints(left.name, right.name) || compareCodePoints(left.id, right.id),
  );
  const generation = observeGeneration(options.connections, options.kind, {
    providers: providers.map(({ id, name }) => ({ id, name })),
    extra: options.extraGenerationSignature,
  });
  const filter = digest({ selection: options.filterSelection, enablePagination: options.enablePagination });
  const runtimeNonce = getRuntimeState(options.connections).nonce;
  const scope = digest([runtimeNonce, options.kind, filter]);
  let providerIndex = 0;
  let upstreamCursor: string | undefined;
  let failures = providers.flatMap((provider, index) =>
    options.failedProviderIds?.includes(provider.id) ? [index] : [],
  );
  let expiresAt = Date.now() + CURSOR_TTL_MS;

  if (options.cursor !== undefined) {
    const cursor = decodeCursor(options.cursor);
    expiresAt = cursor.e;
    if (cursor.k !== options.kind) invalidCursor('capability_kind_mismatch');
    if (cursor.g !== generation) invalidCursor('stale_generation');
    if (cursor.f !== filter) invalidCursor('filter_mismatch');
    providerIndex = providers.findIndex(
      (provider) => createHmac('sha256', cursorSecret).update(provider.id).digest('base64url') === cursor.p,
    );
    if (providerIndex < 0) invalidCursor('provider_missing');
    if (cursor.u !== undefined) {
      const upstream = upstreamCursors.get(cursor.u);
      if (
        !upstream ||
        upstream.expiresAt <= Date.now() ||
        upstream.scope !== scope ||
        upstream.generation !== generation
      ) {
        invalidCursor('expired');
      }
      upstreamCursor = upstream.value;
    }
    failures = decodeFailurePositions(cursor.x, providers.length);
  }

  if (!options.enablePagination) {
    const items: T[] = [];
    for (const [position, provider] of providers.entries()) {
      let cursor: string | undefined;
      try {
        let pages = 0;
        const seenCursors = new Set<string>();
        do {
          const page = await provider.list(cursor);
          items.push(...page.items);
          cursor = page.nextCursor;
          pages += 1;
          if (cursor !== undefined && (seenCursors.has(cursor) || pages >= MAX_DISABLED_PAGINATION_PAGES)) {
            throw new Error('Upstream pagination did not terminate');
          }
          if (cursor !== undefined) seenCursors.add(cursor);
        } while (cursor !== undefined);
      } catch (error) {
        if (error instanceof CapabilityCursorCapacityError) throw error;
        if (!failures.includes(position)) failures.push(position);
      }
    }
    if (providers.length > 0 && failures.length === providers.length && items.length === 0) {
      throw new CapabilityProvidersUnavailableError();
    }
    return { items, _meta: partialMeta(failures, generation) };
  }

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];
    try {
      const page = await provider.list(upstreamCursor);
      const nextProviderIndex = page.nextCursor !== undefined ? providerIndex : providerIndex + 1;
      const nextProvider = providers[nextProviderIndex];
      const nextCursor = nextProvider
        ? encodeCursor(
            {
              v: 2,
              e: expiresAt,
              k: options.kind,
              g: generation,
              f: filter,
              p: createHmac('sha256', cursorSecret).update(nextProvider.id).digest('base64url'),
              u: page.nextCursor,
              x: encodeFailurePositions(failures, providers.length),
            },
            scope,
            runtimeNonce,
          )
        : undefined;

      if (page.items.length > 0 || page.nextCursor !== undefined) {
        return { items: page.items, nextCursor, _meta: partialMeta(failures, generation) };
      }
      providerIndex += 1;
      upstreamCursor = undefined;
    } catch (error) {
      if (error instanceof CapabilityCursorCapacityError) throw error;
      if (!failures.includes(providerIndex)) failures.push(providerIndex);
      providerIndex += 1;
      upstreamCursor = undefined;
    }
  }

  if (options.cursor === undefined && providers.length > 0 && failures.length === providers.length) {
    throw new CapabilityProvidersUnavailableError();
  }
  return { items: [], _meta: partialMeta(failures, generation) };
}
