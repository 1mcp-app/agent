import type { Client } from '@modelcontextprotocol/client';

import { OneMcpProtocolError } from '@src/sdk/contracts/index.js';

import type { AuthProviderTransport } from './legacyTransport.js';

export interface ModernSubscriptionFilter {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  resourceSubscriptions?: string[];
}
export interface ModernSubscriptionNotification {
  method: string;
  params?: Record<string, unknown>;
}
export interface ModernSubscriptionHandle {
  honoredFilter: ModernSubscriptionFilter;
  close(): Promise<void>;
}
const subscriptionIdKey = 'io.modelcontextprotocol/subscriptionId';
const maxSubscriptions = 1024;
const maxSetupNotifications = 64;
let activeSubscriptions = 0;
interface Entry {
  id?: string | number;
  ready: boolean;
  stopped: boolean;
  filter: ModernSubscriptionFilter;
  pending: ModernSubscriptionNotification[];
  notify: (notification: ModernSubscriptionNotification) => void;
  stop: () => void;
  cancel: () => void;
}
interface State {
  client: Client;
  entries: Map<string | number, Entry>;
  opening?: Entry;
  coverage: (filter: ModernSubscriptionFilter) => Promise<ModernSubscriptionFilter>;
}
const states = new WeakMap<object, State>();

/** Keep the SDK-owned listen id inside the adapter boundary, before SDK ack demultiplexing. */
export function registerModernSubscriptions(
  connection: object,
  client: Client,
  transport: AuthProviderTransport,
  coverage: State['coverage'],
): void {
  if (states.has(connection)) return;
  const state: State = { client, entries: new Map(), coverage };
  states.set(connection, state);
  const send = transport.send.bind(transport);
  transport.send = (message, options) => {
    if ('method' in message && message.method === 'subscriptions/listen' && 'id' in message && state.opening) {
      state.opening.id = message.id;
      state.entries.set(message.id, state.opening);
    }
    return send(message, options);
  };
  const receive = transport.onmessage;
  transport.onmessage = (message, extra) => {
    if ('method' in message && message.method !== 'notifications/subscriptions/acknowledged') {
      const id = message.params?._meta?.[subscriptionIdKey];
      const entry = typeof id === 'string' || typeof id === 'number' ? state.entries.get(id) : undefined;
      if (entry && !entry.stopped) {
        if (!accepts(entry.filter, message.method, message.params?.uri)) {
          receive?.(message, extra);
          return;
        }
        if (JSON.stringify(message).length > 65536) {
          entry.stop();
          receive?.(message, extra);
          return;
        }
        const note = { method: message.method, params: message.params };
        if (entry.ready) entry.notify(note);
        else if (entry.pending.length < maxSetupNotifications) entry.pending.push(note);
        else entry.stop();
      }
    }
    receive?.(message, extra);
  };
}

export function ensureModernSubscriptionCoverage(
  connection: object,
  filter: ModernSubscriptionFilter,
): Promise<ModernSubscriptionFilter> {
  return states.get(connection)?.coverage(filter) ?? Promise.resolve(filter);
}

export async function openModernSubscription(
  connection: object,
  filter: ModernSubscriptionFilter,
  onNotification: (notification: ModernSubscriptionNotification) => void,
  onClose: () => void,
  signal?: AbortSignal,
): Promise<ModernSubscriptionHandle> {
  const state = states.get(connection);
  if (!state) throw new OneMcpProtocolError(-32601, 'Modern subscriptions are unavailable');
  signal?.throwIfAborted();
  if (activeSubscriptions >= maxSubscriptions)
    throw new OneMcpProtocolError(-32000, 'Subscription admission exhausted');
  if (
    (filter.resourceSubscriptions?.length ?? 0) > 64 ||
    filter.resourceSubscriptions?.some((uri) => uri.length > 8192)
  )
    throw new OneMcpProtocolError(-32602, 'Subscription filter exceeds resource bounds');
  activeSubscriptions++;
  const controller = new AbortController();
  let handle: Awaited<ReturnType<Client['listen']>> | undefined;
  let localClose = false;
  const finish = () => {
    if (entry.stopped) return;
    entry.stopped = true;
    entry.pending.length = 0;
    if (entry.id !== undefined) state.entries.delete(entry.id);
    activeSubscriptions--;
    signal?.removeEventListener('abort', abort);
    controller.abort();
    if (!localClose) {
      try {
        onClose();
      } catch {
        /* Owner teardown must not interrupt SDK delivery. */
      }
    }
  };
  const abort = () => {
    localClose = true;
    finish();
  };
  const entry: Entry = {
    ready: false,
    stopped: false,
    filter,
    pending: [],
    notify: (notification) => {
      try {
        onNotification(notification);
      } catch {
        finish();
      }
    },
    stop: finish,
    cancel: abort,
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    // The pinned SDK dispatches the listen request synchronously before its first await.
    state.opening = entry;
    const opening = state.client.listen(filter, { signal: controller.signal, timeout: 10_000 });
    state.opening = undefined;
    handle = await opening;
    if (entry.id === undefined) throw new OneMcpProtocolError(-32603, 'Subscription stream id was not captured');
    if (entry.stopped) {
      await handle.close();
      throw new OneMcpProtocolError(-32603, 'Subscription ended during setup');
    }
    void handle.closed.then(finish, finish);
    entry.filter = handle.honoredFilter;
    entry.ready = true;
    for (const note of entry.pending.splice(0)) {
      if (entry.stopped) break;
      if (accepts(entry.filter, note.method, note.params?.uri)) entry.notify(note);
    }
    return {
      honoredFilter: handle.honoredFilter,
      close: async () => {
        localClose = true;
        finish();
        await handle?.close();
      },
    };
  } catch (error) {
    state.opening = undefined;
    localClose = true;
    finish();
    await handle?.close();
    throw error;
  }
}

function accepts(filter: ModernSubscriptionFilter, method: string, uri: unknown): boolean {
  switch (method) {
    case 'notifications/tools/list_changed':
      return filter.toolsListChanged === true;
    case 'notifications/prompts/list_changed':
      return filter.promptsListChanged === true;
    case 'notifications/resources/list_changed':
      return filter.resourcesListChanged === true;
    case 'notifications/resources/updated':
      return typeof uri === 'string' && filter.resourceSubscriptions?.includes(uri) === true;
    default:
      return false;
  }
}

export function rebindModernSubscriptionTransport(connection: object, transport: AuthProviderTransport): void {
  const state = states.get(connection);
  if (!state) return;
  for (const entry of state.entries.values()) entry.stop();
  states.delete(connection);
  registerModernSubscriptions(connection, state.client, transport, state.coverage);
}

export function closeModernSubscriptions(connection: object): void {
  for (const entry of states.get(connection)?.entries.values() ?? []) entry.cancel();
}
