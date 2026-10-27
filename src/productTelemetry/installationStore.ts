import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { DAY, envelopeSchema, MAX_BODY, type Summary, summarySchema } from './contract.js';
import { secureNewInstallationEntry, verifyInstallationPrivacy } from './permissions.js';

const MAX_QUEUE = 256 * 1024;
const stateSchema = z.strictObject({
  format: z.literal(1),
  epoch: z.uuid(),
  generation: z.number().int().nonnegative().safe(),
  preference: z.enum(['default', 'enabled', 'disabled']),
  installationId: z.uuid().optional(),
  noticed: z.boolean(),
  queue: z.array(summarySchema),
});
type State = z.infer<typeof stateSchema>;
export interface AdmissionTicket {
  readonly epoch: string;
  readonly generation: number;
  readonly installationId: string;
}
export interface InstallationStatus {
  preference: State['preference'];
  identityPresent: boolean;
  queuedSummaries: number;
  coordination: 'available' | 'busy-or-ambiguous';
}
const ownerSchema = z.strictObject({ pid: z.number().int().positive(), nonce: z.uuid() });

export class InstallationStore {
  constructor(
    private readonly root: string,
    private readonly options: { notice: () => void | Promise<void>; now?: () => number; background?: boolean },
  ) {}

  async status(): Promise<InstallationStatus> {
    await this.checkRoot(false);
    const state = await this.read();
    const busy = (await exists(path.join(this.root, 'guard'))) || (await exists(path.join(this.root, 'lock')));
    return {
      preference: state?.preference ?? 'default',
      identityPresent: Boolean(state?.installationId),
      queuedSummaries: state?.queue.length ?? 0,
      coordination: busy ? 'busy-or-ambiguous' : 'available',
    };
  }

  async control(action: 'enable' | 'disable' | 'reset'): Promise<void> {
    await this.transaction(async () => {
      const state = (await this.read()) ?? freshState();
      if (action === 'enable') state.preference = 'enabled';
      if (action === 'disable') state.preference = 'disabled';
      if (action !== 'enable') {
        state.generation++;
        state.queue = [];
      }
      if (action === 'reset') delete state.installationId;
      await this.commit(state);
    });
  }

  async admit(): Promise<AdmissionTicket | undefined> {
    return this.transaction(async () => {
      const state = (await this.read()) ?? freshState();
      if (state.preference === 'disabled') return undefined;
      if (!state.noticed) {
        await this.options.notice();
        state.noticed = true;
      }
      state.installationId ??= randomUUID();
      await this.commit(state);
      return { epoch: state.epoch, generation: state.generation, installationId: state.installationId };
    });
  }

  async append(ticket: AdmissionTicket, facts: Omit<Summary, 'installation_id'>): Promise<boolean> {
    const incoming = summarySchema.omit({ installation_id: true }).parse(facts);
    return this.transaction(async () => {
      const state = await this.read();
      if (!matches(state, ticket)) return false;
      const now = this.now();
      const pruned = prune(state, now);
      if (now - Date.parse(incoming.occurred_at) > 7 * DAY) {
        if (pruned) await this.commit(state);
        return false;
      }
      if (Date.parse(incoming.occurred_at) - now > 300_000) {
        if (pruned) await this.commit(state);
        return false;
      }
      for (const counter of incoming.counters) {
        let remaining = counter.count;
        while (remaining > 0) {
          let summary = state.queue.find(
            (s) =>
              sameDimensions(s, incoming) && s.counters.some((c) => sameCounter(c, counter) && c.count < 1_000_000),
          );
          summary ??= state.queue.find((s) => sameDimensions(s, incoming) && s.counters.length < 16);
          if (!summary) {
            summary = { ...incoming, installation_id: ticket.installationId, counters: [] };
            state.queue.push(summary);
          }
          const existing = summary.counters.find((c) => sameCounter(c, counter) && c.count < 1_000_000);
          const increment = Math.min(remaining, 1_000_000 - (existing?.count ?? 0));
          if (existing) existing.count += increment;
          else summary.counters.push({ ...counter, count: increment });
          if (incoming.occurred_at < summary.occurred_at) summary.occurred_at = incoming.occurred_at;
          remaining -= increment;
        }
      }
      prune(state, now);
      await this.commit(state);
      return true;
    });
  }

