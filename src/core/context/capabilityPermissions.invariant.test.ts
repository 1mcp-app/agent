import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TemplateContextCapabilityStore } from './templateContextTrust.js';

const isPosix = process.platform !== 'win32';
const isRoot = process.getuid?.() === 0;

describe('capability/storage permission invariants (POSIX-only, AUTH-07 gate)', () => {
  let storageDir: string;
  const capabilityFile = 'template-context-capability.json';

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(tmpdir(), 'capability-perm-invariant-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it.skipIf(!isPosix)('capability file is created 0600 via an atomic owner-only write', () => {
    const store = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-invariant',
      createSecret: () => Buffer.alloc(32, 3),
    });
    store.getOrCreate();

    expect(fs.statSync(path.join(storageDir, capabilityFile)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(storageDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it.skipIf(!isPosix)('self-heals a legacy group/other-readable capability file to 0600 on read', () => {
    const store = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-invariant',
      createSecret: () => Buffer.alloc(32, 3),
    });
    store.getOrCreate();
    const filePath = path.join(storageDir, capabilityFile);
    fs.chmodSync(filePath, 0o644);

    const capability = store.getOrCreate();
    expect(capability.runtimeScopeId).toBe('scope-invariant');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.skipIf(!isPosix || isRoot)('fails closed when the capability write itself is denied (EACCES)', () => {
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
