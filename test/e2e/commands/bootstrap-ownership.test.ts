import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { runInstructionsProcess } from '@src/commands/bootstrap/bootstrap.js';
import { temporaryProjectOwnerStorage } from '@src/commands/shared/projectOwnerStorage.js';
import {
  acquireProjectOwnerLease,
  assertNoProjectOwnerCalls,
  createHookProjectOwner,
  readHookThreadLocator,
  readProjectOwner,
} from '@src/commands/shared/projectOwnerStore.js';

import { expect, it } from 'vitest';

it('awaits a timed-out instructions child and reconciles only that child lease', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-child-'));
  let releaseParent: (() => Promise<void>) | undefined;
  try {
    const owner = await createHookProjectOwner(directory, { client: 'codex', sessionId: 'child-timeout' });
    releaseParent = await acquireProjectOwnerLease(owner);
    const ready = path.join(directory, 'ready.json');
    const script = path.join(directory, 'instructions.mjs');
    const store = pathToFileURL(path.resolve('build/commands/shared/projectOwnerStore.js')).href;
    await writeFile(
      script,
      `
      import { acquireProjectOwnerLease } from ${JSON.stringify(store)};
      import { writeFile } from 'node:fs/promises';
      await acquireProjectOwnerLease(${JSON.stringify(owner)});
      await writeFile(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid }));
      setInterval(() => {}, 1000);
    `,
    );
    await expect(runInstructionsProcess(process.execPath, [script], 5000, owner)).rejects.toThrow('deadline');
    const { pid } = JSON.parse(await readFile(ready, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await readdir(`${owner}.calls`)).toHaveLength(1);
    await expect(assertNoProjectOwnerCalls(owner)).rejects.toThrow('leases');
    await releaseParent();
    releaseParent = undefined;
    await expect(assertNoProjectOwnerCalls(owner)).resolves.toBeUndefined();
  } finally {
    await releaseParent?.();
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);

it('resumes the built CLI after an end event retains a live caller lease', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-resume-'));
  const entry = path.resolve('build/index.js');
  const env = { ...process.env, CODEX_THREAD_ID: '', CODEX_SESSION_ID: '' };
  let release: (() => Promise<void>) | undefined;
  try {
    const invoke = (event: string) =>
      executeWithInput(
        [entry, 'bootstrap', '--client', 'codex', '--config-dir', directory, '--project', directory, '--event', event],
        JSON.stringify({ hook_event_name: event, session_id: 'isolated-resume', cwd: directory }),
        env,
      );
    await invoke('SessionStart');
    const storage = temporaryProjectOwnerStorage(directory);
    const old = (await readHookThreadLocator(storage, 'codex', 'isolated-resume'))!.ownerFile;
    release = await acquireProjectOwnerLease(old);
    await expect(invoke('SessionEnd')).rejects.toThrow('leases');
    await invoke('SessionStart');
    const fresh = (await readHookThreadLocator(storage, 'codex', 'isolated-resume'))!.ownerFile;
    expect(fresh).not.toBe(old);
    expect(await readProjectOwner(fresh)).not.toBe(await readProjectOwner(old));
    expect(JSON.parse(await readFile(`${old}.ended`, 'utf8')).released).toBeUndefined();
    await release();
    release = undefined;
  } finally {
    await release?.();
    await rm(directory, { recursive: true, force: true });
    await rm(temporaryProjectOwnerStorage(directory), { recursive: true, force: true });
  }
}, 45000);

function executeWithInput(args: string[], input: string, env: Record<string, string | undefined>, timeout = 15000) {
  const pending = promisify(execFile)(process.execPath, args, { env, timeout, killSignal: 'SIGKILL' });
  pending.child.stdin?.end(input);
  return pending;
}

it('reaps the actual stalled hook process before its timeout rejects', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bootstrap-hook-timeout-'));
  const ready = path.join(directory, 'pid');
  try {
    const source = `require('node:fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`;
    await expect(executeWithInput(['-e', source], '{}', process.env, 2000)).rejects.toMatchObject({ killed: true });
    const pid = Number(await readFile(ready, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
