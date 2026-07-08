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
});
