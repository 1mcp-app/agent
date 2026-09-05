import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  authorizeTemplateContext,
  createTemplateContextProof,
  TemplateContextCapabilityStore,
} from './templateContextTrust.js';

describe('template context trust', () => {
  let storageDir: string;
  const context: ContextData = {
    project: { name: 'agent', path: '/work/agent', custom: { tenant: 'internal' } },
    user: { username: 'alice', home: '/Users/alice' },
    environment: { variables: { API_TOKEN: 'do-not-log', NODE_ENV: 'test' } },
    sessionId: 'session-a',
    transport: { type: 'inspect' },
  };

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-template-context-trust-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('persists one owner-only capability per Runtime Scope', () => {
    const first = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const second = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 9),
    }).getOrCreate();

    expect(second).toEqual(first);
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(storageDir, 'template-context-capability.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('self-heals an owner-open POSIX capability on read instead of consuming it exposed', () => {
    if (process.platform === 'win32') {
      return;
    }
    const store = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    });
    store.getOrCreate();
    const filePath = path.join(storageDir, 'template-context-capability.json');
    fs.chmodSync(filePath, 0o644);

    const capability = store.read();
    expect(capability?.runtimeScopeId).toBe('scope-a');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('self-heals a pre-existing permissive storage directory before creating a capability', () => {
    if (process.platform === 'win32') {
      return;
    }
    fs.chmodSync(storageDir, 0o775);

    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();

    expect(capability.runtimeScopeId).toBe('scope-a');
    expect(fs.statSync(storageDir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(storageDir, 'template-context-capability.json')).mode & 0o777).toBe(0o600);
  });

  it('rejects capability JSON with undeclared properties', () => {
    const filePath = path.join(storageDir, 'template-context-capability.json');
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        runtimeScopeId: 'scope-a',
        secret: Buffer.alloc(32, 7).toString('base64url'),
        inheritedTrust: true,
      }),
      { mode: 0o600 },
    );

    const store = new TemplateContextCapabilityStore({ storageDir, runtimeScopeId: 'scope-a' });

    expect(() => store.read()).toThrow(/does not match this Runtime Scope/);
  });

  it('accepts a signed context only for the bound Runtime Scope and session', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability, { now: () => new Date('2026-08-04T00:00:00Z') });

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof,
        capability,
        transportSessionId: 'session-a',
      }),
    ).toMatchObject({ status: 'trusted', provenance: 'verified-local' });

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof,
        capability: { ...capability, runtimeScopeId: 'scope-b' },
        transportSessionId: 'session-a',
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'runtime_scope_mismatch' });

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof,
        capability,
        transportSessionId: 'session-b',
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'session_mismatch' });
  });

  it('rejects a signed context when no canonical transport session is supplied', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability);

    expect(authorizeTemplateContext({ mode: 'verified', context, proof, capability })).toMatchObject({
      status: 'untrusted',
      reason: 'session_mismatch',
    });
  });

  it('rejects a proof when readable context is modified', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability);

    const result = authorizeTemplateContext({
      mode: 'verified',
      context: { ...context, project: { ...context.project, path: '/tmp/suspicious' } },
      proof,
      capability,
      transportSessionId: 'session-a',
    });

    expect(result).toMatchObject({ status: 'untrusted', reason: 'context_hash_mismatch' });
  });

  it('limits proof usability to the configured session TTL', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability, {
      now: () => new Date('2026-08-04T00:00:00Z'),
    });

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof,
        capability,
        transportSessionId: 'session-a',
        maxAgeMs: 60_000,
        now: () => Date.parse('2026-08-04T00:02:00Z'),
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'proof_expired' });
  });

  it('rejects a forged proof signature', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability);

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof: { ...proof, signature: 'forged-signature' },
        capability,
        transportSessionId: 'session-a',
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'proof_invalid' });
  });

  it('rejects a proof issued too far in the future', () => {
    const capability = new TemplateContextCapabilityStore({
      storageDir,
      runtimeScopeId: 'scope-a',
      createSecret: () => Buffer.alloc(32, 7),
    }).getOrCreate();
    const proof = createTemplateContextProof(context, capability, {
      now: () => new Date('2026-08-05T00:10:01Z'),
    });

    expect(
      authorizeTemplateContext({
        mode: 'verified',
        context,
        proof,
        capability,
        transportSessionId: 'session-a',
        maxAgeMs: 60_000,
        now: () => Date.parse('2026-08-05T00:00:00Z'),
      }),
    ).toMatchObject({ status: 'untrusted', reason: 'issued_at_invalid' });
  });

  it('keeps unsigned context static in verified mode, permits it in legacy mode, and disables all rendering', () => {
    expect(authorizeTemplateContext({ mode: 'verified', context, transportSessionId: 'session-a' })).toMatchObject({
      status: 'untrusted',
      reason: 'proof_missing',
    });
    expect(authorizeTemplateContext({ mode: 'legacy', context, transportSessionId: 'session-a' })).toMatchObject({
      status: 'trusted',
      provenance: 'legacy-unverified',
    });
    expect(authorizeTemplateContext({ mode: 'disabled', context, transportSessionId: 'session-a' })).toMatchObject({
      status: 'disabled',
      reason: 'trust_disabled',
    });
  });
});
