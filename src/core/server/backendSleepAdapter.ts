import { requestLegacyAdapter } from '@src/core/client/legacyAdapterRequest.js';
import { createLegacyTimeoutMs, ErrorCode, OneMcpProtocolError } from '@src/sdk/contracts/index.js';
import type {
  JsonObject,
  JsonValue,
  LegacyRequestId,
  LegacySdkAdapter,
  LegacySdkEvent,
  LegacySdkNotification,
  LegacySdkRequest,
  LegacySdkResponse,
} from '@src/sdk/contracts/index.js';

import { BACKEND_DISCOVERY_METHODS, BackendSleep } from './backendSleep.js';

/** Stable discovery identity; the Capability Catalog still owns visibility and routes. */
export class BackendSleepAdapter implements LegacySdkAdapter {
  initialization?: Promise<void>;
  private readonly callers = new Map<LegacyRequestId, { controller: AbortController; dispatched?: LegacySdkAdapter }>();
  private dispatchTail: Promise<void> = Promise.resolve();
  private cache = new Map<string, JsonValue>();

  private delegate: LegacySdkAdapter;
  private readonly events: LegacySdkEvent[] = [];
  private readonly eventWaiters: Array<(event: LegacySdkEvent) => void> = [];

  constructor(
    current: LegacySdkAdapter,
    readonly lifecycle: BackendSleep,
  ) {
    this.delegate = current;
    void this.pump(current);
  }

  get current(): LegacySdkAdapter {
    return this.delegate;
  }
  set current(adapter: LegacySdkAdapter) {
    this.delegate = adapter;
    void this.pump(adapter);
  }

