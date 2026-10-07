import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import express from 'express';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApiRoutes, rejectBrowserOriginRequests } from './apiRoutes.js';
import { createCliTokenRoute } from './cliTokenRoute.js';
import { setupModernHttpRoutes } from './modernHttpRoutes.js';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
  return `http://127.0.0.1:${address.port}`;
}

it('admits fresh canonical CLI grants for REST and modern MCP while rejecting unbound and wrong audiences', async () => {
  const directory = await mkdtemp(join(tmpdir(), '1mcp-cli-audience-'));
  const config = AgentConfigManager.getInstance();
  const externalUrl = 'https://CLI.EXAMPLE:443/runtime/';
  const resource = new URL(externalUrl).href;
  const isolated = {
    ...config.getConfig(),
    externalUrl,
    runtimeScopeStoragePath: directory,
    features: { ...config.get('features'), auth: true, scopeValidation: true },
    auth: {
      ...config.get('auth'),
      credentialStore: 'file' as const,
      sessionStoragePath: join(directory, 'sessions'),
      oauthTokenTtlMs: 60_000,
    },
  };
  // Isolate configuration only; minting, verification, scope admission, routes, and bridge remain real.
  const configGetter = vi.spyOn(config, 'get').mockImplementation((key) => isolated[key]);
  const app = express();
  app.use(express.json());
  const http = createServer(app);
  let provider: SDKOAuthServerProvider | undefined;
  try {
    const base = await listen(http);
    expect(config.getUrl()).toBe(externalUrl);
    provider = new SDKOAuthServerProvider(join(directory, 'inbound'), 'cli-audience-runtime');
    const manager = ServerManager.getOrCreateInstance(
      { name: 'cli-audience', version: '1' },
      { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} } },
      new Map(),
      {},
    );
    const auth = createScopeAuthMiddleware(provider);
    app.post('/api/auth/cli-token', rejectBrowserOriginRequests, createCliTokenRoute(provider));
    app.use('/api', createApiRoutes(manager as never, auth));
    setupModernHttpRoutes(app as never, manager as never, [auth], createModernInboundLegacyBridge, {
      allowsHost: (host) => host === new URL(base).host,
      allowsOrigin: (origin) => origin === undefined,
    });
    const browser = await fetch(`${base}/api/auth/cli-token`, { method: 'POST', headers: { Origin: base } });
    expect(browser.status).toBe(403);
    const minted = await fetch(`${base}/api/auth/cli-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'attacker.example',
        'X-Forwarded-Host': 'attacker.example',
        'X-Forwarded-For': '203.0.113.8',
      },
      body: JSON.stringify({ resource: 'https://attacker.example/mcp' }),
    });
    expect(minted.status).toBe(200);
    const fresh = z
      .object({ authRequired: z.literal(true), token: z.string(), expiresIn: z.literal(60) })
      .parse(await minted.json());
    const grant = await provider.verifyAccessToken(fresh.token);
    expect(grant.clientId).toBe('cli');
    expect(grant.resource?.href).toBe(resource);
    expect(grant.resource?.href).not.toContain('/mcp');
    expect(grant.expiresAt).toBeGreaterThan(Date.now());
    expect(grant.expiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    const rest = (token: string) => fetch(`${base}/api/inspect`, { headers: { Authorization: `Bearer ${token}` } });
    const mcp = (token: string) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'MCP-Protocol-Version': '2026-07-28',
          'Mcp-Method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: 'cli-audience', version: '1' },
            },
          },
        }),
      });
    const inspected = await rest(fresh.token);
    expect(inspected.status, await inspected.clone().text()).toBe(200);
    const insufficient = await fetch(`${base}/api/inspect?tags=cli-ungranted-${randomUUID()}`, {
      headers: { Authorization: `Bearer ${fresh.token}` },
    });
    expect(insufficient.status).toBe(403);
    expect(await insufficient.json()).toMatchObject({ error: 'insufficient_scope' });
    const admitted = await mcp(fresh.token);
    expect(admitted.status).toBe(200);
    expect(await admitted.json()).toMatchObject({ result: { tools: [] } });
    // Existing unbound tokens are not migrated; an endpoint URL is also a different audience.
    for (const wrongResource of ['', `${resource}mcp`, 'https://attacker.example/']) {
      const id = randomUUID();
      provider.oauthStorage.sessionRepository.createWithId(id, 'cli', wrongResource, grant.scopes, 60_000);
      const token = `tk-${id}`;
      for (const response of [await rest(token), await mcp(token)]) {
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ error: 'invalid_token' });
      }
    }
    const expiredId = randomUUID();
    provider.oauthStorage.sessionRepository.createWithId(expiredId, 'cli', resource, grant.scopes, -1000);
    for (const response of [await rest(`tk-${expiredId}`), await mcp(`tk-${expiredId}`)]) {
      expect(response.status).toBe(401);
    }
  } finally {
    await ServerManager.resetInstance();
    provider?.shutdown();
    http.closeAllConnections();
    await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    configGetter.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
