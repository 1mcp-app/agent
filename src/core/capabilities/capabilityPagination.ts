import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import type { OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import {
  ErrorCode,
  InvalidJsonValueError,
  type JsonValueCost,
  type JsonValueLimits,
  measureJsonValue,
  RESPONSE_ITEM_DEPTH,
} from '@src/sdk/contracts/index.js';
import { MCPError } from '@src/utils/core/errorTypes.js';

import { clearConfiguredToolSnapshot } from './configuredToolSnapshot.js';

export class CapabilityProvidersUnavailableError extends MCPError {
  constructor(public readonly _meta?: Record<string, unknown>) {
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

/** One capability item is larger than a whole response may be. */
export class CapabilityResponseBudgetError extends MCPError {
  constructor() {
    super('Capability item exceeds the response limits', ErrorCode.InternalError);
    Object.setPrototypeOf(this, CapabilityResponseBudgetError.prototype);
  }
}

class InvalidCapabilityCursorError extends MCPError {
  constructor(reason: string) {
    super('Invalid capability pagination cursor', ErrorCode.InvalidParams, { reason });
    Object.setPrototypeOf(this, InvalidCapabilityCursorError.prototype);
  }
}

/** Errors that end a walk instead of marking one provider as failed. */
function abortsWalk(error: unknown): boolean {
  return (
    error instanceof CapabilityCursorCapacityError ||
    error instanceof CapabilityResponseBudgetError ||
    error instanceof InvalidCapabilityCursorError
  );
}

/** MCP result metadata key used to describe a partial aggregate walk. */
export const CAPABILITY_PAGINATION_META_KEY = 'app.1mcp/capability-pagination';

const capabilityFailureSources = new WeakMap<Record<string, unknown>, ReadonlySet<string>>();

export interface CapabilityFailureFact {
  upstream_list_failed?: number;
  upstream_tool_admission_timeout?: number;
}

const capabilityFailureFacts = new WeakMap<Record<string, unknown>, ReadonlyMap<string, CapabilityFailureFact>>();

/** Clone private facts so consumers can filter visibility without exposing provider identities. */
export function getCapabilityFailureFacts(
  meta: Record<string, unknown> | undefined,
): ReadonlyMap<string, CapabilityFailureFact> {
  return new Map(
    Array.from(meta ? (capabilityFailureFacts.get(meta) ?? []) : [], ([source, fact]) => [source, { ...fact }]),
  );
}

export function setCapabilityFailureFacts(
  meta: Record<string, unknown>,
  facts: ReadonlyMap<string, CapabilityFailureFact>,
): Record<string, unknown> {
  capabilityFailureFacts.set(meta, new Map(Array.from(facts, ([source, fact]) => [source, { ...fact }])));
  return setCapabilityFailureSources(meta, facts.keys());
}

/** Restrict locally known partial facts to the caller's visible backend candidates. */
export function filterCapabilityPartialMeta(
  meta: Record<string, unknown> | undefined,
  connectionKeys: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const facts = getCapabilityFailureFacts(meta);
  if (facts.size === 0) return meta;
  const status = meta[CAPABILITY_PAGINATION_META_KEY];
  if (!status) return meta;
  if (typeof status !== 'object') return meta;
  const visible = new Map(Array.from(facts).filter(([source]) => connectionKeys.has(source)));
  const filtered = { ...meta };
  if (visible.size === 0) {
    delete filtered[CAPABILITY_PAGINATION_META_KEY];
    if (Object.keys(filtered).length === 0) return undefined;
    return setCapabilityFailureFacts(filtered, visible);
  }
  const failureCategories: CapabilityFailureFact = {};
  for (const fact of visible.values()) {
    for (const category of ['upstream_list_failed', 'upstream_tool_admission_timeout'] as const) {
      const count = fact[category];
      if (count === undefined) continue;
      failureCategories[category] = (failureCategories[category] ?? 0) + count;
    }
  }
  filtered[CAPABILITY_PAGINATION_META_KEY] = {
    ...status,
    failedSourceCount: visible.size,
    failureCategories,
  };
  return setCapabilityFailureFacts(filtered, visible);
}

/** Process-local failure provenance; provider identities never become public metadata. */
export function getCapabilityFailureSources(meta: Record<string, unknown> | undefined): ReadonlySet<string> {
  return new Set(meta ? capabilityFailureSources.get(meta) : undefined);
}

export function setCapabilityFailureSources(
  meta: Record<string, unknown>,
  sources: Iterable<string>,
): Record<string, unknown> {
  capabilityFailureSources.set(meta, new Set(sources));
  return meta;
}

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

/**
 * Limits one assembled response must fit. Pages are cut at item boundaries so the
 * items plus the response envelope stay within `limits`.
 */
export interface CapabilityResponseBudget<T> {
  limits: JsonValueLimits;
  /** One item in the form it is sent; defaults to the item itself. */
  project?: (item: T) => unknown;
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
  /** Items of the upstream page at `u` already returned in earlier responses. */
  o?: number;
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
// Room for the list key, `nextCursor` (bounded by MAX_CURSOR_LENGTH) and partial-walk `_meta`.
const RESPONSE_ENVELOPE_RESERVE: JsonValueCost = { nodes: 64, stringLength: MAX_CURSOR_LENGTH + 4 * 1024 };
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
  throw new InvalidCapabilityCursorError(reason);
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
    Object.keys(cursor).some((key) => !['v', 'e', 'k', 'g', 'f', 'p', 'u', 'o', 'x'].includes(key)) ||
    !['tools', 'resources', 'resourceTemplates', 'prompts'].includes(cursor.k ?? '') ||
    typeof cursor.g !== 'string' ||
    typeof cursor.f !== 'string' ||
    typeof cursor.p !== 'string' ||
    (cursor.u !== undefined && typeof cursor.u !== 'string') ||
    (cursor.o !== undefined && (!Number.isSafeInteger(cursor.o) || cursor.o < 1)) ||
    (cursor.x !== undefined && (typeof cursor.x !== 'string' || !/^[A-Za-z0-9_-]+$/.test(cursor.x)))
  )
    invalidCursor('malformed');
  if (cursor.e! <= Date.now()) invalidCursor('expired');
  return cursor as CapabilityPaginationCursor;
}

/** Construct captured partial facts without walking providers or exposing provider identities. */
export function createCapabilityPartialMeta(
  generation: string,
  failedProviderIds: readonly string[],
  admissionTimeouts: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (failedProviderIds.length === 0 && admissionTimeouts.length === 0) return undefined;
  const failedProviders = new Set(failedProviderIds);
  const facts = new Map<string, CapabilityFailureFact>();
  for (const source of failedProviders) facts.set(source, { upstream_list_failed: 1 });
  for (const source of admissionTimeouts) {
    const fact = facts.get(source) ?? {};
    facts.set(source, { ...fact, upstream_tool_admission_timeout: (fact.upstream_tool_admission_timeout ?? 0) + 1 });
  }
  return setCapabilityFailureFacts(
    {
      [CAPABILITY_PAGINATION_META_KEY]: {
        partial: true,
        complete: false,
        generation,
        failedSourceCount: facts.size,
        failureCategories: {
          ...(failedProviders.size > 0 ? { upstream_list_failed: failedProviders.size } : {}),
          ...(admissionTimeouts.length > 0 ? { upstream_tool_admission_timeout: admissionTimeouts.length } : {}),
        },
        retryable: true,
        recovery: 'restart-walk',
      },
    },
    facts,
  );
}

function partialMeta(
  failurePositions: number[],
  generation: string,
  providers: readonly CapabilityPageProvider<unknown>[],
  admissionTimeouts: readonly string[],
): Record<string, unknown> | undefined {
  return createCapabilityPartialMeta(
    generation,
    failurePositions.map((position) => providers[position].id),
    admissionTimeouts,
  );
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

/**
 * Counts the leading items that still fit one response after `spent`, and the budget spent with them.
 * Items are measured at the depth they occupy in the response frame; an item that cannot fit any
 * response ends the count like one that does not fit this one.
 */
function takeWithinBudget<T>(
  items: readonly T[],
  budget: CapabilityResponseBudget<T>,
  spent: JsonValueCost,
): { count: number; spent: JsonValueCost } {
  let { nodes, stringLength } = spent;
  let count = 0;
  for (const item of items) {
    let cost: JsonValueCost;
    try {
      cost = measureJsonValue(budget.project ? budget.project(item) : item, budget.limits, RESPONSE_ITEM_DEPTH);
    } catch (error) {
      if (error instanceof InvalidJsonValueError) break;
      throw error;
    }
    if (
      nodes + cost.nodes > budget.limits.maxNodes ||
      stringLength + cost.stringLength > budget.limits.maxTotalStringLength
    ) {
      break;
    }
    nodes += cost.nodes;
    stringLength += cost.stringLength;
    count += 1;
  }
  return { count, spent: { nodes, stringLength } };
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
  /** Provider identity for each withheld tool; repeated identities count distinct tool failures. */
  upstreamToolAdmissionTimeouts?: readonly string[];
  /** Cut responses to fit these limits; without it, a non-paginated walk returns every item. */
  responseBudget?: CapabilityResponseBudget<T>;
}): Promise<CapabilityPaginationResult<T>> {
  const providers = [...options.providers].sort(
    (left, right) => compareCodePoints(left.name, right.name) || compareCodePoints(left.id, right.id),
  );
  const admissionTimeouts = options.upstreamToolAdmissionTimeouts ?? [];
  const generation = observeGeneration(options.connections, options.kind, {
    providers: providers.map(({ id, name }) => ({ id, name })),
    extra: options.extraGenerationSignature,
    admissionTimeouts,
  });
  const filter = digest({ selection: options.filterSelection, enablePagination: options.enablePagination });
  const runtimeNonce = getRuntimeState(options.connections).nonce;
  const scope = digest([runtimeNonce, options.kind, filter]);
  let providerIndex = 0;
  let upstreamCursor: string | undefined;
  let itemOffset = 0;
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
    itemOffset = cursor.o ?? 0;
    failures = decodeFailurePositions(cursor.x, providers.length);
  }

  const cursorAt = (position: number, upstream: string | undefined, offset: number): string | undefined =>
    position < providers.length
      ? encodeCursor(
          {
            v: 2,
            e: expiresAt,
            k: options.kind,
            g: generation,
            f: filter,
            p: createHmac('sha256', cursorSecret).update(providers[position].id).digest('base64url'),
            u: upstream,
            ...(offset > 0 ? { o: offset } : {}),
            x: encodeFailurePositions(failures, providers.length),
          },
          scope,
          runtimeNonce,
        )
      : undefined;
  const budget = options.responseBudget;

  if (!options.enablePagination && budget) {
    // Return as many items as fit, then continue from the exact item where this response stopped.
    const items: T[] = [];
    let spent = RESPONSE_ENVELOPE_RESERVE;
    for (; providerIndex < providers.length; providerIndex += 1, upstreamCursor = undefined, itemOffset = 0) {
      const provider = providers[providerIndex];
      try {
        let pages = 0;
        const seenCursors = new Set<string>();
        for (;;) {
          const page = await provider.list(upstreamCursor);
          if (itemOffset > page.items.length) invalidCursor('malformed');
          const remaining = page.items.slice(itemOffset);
          const taken = takeWithinBudget(remaining, budget, spent);
          const count = taken.count;
          if (count < remaining.length) {
            if (items.length === 0 && count === 0) throw new CapabilityResponseBudgetError();
            items.push(...remaining.slice(0, count));
            return {
              items,
              nextCursor: cursorAt(providerIndex, upstreamCursor, itemOffset + count),
              _meta: partialMeta(failures, generation, providers, admissionTimeouts),
            };
          }
          items.push(...remaining);
          spent = taken.spent;
          itemOffset = 0;
          upstreamCursor = page.nextCursor;
          pages += 1;
          if (upstreamCursor === undefined) break;
          if (seenCursors.has(upstreamCursor) || pages >= MAX_DISABLED_PAGINATION_PAGES) {
            throw new Error('Upstream pagination did not terminate');
          }
          seenCursors.add(upstreamCursor);
        }
      } catch (error) {
        if (abortsWalk(error)) throw error;
        if (!failures.includes(providerIndex)) failures.push(providerIndex);
      }
    }
    if (
      options.cursor === undefined &&
      providers.length > 0 &&
      failures.length === providers.length &&
      items.length === 0
    ) {
      throw new CapabilityProvidersUnavailableError(partialMeta(failures, generation, providers, admissionTimeouts));
    }
    return { items, _meta: partialMeta(failures, generation, providers, admissionTimeouts) };
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
      throw new CapabilityProvidersUnavailableError(partialMeta(failures, generation, providers, admissionTimeouts));
    }
    return { items, _meta: partialMeta(failures, generation, providers, admissionTimeouts) };
  }

  while (providerIndex < providers.length) {
    const provider = providers[providerIndex];
    try {
      const page = await provider.list(upstreamCursor);
      if (itemOffset > page.items.length) invalidCursor('malformed');
      const remaining = itemOffset === 0 ? page.items : page.items.slice(itemOffset);
      const count = budget ? takeWithinBudget(remaining, budget, RESPONSE_ENVELOPE_RESERVE).count : remaining.length;
      if (count === 0 && remaining.length > 0) throw new CapabilityResponseBudgetError();
      const nextCursor =
        count < remaining.length
          ? cursorAt(providerIndex, upstreamCursor, itemOffset + count)
          : cursorAt(page.nextCursor !== undefined ? providerIndex : providerIndex + 1, page.nextCursor, 0);

      if (remaining.length > 0 || page.nextCursor !== undefined) {
        return {
          items: count === remaining.length ? remaining : remaining.slice(0, count),
          nextCursor,
          _meta: partialMeta(failures, generation, providers, admissionTimeouts),
        };
      }
      providerIndex += 1;
      upstreamCursor = undefined;
      itemOffset = 0;
    } catch (error) {
      if (abortsWalk(error)) throw error;
      if (!failures.includes(providerIndex)) failures.push(providerIndex);
      providerIndex += 1;
      upstreamCursor = undefined;
      itemOffset = 0;
    }
  }

  if (options.cursor === undefined && providers.length > 0 && failures.length === providers.length) {
    throw new CapabilityProvidersUnavailableError(partialMeta(failures, generation, providers, admissionTimeouts));
  }
  return { items: [], _meta: partialMeta(failures, generation, providers, admissionTimeouts) };
}
