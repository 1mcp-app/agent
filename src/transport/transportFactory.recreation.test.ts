import {
  Client as ModernClient,
  SSEClientTransport as ModernSSEClientTransport,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { TransportRecreator } from '@src/core/client/transportRecreator.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';

import { describe, expect, it, vi } from 'vitest';

import { createTransports, createTransportsWithContext } from './transportFactory.js';

vi.mock('@src/auth/sdkOAuthClientProvider.js', () => ({
  SDKOAuthClientProvider: class {},
}));

vi.mock('@src/core/runtime/runtimeIdentityService.js', () => ({
  RuntimeIdentityService: class {
    getRuntimeScopeId(): string {
      return 'scope_transport_factory_recreation';
    }
  },
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => ({
      getUrl: () => 'http://localhost:3050',
      get: () => ({}),
      isEnvSubstitutionEnabled: () => false,
    }),
  },
}));

describe.each(['auto', 'legacy', '2026-07-28'] as const)('factory recreation (%s)', (protocolVersion) => {
  const recreator = new TransportRecreator();
  const config: Record<string, MCPServerParams> = {
    upstream: {
      type: 'http',
      url: 'https://example.com/mcp',
      protocolVersion,
      headers: { 'X-Configured': 'retained' },
      connectionTimeout: 1234,
      requestTimeout: 5678,
      timeout: 9000,
      tags: ['configured'],
    },
  };

  it.each([
    ['createTransports', createTransports],
    ['createTransportsWithContext', createTransportsWithContext],
  ] as const)('honors session preservation through %s and runtime recreation', async (_name, create) => {
    const original = (await create(config)).upstream;
    // Model a session assigned by the backend after construction.
    Object.assign(original, { _sessionId: 'live-session' });
    const HttpTransport =
      protocolVersion === 'legacy' ? StreamableHTTPClientTransport : ModernStreamableHTTPClientTransport;

    const replacements = [
      original.recreate!(),
      original.recreate!({}),
      original.recreate!({ preserveSessionId: true }),
      recreator.recreateForRetry(original),
      recreator.recreateHttpTransport(original),
      recreator.recreateHttpTransport(original, undefined, { preserveSessionId: true }),
    ];
    for (const replacement of replacements) {
      expect(replacement).not.toBe(original);
      expect(replacement).toBeInstanceOf(HttpTransport);
      expect(replacement.sessionId).toBe('live-session');
      expect(replacement).toMatchObject({
        outboundProtocolVersion: protocolVersion,
        connectionTimeout: 1234,
        requestTimeout: 5678,
        timeout: 9000,
        tags: ['configured'],
        _requestInit: { headers: { 'X-Configured': 'retained' } },
        recreate: expect.any(Function),
        oauthProvider: expect.any(Object),
      });
    }

    Object.assign(replacements[0], { _sessionId: 'next-session' });
    expect(replacements[0].recreate!().sessionId).toBe('next-session');
    expect(original.recreate!({ preserveSessionId: false }).sessionId).toBeUndefined();
    expect(recreator.recreateForRetry(original, undefined, { preserveSessionId: false }).sessionId).toBeUndefined();
    expect(
      recreator.recreateHttpTransport(original, undefined, { preserveSessionId: false }).sessionId,
    ).toBeUndefined();
    expect(recreator.recreateForSessionLoss(original).sessionId).toBeUndefined();
    expect(original.sessionId).toBe('live-session');
  });

  it.each([
    ['createTransports', createTransports],
    ['createTransportsWithContext', createTransportsWithContext],
  ] as const)(
    'retains the client protocol and configured deadlines/tags through repeated Backend Sleep recreation from %s',
    async (_name, create) => {
      const original = (
        await create({
          upstream: {
            type: 'stdio',
            command: 'unused-backend-fixture',
            protocolVersion,
            connectionTimeout: 1234,
            requestTimeout: 5678,
            timeout: 9000,
            tags: ['configured'],
            sleep: { enabled: true, idleTimeoutMs: 45_000 },
          },
        })
      ).upstream;
      const replacement = original.backendSleep!.recreate();
      const nextReplacement = replacement.backendSleep!.recreate();
      for (const candidate of [replacement, nextReplacement]) {
        expect(candidate).toMatchObject({
          outboundProtocolVersion: protocolVersion,
          connectionTimeout: 1234,
          requestTimeout: 5678,
          timeout: 9000,
          tags: ['configured'],
          recreate: expect.any(Function),
          backendSleep: { idleTimeoutMs: 45_000 },
        });
        expect(new ClientFactory().createClient(candidate)).toBeInstanceOf(
          protocolVersion === 'legacy' ? LegacyClient : ModernClient,
        );
      }
    },
  );

  it('retains the SSE family and configuration on recreation', () => {
    const original = createTransports({ upstream: { ...config.upstream, type: 'sse' } }).upstream;
    const replacement = recreator.recreateForRetry(original);

    expect(replacement).toBeInstanceOf(protocolVersion === 'legacy' ? SSEClientTransport : ModernSSEClientTransport);
    expect(replacement).toMatchObject({
      outboundProtocolVersion: protocolVersion,
      connectionTimeout: 1234,
      requestTimeout: 5678,
      timeout: 9000,
      tags: ['configured'],
      _requestInit: { headers: { 'X-Configured': 'retained' } },
    });
  });
});