  async acquireDispatch(signal?: AbortSignal): Promise<() => void> {
    if (this.protocol?.era === 'modern') return () => undefined;
    const previous = this.dispatchTail;
    let release!: () => void;
    this.dispatchTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      if (signal?.aborted) throw new Error('Request cancelled');
      if (!signal) await previous;
      else
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(new Error('Request cancelled'));
          signal.addEventListener('abort', abort, { once: true });
          void previous.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
      if (signal?.aborted) throw new Error('Request cancelled');
      return release;
    } catch (error) {
      void previous.finally(release);
      throw error;
    }
  }

  private async pump(adapter: LegacySdkAdapter): Promise<void> {
    while (this.delegate === adapter) {
      const event = await adapter.nextEvent();
      if (this.delegate !== adapter) return;
      if (event.type === 'closed' && this.lifecycle.snapshot().state !== 'awake') return;
      const waiter = this.eventWaiters.shift();
      if (waiter) waiter(event);
      else this.events.push(event);
      if (event.type === 'closed') return;
    }
  }

  get connectionId() {
    return this.current.connectionId;
  }
  get protocol() {
    return this.current.protocol;
  }
  get protocolRevision() {
    return this.current.protocolRevision;
  }
  get state() {
    return this.current.state;
  }
  start() {
    return this.current.start();
  }
  nextEvent(): Promise<LegacySdkEvent> {
    const event = this.events.shift();
    return event ? Promise.resolve(event) : new Promise((resolve) => this.eventWaiters.push(resolve));
  }
  respond(response: LegacySdkResponse) {
    return this.current.respond(response);
  }
  async cancel(id: LegacyRequestId): Promise<void> {
    const caller = this.callers.get(id);
    if (!caller) return;
    caller.controller.abort();
    await caller.dispatched?.cancel(id);
  }
  notify(notification: LegacySdkNotification) {
    return this.current.notify(notification);
  }
  close() {
    this.lifecycle.stop();
    return this.current.close();
  }

  async refresh(capabilities: JsonObject, deadline = Date.now() + 60_000, signal?: AbortSignal): Promise<string[]> {
    signal?.throwIfAborted();
    const next = new Map<string, JsonValue>();
    const methods = [
      ...(capabilities.tools ? ['tools/list'] : []),
      ...(capabilities.prompts ? ['prompts/list'] : []),
      ...(capabilities.resources ? ['resources/list', 'resources/templates/list'] : []),
    ];
    for (const method of methods) {
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const params = cursor ? { cursor } : undefined;
        if (Date.now() >= deadline) throw new Error('Backend capability refresh deadline exceeded');
        const result = await requestLegacyAdapter(this.current, method, params, {
          timeoutMs: Math.max(1, deadline - Date.now()),
          signal,
        }).catch((error: unknown) => {
          if (
            method === 'resources/templates/list' &&
            error instanceof OneMcpProtocolError &&
            error.code === ErrorCode.MethodNotFound
          ) {
            return { resourceTemplates: [] };
          }
          throw error;
        });
        next.set(this.key(method, params), structuredClone(result));
        const value = result as JsonObject;
        cursor = typeof value.nextCursor === 'string' ? value.nextCursor : undefined;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 1000) throw new Error('Invalid backend capability pagination');
          seen.add(cursor);
        }
      } while (cursor);
    }
    const changed = [...BACKEND_DISCOVERY_METHODS].filter((method) => {
      const pages = (cache: Map<string, JsonValue>) =>
        [...cache].filter(([key]) => (JSON.parse(key) as unknown[])[0] === method);
      return JSON.stringify(pages(this.cache)) !== JSON.stringify(pages(next));
    });
    signal?.throwIfAborted();
    this.cache = next;
    return changed;
  }

  async request(request: LegacySdkRequest): Promise<JsonValue> {
    const controller = new AbortController();
    const caller: { controller: AbortController; dispatched?: LegacySdkAdapter } = { controller };
    this.callers.set(request.id, caller);
    const expiresAt = request.timeoutMs === undefined ? undefined : Date.now() + request.timeoutMs;
    const deadline = request.timeoutMs ? setTimeout(() => controller.abort(), request.timeoutMs) : undefined;
    const remainingRequest = (): LegacySdkRequest => {
      if (expiresAt === undefined) return request;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) throw new Error('Request deadline exceeded');
      return { ...request, timeoutMs: createLegacyTimeoutMs(remaining) };
    };
    const dispatch = async (): Promise<JsonValue> => {
      if (controller.signal.aborted) throw new Error('Request cancelled or deadline exceeded');
      const outgoing = remainingRequest();
      let abort!: () => void;
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error('Request cancelled or deadline exceeded'));
        controller.signal.addEventListener('abort', abort, { once: true });
      });
      caller.dispatched = this.current;
      try {
        // The concrete adapter retains upstream lifetime tracking after this caller leaves.
        return await Promise.race([this.current.request(outgoing), cancelled]);
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
    };
    try {
      await this.initialization;
      if (controller.signal.aborted) throw new Error('Request cancelled or deadline exceeded');
      if (BACKEND_DISCOVERY_METHODS.has(request.method)) {
        const cached = this.cache.get(this.key(request.method, request.params));
        if (this.lifecycle.snapshot().state !== 'awake') {
          if (cached !== undefined) return structuredClone(cached);
          throw new OneMcpProtocolError(
            ErrorCode.InvalidParams,
            'Cached capability page unavailable; restart discovery',
          );
        }
        if (this.lifecycle.snapshot().state === 'awake') {
          const result = await dispatch();
          this.cache.set(this.key(request.method, request.params), structuredClone(result));
          return result;
        }
      }
      const contract = this.operationContract(request);
      await this.lifecycle.ensureAwake(controller.signal);
      if (contract !== this.operationContract(request))
        throw new Error('Backend operation contract changed after wake; inspect capabilities again');
      if (controller.signal.aborted) throw new Error('Request cancelled or deadline exceeded');
      return await dispatch();
    } finally {
      if (deadline) clearTimeout(deadline);
      this.callers.delete(request.id);
    }
  }

  private operationContract(request: LegacySdkRequest): string | undefined {
    let method: string;
    let field: string;
    if (request.method === 'tools/call') {
      method = 'tools/list';
      field = 'tools';
    } else if (request.method === 'prompts/get') {
      method = 'prompts/list';
      field = 'prompts';
    } else {
      return undefined;
    }
    const params = request.params as JsonObject | undefined;
    for (const [key, value] of this.cache) {
      if ((JSON.parse(key) as unknown[])[0] !== method) continue;
      const items = (value as JsonObject)[field];
      if (!Array.isArray(items)) continue;
      const found = items.find(
        (item) => item && typeof item === 'object' && !Array.isArray(item) && item.name === params?.name,
      );
      if (found) return JSON.stringify(found);
    }
    return undefined;
  }

  private key(method: string, params?: JsonValue): string {
    const cursor = params && typeof params === 'object' && !Array.isArray(params) ? params.cursor : undefined;
    return JSON.stringify([method, cursor]);
  }
}

export function unwrapBackendSleepAdapter(adapter: LegacySdkAdapter): LegacySdkAdapter {
  return adapter instanceof BackendSleepAdapter ? adapter.current : adapter;
}

export async function prepareBackendOperation(adapter: LegacySdkAdapter, signal?: AbortSignal): Promise<() => void> {
  if (!(adapter instanceof BackendSleepAdapter)) return () => undefined;
  const release = adapter.lifecycle.reserve();
  try {
    await adapter.initialization;
    await adapter.lifecycle.ensureAwake(signal);
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export async function refreshBackendDiscovery(
  adapter: LegacySdkAdapter,
  capabilities: JsonObject,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (!(adapter instanceof BackendSleepAdapter)) return;
  const release = await prepareBackendOperation(adapter, signal);
  try {
    signal?.throwIfAborted();
    await adapter.refresh(capabilities, undefined, signal);
    signal?.throwIfAborted();
  } finally {
    release();
  }
}

export async function acquireBackendDispatch(adapter: LegacySdkAdapter, signal?: AbortSignal): Promise<() => void> {
  return adapter instanceof BackendSleepAdapter ? adapter.acquireDispatch(signal) : () => undefined;
}
