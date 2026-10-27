import type { Summary } from './contract.js';
import type { AdmissionTicket, InstallationStore } from './installationStore.js';

export interface CommandCompletion {
  finish(outcome: 'success' | 'failure'): void;
}
export type ProductDimensions = Pick<Summary, 'version' | 'os' | 'arch' | 'node_major' | 'ci'>;
export class ProductUsageProducer {
  private ticket?: AdmissionTicket;
  private work: Promise<void>;
  private pending = 0;
  constructor(
    private readonly options: {
      store: InstallationStore;
      now: () => number;
      dimensions: ProductDimensions;
      dispatch: (body: string) => void | Promise<void>;
    },
  ) {
    this.work = options.store
      .admit()
      .then((ticket) => {
        this.ticket = ticket;
      })
      .catch(() => {});
  }

  beginCommand(name: 'inspect'): CommandCompletion {
    let finished = false;
    return {
      finish: (outcome) => {
        if (finished) return;
        finished = true;
        const ticket = this.ticket;
        if (name !== 'inspect' || !ticket || this.pending >= 256) return;
        let occurredAt: string;
        try {
          occurredAt = new Date(this.options.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
        } catch {
          return;
        }
        this.pending++;
        this.work = this.work
          .then(async () => {
            const accepted = await this.options.store.append(ticket, {
              ...this.options.dimensions,
              occurred_at: occurredAt,
              counters: [
                { kind: 'command', name, outcome, transport: 'none', client: 'none', bucket: 'none', count: 1 },
              ],
            });
            if (accepted) await this.options.store.attemptSend(ticket, this.options.dispatch);
          })
          .catch(() => {})
          .finally(() => {
            this.pending--;
          });
      },
    };
  }

  /** Synthetic harness barrier only. Commands, readiness and shutdown must never await this. */
  settled(): Promise<void> {
    return this.work;
  }
}
