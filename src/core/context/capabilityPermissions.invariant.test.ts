import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TemplateContextCapabilityStore } from './templateContextTrust.js';

const isPosix = process.platform !== 'win32';

describe('capability/storage permission invariants (POSIX-only, AUTH-07 gate)', () => {
  let storageDir: string;
  const capabilityFile = 'template-context-capability.json';

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(tmpdir(), 'capability-perm-invariant-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('capability file is created 0600 via an atomic owner-only write', () => {
    if (!isPosix) {
      return;
    }
    const store = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-invariant',
      createSecret: () => Buffer.alloc(32, 3),
    });
    store.getOrCreate();

    expect(fs.statSync(path.join(storageDir, capabilityFile)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(storageDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('fails closed when a pre-existing capability file is group/other-readable', () => {
    if (!isPosix) {
      return;
    }
    const store = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-invariant',
      createSecret: () => Buffer.alloc(32, 3),
    });
    store.getOrCreate();
    fs.chmodSync(path.join(storageDir, capabilityFile), 0o644);

    expect(() => store.getOrCreate()).toThrow();
  });

  it('fails closed when the capability write itself is denied (EACCES)', () => {
    if (!isPosix || process.getuid?.() === 0) {
      return; // root bypasses permission bits — skip to avoid a false-green
    }
    fs.chmodSync(storageDir, 0o500);
    try {
      const store = new TemplateContextCapabilityStore({
        storageDir,
        runtimeScopeId: 'scope-invariant',
        createSecret: () => Buffer.alloc(32, 3),
      });
      expect(() => store.getOrCreate()).toThrow();
    } finally {
      fs.chmodSync(storageDir, 0o700);
    }
  });
});
