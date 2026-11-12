export class BackendReleaseError extends Error {}

export const BACKEND_DISCOVERY_METHODS = new Set([
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
]);

export interface BackendSleepSnapshot {
  state: 'initializing' | 'awake' | 'releasing' | 'sleeping' | 'waking' | 'wake-failed' | 'release-failed' | 'stopped';
  lastActivityAt: number | null;
  idleTimeoutMs: number;
  blockers: string[];
  failure?: string;
  retryAt?: number;
}

interface BackendSleepOptions {
  idleTimeoutMs?: number;
  release: () => Promise<void>;
  wake: () => Promise<void>;
  isCurrent: () => boolean;
  ownershipBlocker?: () => string | undefined;
  onChange?: (snapshot: BackendSleepSnapshot) => void;
}

/** Owns one static backend's intentional release and replacement, independently of crash recovery. */
export class BackendSleep {
  private state: BackendSleepSnapshot['state'] = 'initializing';
  private lastActivityAt: number | null = null;
  private readonly timer: ReturnType<typeof setInterval>;
  private transition?: Promise<void>;
  private failure?: string;
  private retryAt?: number;
  private idleTimeoutMs: number;
  private uncertain = false;
  private discoveryFailed = false;
  private releaseUncertain = false;
  private reservations = 0;
  private needsIdleReset = false;
  private readonly subscriptions = new Set<string>();
  private readonly tasks = new Set<string>();
  private readonly pending = new Map<string | number, { method: string; params?: Record<string, unknown> }>();

