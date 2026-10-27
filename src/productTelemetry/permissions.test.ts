import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, open, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProcessEnvironment } from '../../scripts/test-process-environment.mjs';
import { secureNewInstallationEntry, verifyInstallationPrivacy } from './permissions.js';

const nativeFixture = vi.hoisted(() => ({
  enabled: false,
  children: [] as ChildProcess[],
  ready: undefined as ((child: ChildProcess) => void) | undefined,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const native = await importOriginal<typeof import('node:child_process')>();
  return {
    ...native,
    spawn: (...args: Parameters<typeof native.spawn>) => {
      if (!nativeFixture.enabled) return native.spawn(...args);
      const child = native.spawn(
        process.execPath,
        ['-e', "process.send('ready'); process.on('message', code => process.exit(code));"],
        {
          env: createTestProcessEnvironment(),
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      nativeFixture.children.push(child);
      child.once('message', () => nativeFixture.ready?.(child));
      return child;
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('installation privacy boundary', () => {
  it('verifies an owned private tree and rejects redirected paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-permissions-'));
    roots.push(root);
    await mkdir(path.join(root, 'private'), { mode: 0o700 });
    await verifyInstallationPrivacy(path.join(root, 'private'), { created: true });
    const file = path.join(root, 'private/state');
    const handle = await open(file, 'wx', 0o600);
    try {
      await secureNewInstallationEntry(file, false);
      await handle.writeFile('{}');
    } finally {
      await handle.close();
    }
    await verifyInstallationPrivacy(path.join(root, 'private'));
    if (process.platform !== 'win32') {
      await symlink(path.join(root, 'private'), path.join(root, 'redirect'));
      await expect(verifyInstallationPrivacy(path.join(root, 'redirect'))).rejects.toThrow();
    }
  });
  it.skipIf(process.platform === 'win32')('refuses existing broad POSIX access without changing it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-permissions-'));
    roots.push(root);
    await mkdir(path.join(root, 'broad'), { mode: 0o755 });
    await expect(verifyInstallationPrivacy(path.join(root, 'broad'))).rejects.toThrow('owner-only');
  });
});

describe('Windows native privacy verification deadlines', () => {
  beforeEach(() => {
    nativeFixture.enabled = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }));
  });
  afterEach(async () => {
    for (const child of nativeFixture.children.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill();
      await exited;
    }
    nativeFixture.enabled = false;
    nativeFixture.ready = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  async function controlledVerification(background: boolean) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'product-privacy-deadline-'));
    roots.push(root);
    const ready = new Promise<ChildProcess>((resolve) => {
      nativeFixture.ready = resolve;
    });
    let outcome = 'pending';
    const settled = verifyInstallationPrivacy(root, { background }).then(
      () => {
        outcome = 'verified';
      },
      (error) => {
        outcome = error.message;
      },
    );
    return { child: await ready, settled, outcome: () => outcome };
  }
  it('allows a foreground native verifier to finish after the background deadline', async () => {
    const verification = await controlledVerification(false);
    await vi.advanceTimersByTimeAsync(3001);
    expect(verification.outcome()).toBe('pending');
    verification.child.send(0);
    await verification.settled;
    expect(verification.outcome()).toBe('verified');
    expect(nativeFixture.children).toHaveLength(1);
  });
  it('still terminates background verification at three seconds', async () => {
    const verification = await controlledVerification(true);
    await vi.advanceTimersByTimeAsync(2999);
    expect(verification.outcome()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await verification.settled;
    expect(verification.outcome()).toBe('Product telemetry privacy verification timed out');
    expect(verification.child.killed).toBe(true);
    expect(nativeFixture.children).toHaveLength(1);
  });
  it('bounds foreground verification at ten seconds rather than waiting indefinitely', async () => {
    const verification = await controlledVerification(false);
    await vi.advanceTimersByTimeAsync(9999);
    expect(verification.outcome()).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    await verification.settled;
    expect(verification.outcome()).toBe('Product telemetry privacy verification timed out');
    expect(verification.child.killed).toBe(true);
  });
  it('keeps a denied native ACL result closed without retrying', async () => {
    const verification = await controlledVerification(false);
    verification.child.send(1);
    await verification.settled;
    expect(verification.outcome()).toBe('Product telemetry privacy verification denied');
    expect(nativeFixture.children).toHaveLength(1);
  });
});
