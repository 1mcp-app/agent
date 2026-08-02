import { sanitizeBackendLogContent } from './backendLogSanitizer.js';
import type {
  BackendLogEntry,
  BackendLogPublishInput,
  BackendLogReplay,
  BackendLogSnapshot,
  BackendLogSource,
  BackendLogSourceUpdate,
} from './backendLogTypes.js';

const DEFAULT_PER_SOURCE_BYTES = 1024 * 1024;
const DEFAULT_GLOBAL_BYTES = 32 * 1024 * 1024;
const DEFAULT_SUBSCRIBER_QUEUE_BYTES = 256 * 1024;

interface RetainedEntry {
  readonly entry: BackendLogEntry;
  readonly bytes: number;
  evicted: boolean;
}

interface Subscriber {
  readonly onEvent: (entry: BackendLogEntry) => void;
  readonly onSourceUpdate?: (update: BackendLogSourceUpdate) => void;
  readonly onDisconnect?: (reason: 'slow-subscriber') => void;
  queue: Array<
    | { readonly kind: 'entry'; readonly retained: RetainedEntry; readonly bytes: number }
    | { readonly kind: 'source'; readonly update: BackendLogSourceUpdate; readonly bytes: number }
  >;
  queuedBytes: number;
  immediate: ReturnType<typeof setImmediate> | null;
  closed: boolean;
}

export interface BackendLogBrokerOptions {
  readonly perSourceBytes?: number;
  readonly globalBytes?: number;
  readonly subscriberQueueBytes?: number;
  readonly now?: () => Date;
  readonly measureEntry?: (entry: BackendLogEntry) => number;
}

export class BackendLogBroker {
  private readonly perSourceBytes: number;
  private readonly globalBytesLimit: number;
  private readonly subscriberQueueBytes: number;
  private readonly now: () => Date;
  private readonly measureEntry: (entry: BackendLogEntry) => number;
  private readonly sources = new Map<string, BackendLogSource>();
  private readonly retainedBySource = new Map<string, RetainedEntry[]>();
  private readonly retainedGlobal: RetainedEntry[] = [];
  private retainedGlobalHead = 0;
  private readonly subscribers = new Set<Subscriber>();
  private nextSequence = 1;
  private globalBytes = 0;

  constructor(options: BackendLogBrokerOptions = {}) {
    this.perSourceBytes = options.perSourceBytes ?? DEFAULT_PER_SOURCE_BYTES;
    this.globalBytesLimit = options.globalBytes ?? DEFAULT_GLOBAL_BYTES;
    this.subscriberQueueBytes = options.subscriberQueueBytes ?? DEFAULT_SUBSCRIBER_QUEUE_BYTES;
    this.now = options.now ?? (() => new Date());
    this.measureEntry = options.measureEntry ?? ((entry) => Buffer.byteLength(JSON.stringify(entry)));
  }

  registerSource(source: BackendLogSource): void {
    const current = this.sources.get(source.id);
    this.sources.set(source.id, current ? { ...current, ...source } : source);
    this.enqueueSourceUpdate({ sourceId: source.id, source: this.sources.get(source.id), removed: false });
  }

  updateSource(sourceId: string, update: Partial<Pick<BackendLogSource, 'capture' | 'lifecycle'>>): void {
    const source = this.sources.get(sourceId);
    if (!source) return;
    this.sources.set(sourceId, { ...source, ...update });
    this.enqueueSourceUpdate({ sourceId, source: this.sources.get(sourceId), removed: false });
    this.removeEndedSourceWithoutHistory(sourceId);
  }

  publish(input: BackendLogPublishInput): BackendLogEntry {
    const source = this.sources.get(input.sourceId);
    if (!source) throw new Error(`Backend log source is not registered: ${input.sourceId}`);
    if (source.capture !== 'managed') throw new Error(`Backend log source is not captured: ${input.sourceId}`);

    const entry: BackendLogEntry = {
      sequence: this.nextSequence++,
      timestamp: this.now().toISOString(),
      sourceId: source.id,
      canonicalName: source.canonicalName,
      displayName: source.displayName,
      sourceKind: source.kind,
      kind: input.kind,
      content: sanitizeBackendLogContent(input.content),
      ...(input.count === undefined ? {} : { count: input.count }),
      truncated: input.truncated ?? false,
    };
    const retained = { entry, bytes: Math.max(1, this.measureEntry(entry)), evicted: false };
    const sourceEntries = this.retainedBySource.get(source.id) ?? [];
    sourceEntries.push(retained);
    this.retainedBySource.set(source.id, sourceEntries);
    this.retainedGlobal.push(retained);
    this.globalBytes += retained.bytes;
    this.evictSource(source.id);
    this.evictGlobal();
    this.enqueueForSubscribers(retained);
    return entry;
  }

  snapshot(): BackendLogSnapshot {
    return {
      sequence: this.nextSequence - 1,
      sources: [...this.sources.values()].sort((left, right) => left.id.localeCompare(right.id)),
      entries: this.retainedEntries().map(({ entry }) => entry),
    };
  }