  constructor(private readonly options: BackendSleepOptions) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? 300_000;
    this.timer = setInterval(() => void this.checkIdle(), 30_000);
    this.timer.unref?.();
  }

  ready(): void {
    this.state = 'awake';
    this.lastActivityAt = Date.now();
    this.publish();
  }

  keepAwakeAfterDiscoveryFailure(error: unknown): void {
    this.discoveryFailed = true;
    this.failure = error instanceof Error ? error.message : 'Backend capability discovery failed';
    this.ready();
  }

  reserve(): () => void {
    this.assertCurrent();
    this.reservations++;
    this.needsIdleReset = true;
    this.publish();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reservations--;
      this.completed();
    };
  }

  sent(message: { id?: string | number; method?: string; params?: Record<string, unknown> }): void {
    if (message.id === undefined || !message.method) return;
    if (message.method === 'subscriptions/listen') {
      const notifications = message.params?.notifications;
      if (notifications && typeof notifications === 'object' && !('resourceSubscriptions' in notifications)) return;
    }
    if (!BACKEND_DISCOVERY_METHODS.has(message.method)) this.needsIdleReset = true;
    if (this.pending.has(message.id)) this.uncertain = true;
    this.pending.set(message.id, { method: message.method, params: message.params });
    this.publish();
  }

  received(message: {
    id?: string | number;
    result?: unknown;
    error?: unknown;
    method?: string;
    params?: Record<string, unknown>;
  }): void {
    if (message.method === 'notifications/cancelled') {
      const id = message.params?.requestId;
      if (typeof id !== 'string') return;
      if (this.pending.get(id)?.method !== 'subscriptions/listen') return;
      // The modern SDK treats this incoming event as terminal for that listen stream.
      this.pending.delete(id);
      this.completed();
      return;
    }
    if (message.method === 'notifications/tasks/status') {
      this.needsIdleReset = true;
      this.observeTask(message.params);
      this.completed();
      return;
    }
    if (message.method || message.id === undefined) return;
    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);
    if (message.error === undefined) {
      const uri = request.params?.uri;
      if (request.method === 'resources/subscribe' && typeof uri === 'string') this.subscriptions.add(uri);
      if (request.method === 'resources/unsubscribe' && typeof uri === 'string') this.subscriptions.delete(uri);
      const result = message.result as Record<string, unknown> | undefined;
      this.observeTask(result?.task ?? (request.method === 'tasks/get' ? result : undefined));
    }
    this.completed();
  }

  private observeTask(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const task = value as Record<string, unknown>;
    if (typeof task.taskId !== 'string') return;
    if (['completed', 'failed', 'cancelled'].includes(String(task.status))) this.tasks.delete(task.taskId);
    else this.tasks.add(task.taskId);
  }

  private completed(): void {
    if (this.needsIdleReset && this.snapshot().blockers.length === 0) {
      this.lastActivityAt = Date.now();
      this.needsIdleReset = false;
    }
    this.publish();
  }

  snapshot(): BackendSleepSnapshot {
    const ownership = this.state === 'awake' ? this.options.ownershipBlocker?.() : undefined;
    return {
      state: this.state,
      lastActivityAt: this.lastActivityAt,
      idleTimeoutMs: this.idleTimeoutMs,
      blockers: [
        ...(this.reservations ? [`admissions:${this.reservations}`] : []),
        ...(this.uncertain ? ['uncertain-completion'] : []),
        ...(this.discoveryFailed ? ['capability-discovery-failed'] : []),
        ...(ownership ? [ownership] : []),
        ...(this.pending.size ? [`requests:${this.pending.size}`] : []),
        ...(this.subscriptions.size ? [`subscriptions:${this.subscriptions.size}`] : []),
        ...(this.tasks.size ? [`tasks:${this.tasks.size}`] : []),
      ],
      ...(this.failure ? { failure: this.failure } : {}),
      ...(this.retryAt ? { retryAt: this.retryAt } : {}),
    };
  }

  async ensureAwake(signal?: AbortSignal): Promise<void> {
    this.assertCurrent(signal);
    if (this.state === 'releasing') await this.waitForTransition(signal);
    this.assertCurrent(signal);
    if (this.state === 'release-failed') throw new Error('Backend release failed; ownership is uncertain');
    if (this.state === 'awake') return;
    if (this.state === 'initializing') throw new Error('Backend capability discovery has not completed');
    if (this.retryAt !== undefined && Date.now() < this.retryAt) throw new Error('Backend wake cooldown is active');
    if (!this.transition) {
      this.state = 'waking';
      this.publish();
      this.transition = this.options
        .wake()
        .then(() => {
          this.assertCurrent();
          this.failure = undefined;
          this.retryAt = undefined;
          this.ready();
        })
        .catch((error: unknown) => {
          if (error instanceof BackendReleaseError) this.releaseUncertain = true;
          if (this.state !== 'stopped') {
            this.state = this.releaseUncertain ? 'release-failed' : 'wake-failed';
            this.failure = error instanceof Error ? error.message : String(error);
            this.retryAt = Date.now() + 30_000;
            this.publish();
          }
          throw error;
        })
        .finally(() => {
          this.transition = undefined;
        });
    }
    await this.waitForTransition(signal);
    this.assertCurrent(signal);
  }

  private async waitForTransition(signal?: AbortSignal): Promise<void> {
    if (!signal) return this.transition;
    if (signal.aborted) throw new Error('Request cancelled');
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Request cancelled'));
      signal.addEventListener('abort', abort, { once: true });
      void this.transition?.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  sessionReleased(): void {
    this.pending.clear();
    this.subscriptions.clear();
    this.tasks.clear();
    this.uncertain = false;
  }

  private assertCurrent(signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('Request cancelled');
    if (this.state === 'stopped' || !this.options.isCurrent()) throw new Error('Backend removed or replaced');
  }

  async retire(): Promise<void> {
    const failedRelease = this.state === 'release-failed';
    this.stop();
    await this.transition?.catch(() => undefined);
    if (this.releaseUncertain || failedRelease || this.failure?.startsWith('Release:'))
      throw new BackendReleaseError('Backend release remains uncertain');
  }

  stop(): void {
    clearInterval(this.timer);
    this.state = 'stopped';
    this.publish();
  }

  private async checkIdle(): Promise<void> {
    if (this.state !== 'awake' || this.lastActivityAt === null) return;
    if (!this.options.isCurrent() || this.snapshot().blockers.length > 0) return;
    if (Date.now() - this.lastActivityAt < this.idleTimeoutMs) return;
    this.state = 'releasing';
    this.publish();
    this.transition = this.options
      .release()
      .then(
        () => {
          if (this.state !== 'stopped') this.state = 'sleeping';
        },
        (error: unknown) => {
          this.releaseUncertain = true;
          this.failure = `Release: ${error instanceof Error ? error.message : String(error)}`;
          if (this.state === 'stopped') return;
          this.state = 'release-failed';
        },
      )
      .finally(() => {
        this.transition = undefined;
        this.publish();
      });
    await this.transition;
  }

  private publish(): void {
    this.options.onChange?.(this.snapshot());
  }
}