  /** A durable final claim precedes transport initiation, within the generation lock. Never await transport. */
  async attemptSend(ticket: AdmissionTicket, dispatch: (body: string) => void | Promise<void>): Promise<void> {
    await this.transaction(async () => {
      const state = await this.read();
      if (!matches(state, ticket)) return;
      const pruned = prune(state, this.now());
      const batch = { schema_version: 1 as const, batch_id: randomUUID(), summaries: [] as Summary[] };
      for (const summary of state.queue.slice(0, 100)) {
        batch.summaries.push(summary);
        if (Buffer.byteLength(JSON.stringify(batch), 'utf8') > MAX_BODY) {
          batch.summaries.pop();
          break;
        }
      }
      if (!batch.summaries.length) {
        if (pruned) await this.commit(state);
        return;
      }
      const body = JSON.stringify(envelopeSchema.parse(batch));
      state.queue.splice(0, batch.summaries.length);
      await this.commit(state);
      try {
        void Promise.resolve(dispatch(body)).catch(() => {});
      } catch {
        /* Every attempt is final. */
      }
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private async checkRoot(create: boolean): Promise<void> {
    const created = create ? await mkdir(this.root, { recursive: true, mode: 0o700 }) : undefined;
    try {
      await verifyInstallationPrivacy(this.root, {
        background: this.options.background,
        created: created !== undefined,
      });
    } catch (error) {
      if (!create && isMissing(error)) return;
      throw error;
    }
  }

  private async read(): Promise<State | undefined> {
    const file = path.join(this.root, 'state.json');
    try {
      await checkPrivate(file, false);
      const handle = await open(
        file,
        process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        if ((await handle.stat()).size > MAX_QUEUE + 4096) throw new Error('Oversized product state');
        return stateSchema.parse(JSON.parse(await handle.readFile('utf8')));
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw new Error('Product telemetry state unavailable; retain state and use offline recovery');
    }
  }

  private async commit(state: State): Promise<void> {
    stateSchema.parse(state);
    const temporary = path.join(this.root, `state-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await secureNewInstallationEntry(temporary, false, this.options.background);
        await handle.writeFile(JSON.stringify(state));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path.join(this.root, 'state.json'));
      if (process.platform !== 'win32') {
        const directory = await open(this.root, 'r');
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async cleanOrphanedWrites(): Promise<void> {
    const entries = await readdir(this.root);
    if (entries.length > 256) throw new Error('Product telemetry temporary state requires offline recovery');
    for (const entry of entries) {
      if (!/^state-[0-9a-f-]{36}\.tmp$/.test(entry)) continue;
      const file = path.join(this.root, entry);
      await checkPrivate(file, false);
      await rm(file);
    }
  }

  /** All acquisitions and dead-owner reclamation honor the same guard. An abandoned guard fails closed. */
  private async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.checkRoot(true);
    const nonce = randomUUID();
    const guard = path.join(this.root, 'guard');
    const lock = path.join(this.root, 'lock');
    const acquisitionDeadline = performance.now() + (process.platform === 'win32' ? 5000 : 1000);
    while (performance.now() < acquisitionDeadline) {
      let guarded = false;
      let locked = false;
      try {
        try {
          await mkdir(guard, { mode: 0o700 });
        } catch (error) {
          if (isExists(error)) {
            await delay(10, undefined, { ref: !this.options.background });
            continue;
          }
          throw error;
        }
        await secureNewInstallationEntry(guard, true, this.options.background);
        await writeOwner(guard, nonce, this.options.background);
        guarded = true;
        if (await exists(lock)) {
          const owner = ownerSchema.safeParse(await readOwner(lock));
          if (!owner.success || !demonstrablyDead(owner.data.pid)) {
            await delay(10, undefined, { ref: !this.options.background });
            continue;
          }
          await rm(lock, { recursive: true });
        }
        await mkdir(lock, { mode: 0o700 });
        await secureNewInstallationEntry(lock, true, this.options.background);
        await writeOwner(lock, nonce, this.options.background);
        locked = true;
        await release(guard, nonce);
        guarded = false;
        await this.cleanOrphanedWrites();
        return await work();
      } finally {
        if (locked) await release(lock, nonce);
        if (guarded) await release(guard, nonce);
      }
    }
    throw new Error('Product telemetry coordination busy or ambiguous; use offline recovery');
  }
}

function freshState(): State {
  return { format: 1, epoch: randomUUID(), generation: 0, preference: 'default', noticed: false, queue: [] };
}
function isMissing(error: unknown): boolean {
  return hasCode(error, 'ENOENT');
}
function isExists(error: unknown): boolean {
  return hasCode(error, 'EEXIST');
}
function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
async function checkPrivate(file: string, directory: boolean): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
    throw new Error('Product telemetry path is not private');
  if (process.platform === 'win32') return;
  if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
    throw new Error('Product telemetry path is not owner-only');
}
async function writeOwner(directory: string, nonce: string, background = false): Promise<void> {
  const file = await open(path.join(directory, 'owner.json'), 'wx', 0o600);
  try {
    await secureNewInstallationEntry(path.join(directory, 'owner.json'), false, background);
    await file.writeFile(JSON.stringify({ pid: process.pid, nonce }));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function readOwner(directory: string): Promise<unknown> {
  try {
    await checkPrivate(directory, true);
    await checkPrivate(path.join(directory, 'owner.json'), false);
    return JSON.parse(await readFile(path.join(directory, 'owner.json'), 'utf8'));
  } catch {
    return undefined;
  }
}
async function release(directory: string, nonce: string): Promise<void> {
  const owner = ownerSchema.safeParse(await readOwner(directory));
  if (owner.success && owner.data.nonce === nonce && owner.data.pid === process.pid)
    await rm(directory, { recursive: true });
}
function demonstrablyDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return hasCode(error, 'ESRCH');
  }
}

function matches(state: State | undefined, ticket: AdmissionTicket): state is State {
  if (!state || state.preference === 'disabled') return false;
  return (
    state.epoch === ticket.epoch &&
    state.generation === ticket.generation &&
    state.installationId === ticket.installationId
  );
}
function sameCounter(a: Summary['counters'][number], b: Summary['counters'][number]): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.outcome === b.outcome &&
    a.transport === b.transport &&
    a.client === b.client &&
    a.bucket === b.bucket
  );
}
function sameDimensions(a: Summary, b: Omit<Summary, 'installation_id'>): boolean {
  return (
    a.occurred_at.slice(0, 10) === b.occurred_at.slice(0, 10) &&
    a.version === b.version &&
    a.os === b.os &&
    a.arch === b.arch &&
    a.node_major === b.node_major &&
    a.ci === b.ci
  );
}
function prune(state: State, now: number): boolean {
  const previousLength = state.queue.length;
  state.queue = state.queue.filter((s) => now - Date.parse(s.occurred_at) <= 7 * DAY);
  state.queue.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  while (Buffer.byteLength(JSON.stringify(state.queue), 'utf8') > MAX_QUEUE) state.queue.shift();
  return state.queue.length !== previousLength;
}
