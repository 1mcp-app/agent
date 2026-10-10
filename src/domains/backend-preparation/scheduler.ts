import { PreparationOptionsSchema } from './policy.js';

interface ScheduledWork {
  readonly id: string;
  readonly resourceKey: string;
  readonly wasQueued: boolean;
  readonly run: (wasQueued: boolean) => Promise<void>;
}

/** Runtime-global expensive-work bound. Running cancellation retains its slot until work settles. */
export class PreparationScheduler {
  private active = 0;
  private readonly activeResources = new Set<string>();
  private readonly queue: ScheduledWork[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly queueCapacity: number,
  ) {
    PreparationOptionsSchema.parse({ concurrency, queueCapacity });
  }

  schedule(
    id: string,
    run: (wasQueued: boolean) => Promise<void>,
    resourceKey = id,
    beforeAdmission?: () => void,
  ): boolean {
    if (this.active < this.concurrency) {
      if (!this.activeResources.has(resourceKey)) {
        beforeAdmission?.();
        this.start({ id, run, resourceKey, wasQueued: false });
        return true;
      }
    }
    if (this.queue.length >= this.queueCapacity) return false;
    beforeAdmission?.();
    this.queue.push({ id, run, resourceKey, wasQueued: true });
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
    this.activeResources.add(work.resourceKey);
    void Promise.resolve()
      .then(() => work.run(work.wasQueued))
      .finally(() => {
        this.active--;
        this.activeResources.delete(work.resourceKey);
        this.drain();
      })
      .catch(() => {
        /* A failing work item must still release its slot. */
      });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const index = this.queue.findIndex((work) => !this.activeResources.has(work.resourceKey));
      if (index < 0) return;
      const [next] = this.queue.splice(index, 1);
      this.start(next);
    }
  }
}
