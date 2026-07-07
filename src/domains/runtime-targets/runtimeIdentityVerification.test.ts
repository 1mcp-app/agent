import { describe, expect, it, vi } from 'vitest';

import {
  fetchRuntimeIdentity,
  verifyNamedRemoteTargetAttachment,
  verifyRuntimeIdentityForTarget,
} from './runtimeIdentityVerification.js';
import type { RuntimeTargetObservedIdentity, StoredRuntimeTarget } from './runtimeTargetStore.js';

describe('runtime target identity verification', () => {
  const identity: RuntimeTargetObservedIdentity = {
    identityProtocolVersion: '1',
    runtimeScopeId: 'scope_prod',
    externalUrl: 'https://prod.example.com',
    runtimeVersion: '0.34.0',
  };

  it('fetches the well-known identity endpoint, validates required fields, and omits credentials', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(identity));

    await expect(fetchRuntimeIdentity('https://prod.example.com/mcp', { fetch: fetchImpl })).resolves.toEqual(identity);

    expect(fetchImpl).toHaveBeenCalledWith('https://prod.example.com/.well-known/1mcp/runtime-identity', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });

    await expect(
      fetchRuntimeIdentity('https://prod.example.com', {
        fetch: async () => jsonResponse({ ...identity, runtimeScopeId: undefined }),
      }),
    ).rejects.toMatchObject({ code: 'identity_invalid' });
  });

  it('warns on externalUrl mismatch but fails closed on runtimeScopeId mismatch', async () => {
    await expect(
      verifyRuntimeIdentityForTarget({
        target: target(),
        fetch: async () => jsonResponse({ ...identity, externalUrl: 'https://proxy.example.com' }),
      }),
    ).resolves.toMatchObject({
      identity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      warnings: [expect.objectContaining({ code: 'warning_external_url_mismatch' })],
    });

    await expect(
      verifyRuntimeIdentityForTarget({
        target: target(),
        fetch: async () => jsonResponse({ ...identity, runtimeScopeId: 'scope_other' }),
      }),
    ).rejects.toMatchObject({
      code: 'identity_runtime_scope_mismatch',
      recoveryCommand: '1mcp target add prod https://prod.example.com --replace --accept-new-identity',
    });
  });

  it('checks named remote identity before allowing credential use', async () => {
    let credentialUseCount = 0;

    await expect(
      verifyNamedRemoteTargetAttachment({
        target: target(),
        fetch: async () => jsonResponse({ ...identity, runtimeScopeId: 'scope_other' }),
        onCredentialUseReady: () => {
          credentialUseCount += 1;
        },
      }),
    ).rejects.toMatchObject({ code: 'identity_runtime_scope_mismatch' });
    expect(credentialUseCount).toBe(0);

    await expect(
      verifyNamedRemoteTargetAttachment({
        target: target(),
        fetch: async () => jsonResponse(identity),
        onCredentialUseReady: () => {
          credentialUseCount += 1;
        },
      }),
    ).resolves.toMatchObject({ identity });
    expect(credentialUseCount).toBe(1);
  });

  function target(): StoredRuntimeTarget {
    return {
      name: 'prod',
      url: 'https://prod.example.com',
      observedIdentity: identity,
      lastVerifiedAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
  }

  function jsonResponse(body: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: {
        get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
      },
    };
  }
});
