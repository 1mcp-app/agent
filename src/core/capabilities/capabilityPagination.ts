import { createHash, randomUUID } from 'node:crypto';

import { ErrorCode } from '@src/sdk/legacy/types.js';

import type { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { clearConfiguredToolSnapshot } from './configuredToolSnapshot.js';

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
  v: 1;
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
const clientIds = new WeakMap<object, number>();
const MAX_DISABLED_PAGINATION_PAGES = 1000;
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

/** Invalidate outstanding cursors for one capability collection. */
export function advanceCapabilityPaginationGeneration(connections: OutboundConnections, kind: CapabilityKind): void {
  getRuntimeState(connections).generation[kind] += 1;
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
      ...(event.notification.params && typeof event.notification.params === 'object' && !Array.isArray(event.notification.params)
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
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('base64url');
}

function compareCodePoints(left: string, right: string): number {
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
  return `${state.nonce}:${state.generation[kind]}`;
}

function invalidCursor(reason: string): never {
  throw new MCPError('Invalid capability pagination cursor', ErrorCode.InvalidParams, { reason });
}

function encodeCursor(cursor: CapabilityPaginationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): CapabilityPaginationCursor {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalidCursor('malformed');

  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    invalidCursor('malformed');
  }

  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) invalidCursor('malformed');
  const cursor = decoded as Partial<CapabilityPaginationCursor>;
  const keys = Object.keys(cursor);
  const failuresValid = cursor.x === undefined || (typeof cursor.x === 'string' && /^[A-Za-z0-9_-]+$/.test(cursor.x));
  if (
    cursor.v !== 1 ||
    keys.some((key) => !['v', 'k', 'g', 'f', 'p', 'u', 'x'].includes(key)) ||
    !['tools', 'resources', 'resourceTemplates', 'prompts'].includes(cursor.k ?? '') ||
    typeof cursor.g !== 'string' ||
    typeof cursor.f !== 'string' ||
    typeof cursor.p !== 'string' ||
    (cursor.u !== undefined && typeof cursor.u !== 'string') ||
    !failuresValid
  ) {
    invalidCursor('malformed');
  }
  return cursor as CapabilityPaginationCursor;
}

function partialMeta(
  failurePositions: number[],
  providers: CapabilityPageProvider<unknown>[],
): Record<string, unknown> | undefined {
  if (failurePositions.length === 0) return undefined;
  return {
    [CAPABILITY_PAGINATION_META_KEY]: {
      partial: true,
      failures: failurePositions.map((position) => ({
        provider: providers[position].name,
        code: 'upstream_list_failed',
      })),
      recovery: {
        action: 'restart_without_cursor',
        description: 'Restart the capability listing without a cursor to retry unavailable providers.',
      },
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
}): Promise<CapabilityPaginationResult<T>> {
  const providers = [...options.providers].sort(
    (left, right) => compareCodePoints(left.name, right.name) || compareCodePoints(left.id, right.id),
  );
  const generation = observeGeneration(options.connections, options.kind, options.extraGenerationSignature);
  const filter = digest(options.filterSelection);
  let providerIndex = 0;
  let upstreamCursor: string | undefined;
  let failures: number[] = [];

  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    if (cursor.k !== options.kind) invalidCursor('capability_kind_mismatch');
    if (cursor.g !== generation) invalidCursor('stale_generation');
    if (cursor.f !== filter) invalidCursor('filter_mismatch');
    providerIndex = providers.findIndex((provider) => provider.id === cursor.p);
    if (providerIndex < 0) invalidCursor('provider_missing');
    upstreamCursor = cursor.u;
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
        } while (cursor);
      } catch {
        if (!failures.includes(position)) failures.push(position);
      }
    }
    return { items, _meta: partialMeta(failures, providers) };
  }

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];
    try {
      const page = await provider.list(upstreamCursor);
      const nextProviderIndex = page.nextCursor ? providerIndex : providerIndex + 1;
      const nextProvider = providers[nextProviderIndex];
      const nextCursor = nextProvider
        ? encodeCursor({
            v: 1,
            k: options.kind,
            g: generation,
            f: filter,
            p: nextProvider.id,
            u: page.nextCursor,
            x: encodeFailurePositions(failures, providers.length),
          })
        : undefined;

      if (page.items.length > 0 || page.nextCursor) {
        return { items: page.items, nextCursor, _meta: partialMeta(failures, providers) };
      }
      providerIndex += 1;
      upstreamCursor = undefined;
    } catch {
      if (!failures.includes(providerIndex)) failures.push(providerIndex);
      providerIndex += 1;
      upstreamCursor = undefined;
    }
  }

  return { items: [], _meta: partialMeta(failures, providers) };
}
