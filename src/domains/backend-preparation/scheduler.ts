import { PreparationOptionsSchema } from './policy.js';

interface ScheduledWork {
  readonly id: string;
  readonly run: () => Promise<void>;
}

/** Runtime-global expensive-work bound. Running cancellation retains its slot until work settles. */
export class PreparationScheduler {
  private active = 0;
  private readonly queue: ScheduledWork[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly queueCapacity: number,
  ) {
    PreparationOptionsSchema.parse({ concurrency, queueCapacity });
  }

  schedule(id: string, run: () => Promise<void>): boolean {
    if (this.active < this.concurrency) {
      this.start({ id, run });
      return true;
    }
    if (this.queue.length >= this.queueCapacity) return false;
    this.queue.push({ id, run });
    return true;
  }

  cancelQueued(id: string): boolean {
    const index = this.queue.findIndex((work) => work.id === id);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  counts(): { active: number; queued: number } {
    return { active: this.active, queued: this.queue.length };
  }

  private start(work: ScheduledWork): void {
    this.active++;
    void Promise.resolve()
      .then(work.run)
      .finally(() => {
        this.active--;
        const next = this.queue.shift();
        if (next) this.start(next);
      })
      .catch(() => {
        /* A failing work item must still release its slot. */
      });
  }
}
