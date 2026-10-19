import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { type ProjectOwnerCredential, verifyProjectOwnerCredential } from '@src/core/context/projectOwner.js';
import { TemplateContextCapabilityStore } from '@src/core/context/templateContextTrust.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { resolveProjectSelection } from '@src/domains/project-selection/projectSelection.js';
import type { ContextData } from '@src/types/context.js';
import { assertOwnerOnlyDirPermissions } from '@src/utils/filePermissions.js';

import { z } from 'zod';

export interface ProjectBlocker {
  kind: string;
  id: string;
  count?: number;
}
export interface ProjectLifecycleStatus {
  checkoutPath: string;
  admission: 'open' | 'draining';
  complete: boolean;
  blockers: ProjectBlocker[];
}
export class ProjectDrainingError extends Error {
  readonly code = -32004;
  readonly data = { retryable: false, reason: 'project_draining' };
  constructor() {
    super('Project Checkout is draining; an operator must explicitly resume admission');
  }
}

/** Resolve missing tails too: deleting a checkout cannot implicitly reopen its persisted barrier. */
export function canonicalLifecyclePath(value: string): string {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(canonicalLifecyclePath(parent), path.basename(absolute));
  }
}
export function projectPaths(context: ContextData | undefined): string[] {
  if (!context) return [];
  const selected = resolveProjectSelection(context);
  if (selected.kind === 'unresolved') return [];
  return selected.projects.map((project) => canonicalLifecyclePath(project.path));
}

export class ProjectLifecycle {
  private readonly draining: Set<string>;
  private readonly blockers = new Map<symbol, { paths: string[]; blocker: ProjectBlocker }>();
  private readonly active = new Map<string, number>();
  private readonly admitted = new AsyncLocalStorage<{ paths: Set<string>; pending: number; release: () => void }>();
  private readonly file: string;
  constructor(private readonly storageDir: string) {
    this.file = path.join(storageDir, 'project-drain.json');
    this.draining = new Set(
      fs.existsSync(this.file) ? z.array(z.string()).parse(JSON.parse(fs.readFileSync(this.file, 'utf8'))) : [],
    );
  }
  assertAdmission(checkouts: string[]): void {
    for (const checkout of checkouts) {
      const canonical = canonicalLifecyclePath(checkout);
      const inherited = this.admitted.getStore();
      if (inherited && inherited.pending > 0 && inherited.paths.has(canonical)) continue;
      if (this.draining.has(canonical)) throw new ProjectDrainingError();
    }
  }
  /** Scheduling a new job never inherits a previously admitted tool call. */
  assertScheduling(checkouts: string[]): void {
    for (const checkout of checkouts)
      if (this.draining.has(canonicalLifecyclePath(checkout))) throw new ProjectDrainingError();
  }
  begin(checkouts: string[]): () => void {
    const paths = [...new Set(checkouts.map(canonicalLifecyclePath))];
    this.assertAdmission(paths);
    for (const checkout of paths) this.active.set(checkout, (this.active.get(checkout) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const checkout of paths) {
        const count = (this.active.get(checkout) ?? 1) - 1;
        if (count) this.active.set(checkout, count);
        else this.active.delete(checkout);
      }
    };
  }
  async run<T>(checkouts: string[], work: () => Promise<T>): Promise<T> {
    const inherited = this.admitted.getStore();
    const inheritedPaths = inherited && inherited.pending > 0 ? inherited.paths : [];
    const paths = [...new Set([...inheritedPaths, ...checkouts.map(canonicalLifecyclePath)])];
    const done = this.begin(paths);
    const root = { paths: new Set(paths), pending: 1, release: done };
    try {
      return await this.admitted.run(root, work);
    } finally {
      root.pending--;
      if (!root.pending) root.release();
    }
  }
  retain(): (() => void) | undefined {
    const root = this.admitted.getStore();
    if (!root?.pending) return undefined;
    root.pending++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      root.pending--;
      if (!root.pending) root.release();
    };
  }

  block(checkouts: string[], kind: string, id: string): () => void {
    const paths = checkouts.map(canonicalLifecyclePath);
    this.assertAdmission(paths);
    const key = Symbol(id);
    this.blockers.set(key, { paths, blocker: { kind, id } });
    return () => {
      this.blockers.delete(key);
    };
  }
  drain(checkout: string): void {
    this.change(checkout, true);
  }
  resume(checkout: string): void {
    this.change(checkout, false);
  }
  private change(checkout: string, closed: boolean): void {
    const canonical = canonicalLifecyclePath(checkout);
    if (closed) this.draining.add(canonical);
    const next = new Set(this.draining);
    if (closed) next.add(canonical);
    else next.delete(canonical);
    fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    assertOwnerOnlyDirPermissions(this.storageDir);
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify([...next]), { mode: 0o600, flag: 'wx' });
      const fd = fs.openSync(temporary, 'r');
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.file);
      const directory = fs.openSync(this.storageDir, 'r');
      try {
        fs.fsyncSync(directory);
      } finally {
        fs.closeSync(directory);
      }
      this.draining.clear();
      for (const entry of next) this.draining.add(entry);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  status(checkout: string, extra: ProjectBlocker[] = []): ProjectLifecycleStatus {
    const checkoutPath = canonicalLifecyclePath(checkout);
    const count = this.active.get(checkoutPath) ?? 0;
    const registered = [...this.blockers.values()]
      .filter((entry) => entry.paths.includes(checkoutPath))
      .map((entry) => entry.blocker);
    const blockers = [...registered, ...extra, ...(count ? [{ kind: 'active-work', id: checkoutPath, count }] : [])];
    return {
      checkoutPath,
      admission: this.draining.has(checkoutPath) ? 'draining' : 'open',
      complete: blockers.length === 0,
      blockers,
    };
  }
}
const runtimes = new Map<string, ProjectLifecycle>();
export function getProjectLifecycle(): ProjectLifecycle | undefined {
  const storage = AgentConfigManager.getInstance().get?.('runtimeScopeStoragePath');
  if (!storage) return undefined;
  let lifecycle = runtimes.get(storage);
  if (!lifecycle) {
    lifecycle = new ProjectLifecycle(storage);
    runtimes.set(storage, lifecycle);
  }
  return lifecycle;
}
export function getVerifiedProjectOwner(context: ContextData): ProjectOwnerCredential | undefined {
  const storage = AgentConfigManager.getInstance().get?.('runtimeScopeStoragePath');
  if (!storage) return undefined;
  try {
    const capability = new TemplateContextCapabilityStore({ storageDir: storage }).read({ readOnly: true });
    return capability ? verifyProjectOwnerCredential(context.owner, capability) : undefined;
  } catch {
    return undefined;
  }
}
export async function withProjectAdmission<T>(context: ContextData | undefined, work: () => Promise<T>): Promise<T> {
  const lifecycle = getProjectLifecycle();
  return lifecycle ? lifecycle.run(projectPaths(context), work) : work();
}
