import { labels, type Summary } from './contract.js';
import type { AdmissionTicket, InstallationStore, PrepareDelivery } from './installationStore.js';

export interface CommandCompletion {
  finish(outcome: 'success' | 'failure'): void;
}
export type ProductDimensions = Pick<Summary, 'version' | 'os' | 'arch' | 'node_major' | 'ci'>;
export type CommandName = (typeof labels.command)[number];
export type FeatureName = (typeof labels.feature)[number];
export type OperationName = (typeof labels.operation)[number];
type Counter = Summary['counters'][number];
export class ProductUsageProducer {
  private ticket?: AdmissionTicket;
  private work: Promise<void>;
  private pending = 0;
  private admitting = true;
  private cadence?: ReturnType<typeof setInterval>;
  private observation?: ReturnType<typeof setInterval>;
  private observing = false;
  private observationWork: Promise<void> = Promise.resolve();
  private readonly configuration = new Map<'servers' | 'tools', Counter>();
  constructor(
    private readonly options: {
      store: InstallationStore;
      now: () => number;
      dimensions: ProductDimensions;
      dispatch: (body: string) => void | Promise<void>;
      abortDelivery?: () => void;
      prepareDelivery?: PrepareDelivery;
    },
  ) {
    this.work = options.store
      .admit()
      .then((ticket) => {
        this.ticket = ticket;
      })
      .catch(() => {})
      .finally(() => {
        this.admitting = false;
      });
  }

  beginCommand(name: CommandName): CommandCompletion {
    return this.begin('command', name);
  }

  beginFeature(name: FeatureName): CommandCompletion {
    return this.begin('feature', name);
  }

  beginRuntimeStartup(): CommandCompletion {
    return this.begin('feature', 'runtime_start');
  }

  beginOperation(name: OperationName, transport: Counter['transport'], client: Counter['client']): CommandCompletion {
    return this.begin('operation', name, transport, client);
  }

  private begin(
    kind: 'command' | 'feature' | 'operation',
    name: CommandName | FeatureName | OperationName,
    transport: Counter['transport'] = 'none',
    client: Counter['client'] = 'none',
  ): CommandCompletion {
    let finished = false;
    let ticket = this.ticket;
    if (!ticket && !this.admitting) this.requestAdmission();
    // Bind a command awaiting its initial admission to that admission only.
    if (!ticket && this.admitting)
      void this.work.then(() => {
        if (!finished) ticket = this.ticket;
      });
    return {
      finish: (outcome) => {
        if (finished) return;
        finished = true;
        if (!(labels[kind] as readonly string[]).includes(name)) return;
        if (ticket) this.record({ kind, name, outcome, transport, client, bucket: 'none', count: 1 }, ticket);
      },
    };
  }

  recordFeature(name: FeatureName, outcome: 'success' | 'failure'): void {
    if (!labels.feature.includes(name)) return;
    this.record(
      { kind: 'feature', name, outcome, transport: 'none', client: 'none', bucket: 'none', count: 1 },
      this.ticket,
    );
  }

  recordOperation(
    name: OperationName,
    outcome: 'success' | 'failure',
    transport: Counter['transport'],
    client: Counter['client'],
  ): void {
    if (!labels.operation.includes(name)) return;
    this.record({ kind: 'operation', name, outcome, transport, client, bucket: 'none', count: 1 }, this.ticket);
  }

  /** Runtime hooks cannot attach configuration observations to short-lived command activity. */
  observeRuntimeConfiguration(name: 'servers' | 'tools', count: number): void {
    if (!this.cadence) return;
    this.observeConfiguration(name, count);
  }

  /** Observation is attached by the activity owner, never by a timer. */
  observeConfiguration(name: 'servers' | 'tools', count: number): void {
    if (!Number.isSafeInteger(count) || count < 0) return;
    if (!labels.configuration.includes(name)) return;
    const bucket = configurationBucket(count);
    this.configuration.set(name, {
      kind: 'configuration',
      name,
      outcome: 'observation',
      transport: 'none',
      client: 'none',
      bucket,
      count: 1,
    });
  }

  startRuntime(): void {
    if (this.cadence) return;
    this.cadence = setInterval(() => {
      const ticket = this.ticket;
      if (!ticket || this.pending >= 256) return;
      this.enqueue(() => this.options.store.attemptSend(ticket, this.options.dispatch, this.options.prepareDelivery));
    }, 300_000);
    this.cadence.unref();
    this.observation = setInterval(() => {
      if (this.observing) return;
      this.observationWork = this.observeControls();
    }, 2_000);
    this.observation.unref();
  }

  stopRuntime(): void {
    clearInterval(this.cadence);
    clearInterval(this.observation);
    this.cadence = undefined;
    this.observation = undefined;
  }

  private async observeControls(): Promise<void> {
    const ticket = this.ticket;
    if (!ticket || this.observing) return;
    this.observing = true;
    try {
      if (await this.options.store.isCurrent(ticket)) return;
    } catch {
      // Unknown shared state suppresses collection until fresh activity can admit.
    } finally {
      this.observing = false;
    }
    if (this.ticket !== ticket) return;
    this.ticket = undefined;
    this.configuration.clear();
    try {
      this.options.abortDelivery?.();
    } catch {
      /* Best effort only. */
    }
  }

  private record(counter: Counter, ticket: AdmissionTicket | undefined): void {
    if (!ticket) {
      this.configuration.clear();
      this.requestAdmission();
      return;
    }
    if (this.pending >= 256) return;
    let occurredAt: string;
    try {
      occurredAt = new Date(this.options.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
    } catch {
      return;
    }
    const counters = [counter, ...this.configuration.values()];
    this.configuration.clear();
    this.enqueue(async () => {
      const accepted = await this.options.store.append(ticket, {
        ...this.options.dimensions,
        occurred_at: occurredAt,
        counters,
      });
      if (!accepted) {
        if (this.ticket === ticket) this.ticket = undefined;
        return;
      }
      if (!this.cadence)
        await this.options.store.attemptSend(ticket, this.options.dispatch, this.options.prepareDelivery);
    });
  }

  private requestAdmission(): void {
    if (this.admitting || this.pending >= 256) return;
    this.admitting = true;
    this.enqueue(async () => {
      try {
        this.ticket = await this.options.store.admit();
      } finally {
        this.admitting = false;
      }
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.pending++;
    this.work = this.work
      .then(work)
      .catch(() => {})
      .finally(() => {
        this.pending--;
      });
  }

  /** Synthetic harness barrier only. Commands, readiness and shutdown must never await this. */
  settled(): Promise<void> {
    return Promise.all([this.work, this.observationWork]).then(() => {});
  }
}

function configurationBucket(count: number): Counter['bucket'] {
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '101+';
}
