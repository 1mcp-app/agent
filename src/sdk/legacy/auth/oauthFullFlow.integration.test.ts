import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getOAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';
import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { ClientManager } from '@src/core/client/clientManager.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import type { LegacyRequestId } from '@src/sdk/contracts/index.js';
import { getLegacyClient, getLegacyTransport } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';
import { createTransports } from '@src/transport/transportFactory.js';

import express from 'express';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

const CLIENT_ID = 'configured-full-flow-client';
const SCOPE = 'read';
const ACCESS_TOKEN = 'fixture-resource-access-token';

interface AuthorizationCode {
  readonly challenge: string;
  readonly redirect: string;
  readonly resource: string;
  readonly clientId: string;
  readonly scope: string;
  consumed: boolean;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture did not bind a loopback port');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

it('completes pinned-modern OAuth through production callback and reconnect before using the protected resource', async () => {
  const directory = await mkdtemp(join(tmpdir(), '1mcp-oauth-full-flow-'));
  const config = AgentConfigManager.getInstance();
  const isolatedConfig = {
    ...config.getConfig(),
    runtimeScopeStoragePath: directory,
    auth: {
      ...config.get('auth'),
      credentialStore: 'file' as const,
      sessionStoragePath: join(directory, 'serverSessions'),
    },
  };
  // Change storage locations only; network policy, callback validation, and reconnection remain real.
  const storageConfig = vi.spyOn(config, 'get').mockImplementation((key) => isolatedConfig[key]);
  const servers: Server[] = [];
  const codes = new Map<string, AuthorizationCode>();
  const tokenRequests: URLSearchParams[] = [];
  const issuerCredentials: Array<string | undefined> = [];
  const resourceRequests: Array<{ method: string; authorization: string | undefined; sessionId: string | undefined }> =
    [];
  let authorized = false;
  let issuerUrl = '';
  let resourceUrl = '';
  let redirectUrl = '';
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'protected-full-flow-resource', version: '1' });
      server.registerTool('echo', { inputSchema: { message: z.string() } }, async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }));
      return server;
    },
    { legacy: 'reject' },
  );
  const nodeHandler = toNodeHandler(handler);
  let inboundProvider: SDKOAuthServerProvider | undefined;
  let originalProvider: ReturnType<typeof createTransports>[string]['oauthProvider'];
  try {
    const issuer = express();
    issuer.use(express.urlencoded({ extended: false }));
    issuer.use((request, _response, next) => {
      issuerCredentials.push(request.headers.authorization);
      next();
    });
    issuer.get('/.well-known/oauth-authorization-server', (_request, response) => {
      response.json({
        issuer: issuerUrl,
        authorization_endpoint: `${issuerUrl}/authorize`,
        token_endpoint: `${issuerUrl}/token`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: [SCOPE],
        code_challenge_methods_supported: ['S256'],
        authorization_response_iss_parameter_supported: true,
      });
    });
    issuer.get('/authorize', (request, response) => {
      const authorization = z
        .object({
          response_type: z.literal('code'),
          client_id: z.literal(CLIENT_ID),
          redirect_uri: z.literal(redirectUrl),
          resource: z.literal(resourceUrl),
          scope: z.literal(SCOPE),
          state: z.string().min(1),
          code_challenge: z.string().min(43),
          code_challenge_method: z.literal('S256'),
        })
        .safeParse(request.query);
      if (!authorization.success) {
        response.status(400).json({ error: 'invalid_request' });
        return;
      }
      const value = authorization.data;
      const code = randomBytes(24).toString('base64url');
      codes.set(code, {
        challenge: value.code_challenge,
        redirect: value.redirect_uri,
        resource: value.resource,
        clientId: value.client_id,
        scope: value.scope,
        consumed: false,
      });
      const callback = new URL(value.redirect_uri);
      callback.search = new URLSearchParams({ state: value.state, code, iss: issuerUrl }).toString();
      response.redirect(callback.href);
    });
    issuer.post('/token', (request, response) => {
      const body = new URLSearchParams(request.body as Record<string, string>);
      tokenRequests.push(body);
      const code = codes.get(body.get('code') ?? '');
      if (!code || code.consumed) {
        response.status(400).json({ error: 'invalid_grant' });
        return;
      }
      const exchange = z
        .object({
          grant_type: z.literal('authorization_code'),
          client_id: z.literal(code.clientId),
          redirect_uri: z.literal(code.redirect),
          resource: z.literal(code.resource),
          scope: z.literal(code.scope).optional(),
          code_verifier: z.string().min(43),
        })
        .safeParse(request.body);
      if (!exchange.success) {
        response.status(400).json({ error: 'invalid_grant' });
        return;
      }
      const challenge = createHash('sha256').update(exchange.data.code_verifier).digest('base64url');
      if (challenge !== code.challenge) {
        response.status(400).json({ error: 'invalid_grant' });
        return;
      }
      code.consumed = true;
      authorized = true;
      response.json({ access_token: ACCESS_TOKEN, token_type: 'Bearer', scope: code.scope, expires_in: 3600 });
    });
    const issuerServer = createServer(issuer);
    servers.push(issuerServer);
    issuerUrl = await listen(issuerServer);

    const resource = express();
    resource.get('/.well-known/oauth-protected-resource/mcp', (_request, response) => {
      response.json({ resource: resourceUrl, authorization_servers: [issuerUrl], scopes_supported: [SCOPE] });
    });
    resource.all('/mcp', async (request, response) => {
      const method = request.headers['mcp-method'];
      resourceRequests.push({
        method: typeof method === 'string' ? method : request.method,
        authorization: request.headers.authorization,
        sessionId:
          typeof request.headers['mcp-session-id'] === 'string' ? request.headers['mcp-session-id'] : undefined,
      });
      if (!authorized || request.headers.authorization !== `Bearer ${ACCESS_TOKEN}`) {
        response.setHeader(
          'WWW-Authenticate',
          `Bearer resource_metadata="${resourceUrl.replace('/mcp', '')}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`,
        );
        response.status(401).end();
        return;
      }
      await nodeHandler(request, response);
    });
    const resourceServer = createServer(resource);
    servers.push(resourceServer);
    resourceUrl = `${await listen(resourceServer)}/mcp`;

    const callbackApp = express();
    const callbackServer = createServer(callbackApp);
    servers.push(callbackServer);
    const callbackBase = await listen(callbackServer);
    redirectUrl = `${callbackBase}/oauth/callback/upstream`;
    inboundProvider = new SDKOAuthServerProvider(join(directory, 'inbound'), 'oauth-full-flow-runtime');
    const manager = ClientManager.getOrCreateInstance();
    const flow = getOAuthAuthorizationFlow(inboundProvider, {
      serverRuntime: manager,
      clientRuntime: manager,
      createTokenId: () => randomBytes(24).toString('base64url'),
      getAuthConfig: () => ({ enabled: true, oauthTokenTtlMs: 60_000 }),
      getResourceUrl: () => config.getUrl(),
      getAvailableTags: () => [],
    });
    callbackApp.use('/oauth', createOAuthRoutes(inboundProvider, undefined, flow));
    const transport = createTransports({
      upstream: {
        type: 'http',
        url: resourceUrl,
        protocolVersion: '2026-07-28',
        connectionTimeout: 3000,
        oauth: { issuer: issuerUrl, clientId: CLIENT_ID, redirectUrl, scopes: [SCOPE], autoRegister: false },
      },
    }).upstream;
    originalProvider = transport.oauthProvider;
    await manager.createClients({ upstream: transport });
    expect(manager.getClient('upstream').status).toBe(ClientStatus.AwaitingOAuth);
    expect(resourceRequests.some((request) => request.authorization === undefined)).toBe(true);
    expect(tokenRequests).toHaveLength(0);

    const start = await fetch(`${callbackBase}/oauth/authorize/upstream`, { redirect: 'manual' });
    expect(start.status).toBe(302);
    const authorizationUrl = new URL(start.headers.get('location')!);
    expect(authorizationUrl.origin).toBe(issuerUrl);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const approval = await fetch(authorizationUrl, { redirect: 'manual' });
    expect(approval.status).toBe(302);
    const callback = new URL(approval.headers.get('location')!);
    expect(callback.searchParams.get('state')).toBe(authorizationUrl.searchParams.get('state'));
    expect(callback.searchParams.get('iss')).toBe(issuerUrl);
    const beforeReconnect = manager.getClient('upstream');
    const previousTransport = getLegacyTransport(beforeReconnect);
    const previousClient = getLegacyClient(beforeReconnect);

    for (const invalid of ['state', 'iss'] as const) {
      const rejectedCallback = new URL(callback);
      rejectedCallback.searchParams.set(invalid, invalid === 'state' ? 'foreign-state' : `${issuerUrl}/`);
      const rejected = await fetch(rejectedCallback, { redirect: 'manual' });
      expect(rejected.headers.get('location')).toBe('/admin/oauth?error=callback_failed');
      expect(tokenRequests).toHaveLength(0);
      expect(manager.getClient('upstream').status).toBe(ClientStatus.AwaitingOAuth);
    }

    const completed = await fetch(callback, { redirect: 'manual' });
    expect(completed.headers.get('location')).toBe('/admin/oauth?success=1');
    expect(tokenRequests).toHaveLength(1);
    expect([...codes.values()]).toHaveLength(1);
    expect([...codes.values()][0].consumed).toBe(true);
    const connected = manager.getClient('upstream');
    expect(connected.status).toBe(ClientStatus.Connected);
    expect(getLegacyTransport(connected)).not.toBe(previousTransport);
    expect(getLegacyClient(connected)).not.toBe(previousClient);
    expect(connected.authorizationUrl).toBeUndefined();
    expect(connected.oauthStartTime).toBeUndefined();
    expect(connected.capabilities).toHaveProperty('tools');
    expect(connected.adapter.protocol).toMatchObject({ era: 'modern', revision: '2026-07-28' });

    await expect(
      connected.adapter.request({ id: 'list' as LegacyRequestId, method: 'tools/list' }),
    ).resolves.toMatchObject({
      tools: [{ name: 'echo' }],
    });
    await expect(
      connected.adapter.request({
        id: 'call' as LegacyRequestId,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'authenticated-resource-success' } },
      }),
    ).resolves.toMatchObject({
      content: [{ type: 'text', text: 'authenticated-resource-success' }],
    });
    const authenticatedRequests = resourceRequests.filter(
      (request) => request.authorization === `Bearer ${ACCESS_TOKEN}`,
    );
    expect(authenticatedRequests.map((request) => request.method)).toEqual(
      expect.arrayContaining(['server/discover', 'tools/list', 'tools/call']),
    );
    expect(authenticatedRequests.every((request) => request.sessionId === undefined)).toBe(true);
    expect(issuerCredentials.every((authorization) => authorization === undefined)).toBe(true);

    const replay = await fetch(callback, { redirect: 'manual' });
    expect(replay.headers.get('location')).toBe('/admin/oauth?error=callback_failed');
    expect(tokenRequests).toHaveLength(1);
    expect(manager.getClient('upstream')).toBe(connected);
  } finally {
    await ClientManager.shutdownCurrent();
    ClientManager.resetInstance();
    await originalProvider?.shutdown();
    inboundProvider?.shutdown();
    await handler.close();
    for (const server of servers.reverse()) {
      await closeServer(server);
      expect(server.listening).toBe(false);
    }
    storageConfig.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
