import http from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import {
  fetchRuntimeIdentity,
  fetchRuntimeTargetUrl,
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

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://prod.example.com/.well-known/1mcp/runtime-identity',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        signal: expect.any(AbortSignal),
        maxBodyBytes: expect.any(Number),
      }),
    );

    await expect(
      fetchRuntimeIdentity('https://prod.example.com', {
        fetch: async () => jsonResponse({ ...identity, runtimeScopeId: undefined }),
      }),
    ).rejects.toMatchObject({ code: 'identity_invalid' });
  });

  it('passes stored TLS trust metadata to runtime identity fetches', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(identity));

    await fetchRuntimeIdentity('https://prod.example.com/mcp', {
      fetch: fetchImpl,
      caFile: '/etc/ssl/prod-ca.pem',
      insecureSkipVerify: true,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://prod.example.com/.well-known/1mcp/runtime-identity',
      expect.objectContaining({
        tls: {
          caFile: '/etc/ssl/prod-ca.pem',
          insecureSkipVerify: true,
        },
      }),
    );
  });

  it('bounds node TLS fetch duration and response size', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"too":"large"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('expected TCP server address');
      }
      await expect(
        fetchRuntimeTargetUrl(`http://127.0.0.1:${address.port}/identity`, {
          tls: { insecureSkipVerify: true },
          maxBodyBytes: 4,
        }),
      ).rejects.toMatchObject({ code: 'identity_response_too_large' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('bounds default fetch responses when a max body size is configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"too":"large"}', { status: 200 })),
    );
    try {
      await expect(
        fetchRuntimeTargetUrl('https://prod.example.com/identity', {
          maxBodyBytes: 4,
        }),
      ).rejects.toMatchObject({ code: 'identity_response_too_large' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('warns on externalUrl mismatch but fails closed on runtimeScopeId mismatch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ...identity, externalUrl: 'https://proxy.example.com' }));
    await expect(
      verifyRuntimeIdentityForTarget({
        target: target({ caFile: '/etc/ssl/prod-ca.pem', insecureSkipVerify: true }),
        fetch: fetchImpl,
      }),
    ).resolves.toMatchObject({
      identity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      warnings: [expect.objectContaining({ code: 'warning_external_url_mismatch' })],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://prod.example.com/.well-known/1mcp/runtime-identity',
      expect.objectContaining({
        tls: {
          caFile: '/etc/ssl/prod-ca.pem',
          insecureSkipVerify: true,
        },
      }),
    );

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

  it('requires imported insecure TLS confirmation before credentialed attachment fetches identity', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(identity));

    await expect(
      verifyNamedRemoteTargetAttachment({
        target: { ...target(), insecureTlsConfirmationRequired: true },
        fetch: fetchImpl,
        onCredentialUseReady: () => {
          throw new Error('credentials should not be released before confirmation');
        },
      }),
    ).rejects.toMatchObject({
      code: 'target_insecure_tls_confirmation_required',
      recoveryCommand: '1mcp target verify prod --accept-insecure-tls',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  function target(overrides: Partial<StoredRuntimeTarget> = {}): StoredRuntimeTarget {
    return {
      name: 'prod',
      url: 'https://prod.example.com',
      observedIdentity: identity,
      lastVerifiedAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      ...overrides,
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
