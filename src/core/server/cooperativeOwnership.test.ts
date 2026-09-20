import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as identity from './processIdentity.js';
import { cleanupPidFileIfMatches, readPidFile, writePidFile } from './pidFileManager.js';
import {
  claimRuntimeScope,
  readRuntimeScopeOwnership,
  reclaimStaleRuntimeScopeOwnership,
} from './runtimeScopeOwnership.js';

describe('cooperative exclusive ownership', () => {
  const scopes: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    for (const scope of scopes.splice(0)) fs.rmSync(scope, { recursive: true, force: true });
  });
  function scope() {
    const value = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-owner-'));
    scopes.push(value);
    return value;
  }

  it('claims and writes a generation without process inspection; competing owners cannot reclaim it', () => {
    vi.spyOn(identity, 'readProcessIdentity').mockImplementation(() => {
      throw new Error('inspection denied');
    });
    vi.spyOn(identity, 'inspectProcessIdentity').mockImplementation(() => {
      throw new Error('inspection denied');
    });
    const directory = scope();
    const owner = claimRuntimeScope(directory, { kind: 'background-supervisor', cooperative: true });
    expect(owner.record.processIdentity).toBeUndefined();
    expect(() => claimRuntimeScope(directory, { kind: 'background-supervisor', cooperative: true })).toThrow();
    const record = {
      pid: process.pid,
      ownerClaimId: owner.record.claimId,
      url: 'http://127.0.0.1:3050/mcp',
      host: '127.0.0.1',
      port: 3050,
      transport: 'http' as const,
      startedAt: new Date().toISOString(),
      configDir: directory,
    };
    writePidFile(directory, record);
    expect(readPidFile(directory)?.ownerClaimId).toBe(owner.record.claimId);
    expect(identity.readProcessIdentity).not.toHaveBeenCalled();
    expect(identity.inspectProcessIdentity).not.toHaveBeenCalled();
    owner.release();
  });

  it('does not reclaim cooperative records even when a numeric PID is dead', () => {
    const directory = scope();
    const owner = claimRuntimeScope(directory, { kind: 'background-supervisor', cooperative: true });
    // On Linux retain the live lock through this assertion; it must fail closed either way.
    try {
      expect(reclaimStaleRuntimeScopeOwnership(directory, owner.record, () => false)).toBe(false);
    } catch (error) {
      expect(String(error)).toContain('lock');
    }
    expect(readRuntimeScopeOwnership(directory)?.claimId).toBe(owner.record.claimId);
    owner.release();
  });

  it('retains a successor PID record when an old generation finalizes', () => {
    const directory = scope();
    const common = {
      pid: process.pid,
      url: 'http://127.0.0.1:3050/mcp',
      host: '127.0.0.1',
      port: 3050,
      transport: 'http' as const,
      startedAt: new Date().toISOString(),
      configDir: directory,
    };
    writePidFile(directory, { ...common, ownerClaimId: 'successor' });
    expect(cleanupPidFileIfMatches(directory, { ...common, ownerClaimId: 'retired' })).toBe(true);
    expect(readPidFile(directory)?.ownerClaimId).toBe('successor');
  });
});
