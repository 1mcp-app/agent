import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

import { DAY, envelopeSchema, MAX_BODY, type Summary, summarySchema } from './contract.js';
import { coordinationScope } from './coordinationScope.js';
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
export interface PreparedDelivery {
  dispatch(body: string): void;
  cancel(): void;
  isReady(): boolean;
}
export type PrepareDelivery = () => Promise<PreparedDelivery | undefined>;

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
  recovery: 'not-needed' | 'wait' | 'automatic' | 'offline-required';
}
const ownerSchema = z.strictObject({
  pid: z.number().int().positive(),
  nonce: z.uuid(),
  scope: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});

export class InstallationStore {
  constructor(
    private readonly root: string,
    private readonly options: { notice: () => void | Promise<void>; now?: () => number; background?: boolean },
  ) {}

  async status(): Promise<InstallationStatus> {
    await this.checkRoot(false);
    const state = await this.read();
    const recovery = await coordinationRecovery(this.root);
    return {
      preference: state?.preference ?? 'default',
      identityPresent: Boolean(state?.installationId),
      queuedSummaries: state?.queue.length ?? 0,
      coordination: recovery === 'not-needed' ? 'available' : 'busy-or-ambiguous',
      recovery,
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

  /** Read-only live-control observation; never creates an identity or admits activity. */
  async isCurrent(ticket: AdmissionTicket): Promise<boolean> {
    await this.checkRoot(false);
    return matches(await this.read(), ticket);
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

  /** A durable final claim precedes payload handoff, within the generation lock. Prepare outside that lock. */
  async attemptSend(
    ticket: AdmissionTicket,
    dispatch: (body: string) => void | Promise<void>,
    prepare?: PrepareDelivery,
  ): Promise<void> {
    let prepared: PreparedDelivery | undefined;
    let handedOff = false;
    if (prepare) {
      const hasQueuedData = await this.transaction(async () => {
        const state = await this.read();
        if (!matches(state, ticket)) return false;
        if (prune(state, this.now())) await this.commit(state);
        return state.queue.length > 0;
      });
      if (!hasQueuedData) return;
      // DNS/TLS must not hold the generation lock or consume the durable queue.
      prepared = await prepare();
      if (!prepared) return;
    }
    try {
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
        if (prepared && !prepared.isReady()) return;
        const body = JSON.stringify(envelopeSchema.parse(batch));
        state.queue.splice(0, batch.summaries.length);
        await this.commit(state);
        handedOff = true;
        try {
          void Promise.resolve((prepared?.dispatch ?? dispatch)(body)).catch(() => {});
        } catch {
          /* Every attempt is final. */
        }
      });
    } finally {
      if (!handedOff) prepared?.cancel();
    }
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

  /** Legacy producers still share this guard; only verified dead owners may be recovered. */
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
            await recoverGuard(this.root, acquisitionDeadline, this.options.background);
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
          if (!owner.success || !(await ownerIsDead(owner.data))) {
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

async function ownerRecovery(root: string): Promise<InstallationStatus['recovery']> {
  let recovery: InstallationStatus['recovery'] = 'not-needed';
  for (const name of ['guard', 'lock']) {
    const directory = path.join(root, name);
    if (!(await exists(directory))) continue;
    const owner = ownerSchema.safeParse(await readOwner(directory));
    if (!owner.success) return 'offline-required';
    if (!(await matchingScope(owner.data.scope))) return 'offline-required';
    if (!demonstrablyDead(owner.data.pid)) return 'wait';
    recovery = 'automatic';
  }
  return recovery;
}

async function recoverGuard(root: string, deadline: number, background = false): Promise<void> {
  const guard = path.join(root, 'guard');
  const observed = ownerSchema.safeParse(await readOwner(guard));
  if (!observed.success || !(await ownerIsDead(observed.data))) return;
  if ((await ownerRecovery(root)) !== 'automatic') return;
  await withGuardRecovery(root, deadline, background, async () => {
    // Another reaper may already have completed. Never remove a replacement's guard.
    const current = ownerSchema.safeParse(await readOwner(guard));
    if (!current.success || current.data.nonce !== observed.data.nonce || current.data.pid !== observed.data.pid)
      return;
    if (!(await ownerIsDead(current.data))) return;
    if ((await ownerRecovery(root)) !== 'automatic') return;
    await rm(guard, { recursive: true });
  });
}

const recoveryName = /^recovery-([1-9][0-9]*)-([0-9a-f-]{36})(?:-([0-9a-f]{64}))?$/;

async function coordinationRecovery(root: string): Promise<InstallationStatus['recovery']> {
  const owners = await ownerRecovery(root);
  if (owners === 'offline-required') return owners;
  let waiting = owners === 'wait';
  try {
    for (const name of await recoveryContenders(root)) {
      const ticket = await recoveryTicket(root, name);
      if (ticket !== undefined) waiting = true;
    }
  } catch (error) {
    if (!isMissing(error)) return 'offline-required';
  }
  return waiting ? 'wait' : owners;
}

async function matchingScope(scope: string | undefined): Promise<boolean> {
  if (!scope) return false;
  return scope === (await coordinationScope());
}

async function ownerIsDead(owner: z.infer<typeof ownerSchema>): Promise<boolean> {
  if (!(await matchingScope(owner.scope))) return false;
  return demonstrablyDead(owner.pid);
}

/**
 * Lamport bakery doorway for guard reapers. Each attempt owns an immutable name,
 * so a dead contender can be discarded without deleting a replacement's lock.
 * Normal transactions retain the legacy guard protocol and do not enter here.
 */
async function withGuardRecovery(
  root: string,
  deadline: number,
  background: boolean,
  work: () => Promise<void>,
): Promise<void> {
  const scope = await coordinationScope(background);
  if (!scope) return;
  const name = `recovery-${process.pid}-${randomUUID()}-${scope}`;
  const directory = path.join(root, name);
  await mkdir(directory, { mode: 0o700 });
  try {
    await secureNewInstallationEntry(directory, true, background);
    const contenders = await recoveryContenders(root, name);
    let number = 1;
    for (const contender of contenders) {
      const ticket = await recoveryTicket(root, contender, true);
      number = Math.max(number, (ticket ?? 0) + 1);
    }
    if (!Number.isSafeInteger(number)) throw new Error('Product telemetry recovery ticket overflow');
    const temporary = path.join(directory, 'ticket.tmp');
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await secureNewInstallationEntry(temporary, false, background);
      await handle.writeFile(String(number));
    } finally {
      await handle.close();
    }
    await rename(temporary, path.join(directory, 'ticket'));
    while (performance.now() < deadline) {
      let waiting = false;
      for (const contender of await recoveryContenders(root, name)) {
        if (contender === name) continue;
        const ticket = await recoveryTicket(root, contender, true);
        if (ticket === undefined) continue;
        if (ticket === 0 || ticket < number || (ticket === number && contender < name)) {
          waiting = true;
          break;
        }
      }
      if (!waiting) {
        await work();
        return;
      }
      await delay(10, undefined, { ref: !background });
    }
    throw new Error('Product telemetry recovery busy; retry after active producers finish');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function recoveryContenders(root: string, ownName?: string): Promise<string[]> {
  const entries = (await readdir(root)).filter((entry) => entry !== ownName);
  if (entries.length > 256) throw new Error('Product telemetry coordination requires offline recovery');
  return entries.filter((entry) => recoveryName.test(entry));
}

/** Zero is a live contender choosing its ticket; undefined means it has left. */
async function recoveryTicket(root: string, name: string, cleanup = false): Promise<number | undefined> {
  const match = recoveryName.exec(name)!;
  const pid = Number(match[1]);
  if (!Number.isSafeInteger(pid)) throw new Error('Invalid product telemetry recovery owner');
  const directory = path.join(root, name);
  try {
    await checkPrivate(directory, true);
    if (!(await matchingScope(match[3]))) throw new Error('Unverified telemetry recovery scope');
    if (demonstrablyDead(pid)) {
      if (cleanup) await rm(directory, { recursive: true, force: true });
      return undefined;
    }
    const file = path.join(directory, 'ticket');
    try {
      await checkPrivate(file, false);
      const value = await readFile(file, 'utf8');
      const ticket = Number(value);
      if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(ticket))
        throw new Error('Invalid product telemetry recovery ticket');
      return ticket;
    } catch (error) {
      if (!isMissing(error)) throw error;
      return (await exists(directory)) ? 0 : undefined;
    }
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
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
  const scope = await coordinationScope(background);
  const file = await open(path.join(directory, 'owner.json'), 'wx', 0o600);
  try {
    await secureNewInstallationEntry(path.join(directory, 'owner.json'), false, background);
    await file.writeFile(JSON.stringify({ pid: process.pid, nonce, scope }));
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