  replayAfter(sequence: number): BackendLogReplay {
    const entries = this.retainedEntries();
    const oldestSequence = entries[0]?.entry.sequence;
    if (
      (oldestSequence !== undefined && sequence < oldestSequence - 1) ||
      (oldestSequence === undefined && sequence < this.nextSequence - 1)
    ) {
      return { kind: 'gap', snapshot: this.snapshot() };
    }
    return {
      kind: 'replay',
      entries: entries.filter(({ entry }) => entry.sequence > sequence).map(({ entry }) => entry),
    };
  }

  subscribe(input: {
    onEvent: (entry: BackendLogEntry) => void;
    onSourceUpdate?: (update: BackendLogSourceUpdate) => void;
    onDisconnect?: (reason: 'slow-subscriber') => void;
  }): () => void {
    const subscriber: Subscriber = { ...input, queue: [], queuedBytes: 0, immediate: null, closed: false };
    this.subscribers.add(subscriber);
    return () => this.closeSubscriber(subscriber);
  }

  clear(): void {
    for (const subscriber of this.subscribers) this.closeSubscriber(subscriber);
    this.sources.clear();
    this.retainedBySource.clear();
    this.retainedGlobal.length = 0;
    this.retainedGlobalHead = 0;
    this.globalBytes = 0;
    this.nextSequence = 1;
  }

  private retainedEntries(): RetainedEntry[] {
    return this.retainedGlobal.slice(this.retainedGlobalHead).filter((retained) => !retained.evicted);
  }

  private evictSource(sourceId: string): void {
    const entries = this.retainedBySource.get(sourceId);
    if (!entries) return;
    let bytes = entries.reduce((total, retained) => total + retained.bytes, 0);
    while (entries.length > 0 && bytes > this.perSourceBytes) {
      const evicted = entries.shift()!;
      evicted.evicted = true;
      bytes -= evicted.bytes;
      this.globalBytes -= evicted.bytes;
    }
    if (entries.length === 0) this.retainedBySource.delete(sourceId);
    this.removeEndedSourceWithoutHistory(sourceId);
  }

  private evictGlobal(): void {
    while (this.retainedGlobal[this.retainedGlobalHead]?.evicted) this.retainedGlobalHead++;
    while (this.globalBytes > this.globalBytesLimit) {
      const oldest = this.retainedGlobal[this.retainedGlobalHead++];
      if (!oldest) break;
      const entries = this.retainedBySource.get(oldest.entry.sourceId)!;
      if (entries[0] === oldest) entries.shift();
      else entries.splice(entries.indexOf(oldest), 1);
      oldest.evicted = true;
      this.globalBytes -= oldest.bytes;
      if (entries.length === 0) this.retainedBySource.delete(oldest.entry.sourceId);
      this.removeEndedSourceWithoutHistory(oldest.entry.sourceId);
      while (this.retainedGlobal[this.retainedGlobalHead]?.evicted) this.retainedGlobalHead++;
    }
    this.compactGlobalQueue();
  }

  private compactGlobalQueue(): void {
    if (this.retainedGlobalHead < 1024 || this.retainedGlobalHead * 2 < this.retainedGlobal.length) return;
    this.retainedGlobal.splice(0, this.retainedGlobalHead);
    this.retainedGlobalHead = 0;
  }

  private removeEndedSourceWithoutHistory(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (source?.kind === 'template' && source.lifecycle === 'ended' && !this.retainedBySource.has(sourceId)) {
      this.sources.delete(sourceId);
      this.enqueueSourceUpdate({ sourceId, removed: true });
    }
  }

  private enqueueForSubscribers(retained: RetainedEntry): void {
    for (const subscriber of [...this.subscribers]) {
      this.enqueueSubscriberEvent(subscriber, { kind: 'entry', retained, bytes: retained.bytes });
    }
  }

  private enqueueSourceUpdate(update: BackendLogSourceUpdate): void {
    const bytes = Buffer.byteLength(JSON.stringify(update));
    for (const subscriber of [...this.subscribers]) {
      this.enqueueSubscriberEvent(subscriber, { kind: 'source', update, bytes });
    }
  }

  private enqueueSubscriberEvent(subscriber: Subscriber, event: Subscriber['queue'][number]): void {
    subscriber.queue.push(event);
    subscriber.queuedBytes += event.bytes;
    if (subscriber.queuedBytes > this.subscriberQueueBytes) {
      this.closeSubscriber(subscriber);
      if (subscriber.onDisconnect) {
        const notify = subscriber.onDisconnect;
        const immediate = setImmediate(() => notify('slow-subscriber'));
        immediate.unref?.();
      }
      return;
    }
    if (subscriber.immediate) return;
    subscriber.immediate = setImmediate(() => this.flushSubscriber(subscriber));
    subscriber.immediate.unref?.();
  }

  private flushSubscriber(subscriber: Subscriber): void {
    subscriber.immediate = null;
    if (subscriber.closed) return;
    const queued = subscriber.queue;
    subscriber.queue = [];
    subscriber.queuedBytes = 0;
    for (const event of queued) {
      if (event.kind === 'entry') subscriber.onEvent(event.retained.entry);
      else subscriber.onSourceUpdate?.(event.update);
    }
  }

  private closeSubscriber(subscriber: Subscriber): void {
    if (subscriber.closed) return;
    subscriber.closed = true;
    if (subscriber.immediate) clearImmediate(subscriber.immediate);
    subscriber.immediate = null;
    subscriber.queue = [];
    subscriber.queuedBytes = 0;
    this.subscribers.delete(subscriber);
  }
}