describe.each(['legacy', '2026-07-28'] as const)('Backend Sleep failed spawn cleanup (%s)', (protocolVersion) => {
  it('releases a synchronous native spawn failure without a child', async () => {
    const prototype = Object.getPrototypeOf(
      createTransports({ sample: { command: 'unused', type: 'stdio', protocolVersion } }).sample,
    );
    const start = vi
      .spyOn(prototype, 'start')
      .mockRejectedValue(Object.assign(new Error('spawn EPERM'), { code: 'EPERM', syscall: 'spawn' }));
    const transport = createTransports({
      rejected: { command: 'unused', type: 'stdio', protocolVersion, sleep: { enabled: true } },
    }).rejected;
    try {
      await expect(transport.start()).rejects.toMatchObject({ code: 'EPERM' });
      await expect(transport.backendSleep!.release()).resolves.toBeUndefined();
    } finally {
      start.mockRestore();
      await transport.close();
    }
  });

  it.each([undefined, 12345])('retains child creation evidence through a rejected start (pid %s)', async (pid) => {
    const transportClass = Object.getPrototypeOf(
      createTransports({ sample: { command: 'unused', type: 'stdio', protocolVersion } }).sample,
    );
    const start = vi.spyOn(transportClass, 'start').mockImplementation(function (this: { _process?: unknown }) {
      this._process = Object.assign(new EventEmitter(), { pid });
      return Promise.resolve().then(() => {
        this._process = undefined;
        throw Object.assign(new Error('spawn rejected'), { code: 'EPERM' });
      });
    });
    const transport = createTransports({
      rejected: { command: 'unused', type: 'stdio', protocolVersion, sleep: { enabled: true } },
    }).rejected;
    try {
      await expect(transport.start()).rejects.toMatchObject({ code: 'EPERM' });
      if (pid === undefined) await expect(transport.backendSleep!.release()).resolves.toBeUndefined();
      else await expect(transport.backendSleep!.release()).rejects.toThrow(/ownership/);
    } finally {
      start.mockRestore();
      await transport.close();
    }
  });

  it('proves no child needs release when spawning an absent executable fails', async () => {
    const transports = await createTransports({
      missing: {
        type: 'stdio',
        command: '/nonexistent/1mcp-backend-sleep-fixture',
        protocolVersion,
        sleep: { enabled: true },
      },
    });
    const transport = transports.missing;
    transport.onerror = () => {};
    try {
      await expect(transport.start()).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(transport.backendSleep!.release()).resolves.toBeUndefined();
    } finally {
      await transport.close();
    }
  });
  it.skipIf(process.platform === 'win32')(
    'proves no child needs release when the executable lacks execute permission',
    async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-sleep-spawn-'));
      const command = path.join(directory, 'not-executable');
      fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
      const transport = (
        await createTransports({ denied: { type: 'stdio', command, protocolVersion, sleep: { enabled: true } } })
      ).denied;
      transport.onerror = () => {};
      try {
        await expect(transport.start()).rejects.toMatchObject({ code: 'EACCES' });
        await expect(transport.backendSleep!.release()).resolves.toBeUndefined();
      } finally {
        await transport.close();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
