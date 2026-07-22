import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RuntimeIdentityService } from './runtimeIdentityService.js';

describe('RuntimeIdentityService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-runtime-identity-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists a stable runtimeScopeId without deriving it from runtime URL details', () => {
    const generatedIds = ['scope-id-from-random-source'];
    const firstService = new RuntimeIdentityService({
      storageDir: tempDir,
      createId: () => generatedIds.shift()!,
    });

    const firstIdentity = firstService.getRuntimeIdentity({
      externalUrl: 'https://first.example.com',
      runtimeVersion: '9.8.7',
    });
    const secondService = new RuntimeIdentityService({
      storageDir: tempDir,
      createId: () => 'should-not-be-used',
    });
    const secondIdentity = secondService.getRuntimeIdentity({
      externalUrl: 'https://second.example.com',
      runtimeVersion: '9.8.7',
    });

    expect(firstIdentity.runtimeScopeId).toBe('scope-id-from-random-source');
    expect(secondIdentity.runtimeScopeId).toBe(firstIdentity.runtimeScopeId);
    expect(secondIdentity.runtimeScopeId).not.toContain('second.example.com');
  });
});
