import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tryAcquireRuntimeScopeAdminLock } from './runtimeScopeAdminLock.js';

describe('tryAcquireRuntimeScopeAdminLock', () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-scope-admin-lock-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('allows only one writer lock per runtime scope and releases without exposing holder details', () => {
    const first = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      now: () => new Date('2026-07-07T00:00:00.000Z'),
    });
    const second = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      now: () => new Date('2026-07-07T00:01:00.000Z'),
    });

    expect(first).toMatchObject({ available: true });
    expect(second).toEqual({
      available: false,
      reason: 'writer_lock_unavailable',
    });

    if (first.available) {
      first.release();
    }

    const afterRelease = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      now: () => new Date('2026-07-07T00:02:00.000Z'),
    });

    expect(afterRelease).toMatchObject({ available: true });
    if (afterRelease.available) {
      afterRelease.release();
    }
  });

  it('reclaims a lock only when its recorded process is dead', () => {
    const first = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      pid: 111,
      processAlive: () => false,
      createOwnerToken: () => 'owner-one',
    });
    expect(first.available).toBe(true);

    const reclaimed = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      pid: 222,
      processAlive: (pid) => pid === 222,
      createOwnerToken: () => 'owner-two',
    });
    expect(reclaimed.available).toBe(true);
    if (reclaimed.available) reclaimed.release();
  });

  it('fails closed for corrupt locks and does not let an old handle remove a replacement owner', () => {
    const first = tryAcquireRuntimeScopeAdminLock({
      runtimeScopeId: 'scope_a',
      storageDir,
      pid: 111,
      processAlive: () => true,
      createOwnerToken: () => 'owner-one',
    });
    expect(first.available).toBe(true);
    const lockPath = fs
      .readdirSync(path.join(storageDir, 'admin'))
      .map((name) => path.join(storageDir, 'admin', name))[0];
    const original = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(lockPath, JSON.stringify({ ...original, pid: 222, ownerToken: 'owner-two' }));

    if (first.available) first.release();
    expect(fs.existsSync(lockPath)).toBe(true);
    fs.writeFileSync(lockPath, '{not-json');
    expect(
      tryAcquireRuntimeScopeAdminLock({ runtimeScopeId: 'scope_a', storageDir, processAlive: () => false }),
    ).toEqual({ available: false, reason: 'writer_lock_unavailable' });
  });
});
