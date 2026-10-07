import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';
import { createOAuthRoutes } from '@src/transport/http/routes/oauthRoutes.js';
import { createTransports } from '@src/transport/transportFactory.js';

import express from 'express';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { startOfficialReferenceServer } from '../conformance/official/referenceServer.js';

const revision = '2026-07-28';
const capabilities = { roots: {}, sampling: {}, elicitation: { form: {} } };
const meta = {
  'io.modelcontextprotocol/protocolVersion': revision,
  'io.modelcontextprotocol/clientInfo': { name: 'owned-manual-mrtr', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': capabilities,
};
const inputRequired = z.object({
  resultType: z.literal('input_required'),
  requestState: z.string().min(1),
  inputRequests: z.record(z.string(), z.object({ method: z.string(), params: z.unknown() })),
});
const envelope = z.object({ result: z.unknown().optional(), error: z.unknown().optional() });
const accepted = (content: Record<string, unknown>) => ({ action: 'accept', content });

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback listener');
  return `http://127.0.0.1:${address.port}`;
}

it(
  'manually resumes the pinned reference through real OAuth admission and owner-bound gateway continuations',
  { retry: 0 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), '1mcp-reference-mrtr-'));
    const cleanup: Array<() => Promise<unknown> | void> = [];
    const cleanupResults: PromiseSettledResult<unknown>[] = [];
    const config = AgentConfigManager.getInstance();
    const isolated = {
      ...config.getConfig(),
      runtimeScopeStoragePath: directory,
      features: { ...config.get('features'), auth: true, scopeValidation: true },
      auth: {
        ...config.get('auth'),
        credentialStore: 'file' as const,
        sessionStoragePath: join(directory, 'sessions'),
      },
    };
    const configGetter = vi.spyOn(config, 'get').mockImplementation((key) => isolated[key]);
    cleanup.push(() => configGetter.mockRestore());
    const backendCalls: Array<Record<string, unknown>> = [];
    const backendStates: string[] = [];
    try {
      const reference = await startOfficialReferenceServer(process.cwd(), directory);
      cleanup.push(() => reference.close());
      const app = express();
      app.use(express.json());
      app.use(express.urlencoded({ extended: false }));
      const http = createServer(app);
      const base = await listen(http);
      cleanup.push(async () => {
        http.closeAllConnections();
        await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
      });
      const configUrl = vi.spyOn(config, 'getUrl').mockReturnValue(base);
      cleanup.push(() => configUrl.mockRestore());
      const provider = new SDKOAuthServerProvider(join(directory, 'inbound'), 'owned-mrtr-runtime');
      cleanup.push(() => provider.shutdown());
      const issuerUrl = new URL(`${base}/`);
      app.use(
        mcpAuthRouter({
          provider,
          issuerUrl,
          baseUrl: issuerUrl,
          authorizationOptions: { rateLimit: false },
          tokenOptions: { rateLimit: false },
          clientRegistrationOptions: { rateLimit: false },
        }),
      );
      app.use('/oauth', createOAuthRoutes(provider));
      const registration = await fetch(`${base}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'owned-mrtr',
          redirect_uris: [`${base}/client/callback`],
          grant_types: ['authorization_code'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      expect(registration.status, await registration.clone().text()).toBe(201);
      const { client_id: clientId } = z.object({ client_id: z.string() }).parse(await registration.json());
      const grant = async () => {
        const verifier = randomBytes(48).toString('base64url');
        const state = randomBytes(24).toString('base64url');
        const authorization = new URL(`${base}/authorize`);
        authorization.search = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: `${base}/client/callback`,
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
          resource: new URL(base).href,
        }).toString();
        const consent = await fetch(authorization, { redirect: 'manual' });
        expect(consent.status).toBe(200);
        const page = await consent.text();
        const requestId = /name="auth_request_id" value="([^" ]+)"/u.exec(page)?.[1];
        expect(requestId).toBeDefined();
        const approval = await fetch(`${base}/oauth/consent`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ auth_request_id: requestId!, action: 'approve' }),
        });
        expect(approval.status, await approval.clone().text()).toBe(302);
        const callback = new URL(approval.headers.get('location')!);
        expect(callback.searchParams.get('state')).toBe(state);
        const exchange = await fetch(`${base}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            redirect_uri: `${base}/client/callback`,
            code: callback.searchParams.get('code')!,
            code_verifier: verifier,
            resource: new URL(base).href,
          }),
        });
        expect(exchange.status, await exchange.clone().text()).toBe(200);
        return z.object({ access_token: z.string() }).parse(await exchange.json()).access_token;
      };
      const token = await grant();
      const secondToken = await grant();
      expect(token).not.toBe(secondToken);
      expect(await provider.verifyAccessToken(token)).toMatchObject({ clientId, resource: new URL(base) });
      expect(await provider.verifyAccessToken(secondToken)).toMatchObject({ clientId, resource: new URL(base) });

      const configured = createTransports({
        reference: { type: 'http', url: reference.endpoint, protocolVersion: revision },
      }).reference;
      const upstreamProvider = configured.oauthProvider!;
      cleanup.push(() => upstreamProvider.shutdown());
      cleanup.push(() => configured.close());
      // Public fetch seam observes actual wire requests while retaining the production endpoint guard.
      const transport = Object.assign(
        new StreamableHTTPClientTransport(new URL(reference.endpoint), {
          authProvider: upstreamProvider,
          fetch: async (input, init) => {
            const request = new Request(input, init);
            const body = request.method === 'POST' ? await request.clone().json() : undefined;
            if (body?.method === 'tools/call') backendCalls.push(body.params);
            const response = await upstreamProvider.fetch(input, init);
            if (body?.method === 'tools/call' && response.headers.get('content-type')?.includes('application/json')) {
              const returned = await response.clone().json();
              if (typeof returned.result?.requestState === 'string') backendStates.push(returned.result.requestState);
            }
            return response;
          },
        }),
        { oauthProvider: upstreamProvider, outboundProtocolVersion: revision },
      ) as AuthProviderTransport;
      const client = new Client(
        { name: 'gateway-reference', version: '1' },
        { capabilities, versionNegotiation: { mode: { pin: revision } } },
      );
      await client.connect(transport as never);
      const connection = createLegacyOutboundConnection({
        name: 'reference',
        client,
        transport,
        status: ClientStatus.Connected,
        capabilities: client.getServerCapabilities(),
      });
      cleanup.push(() => connection.adapter.close());
      const manager = ServerManager.getOrCreateInstance(
        { name: 'owned-reference-gateway', version: '1' },
        { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} } },
        new Map([['reference', connection]]),
        {},
      );
      cleanup.push(() => ServerManager.resetInstance());
      setupModernHttpRoutes(
        app as never,
        manager as never,
        [createScopeAuthMiddleware(provider)],
        createModernInboundLegacyBridge,
        {
          allowsHost: (host) => host === new URL(base).host,
          allowsOrigin: (origin) => origin === undefined || origin === base,
        },
      );
      let id = 0;
      const request = async (
        method: string,
        params: Record<string, unknown>,
        credential = token,
        requestMeta = meta,
      ) => {
        const response = await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credential}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'MCP-Protocol-Version': revision,
            'Mcp-Method': method,
            ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: requestMeta } }),
        });
        return envelope.parse(await response.json());
      };
      const listed = await request('tools/list', {});
      expect(listed.error).toBeUndefined();
      const { tools } = z.object({ tools: z.array(z.object({ name: z.string() })) }).parse(listed.result);
      const tool = (suffix: string) => {
        const matches = tools.filter(({ name }) => name.endsWith(suffix));
        expect(matches).toHaveLength(1);
        return matches[0].name;
      };
      const call = (
        name: string,
        state?: string,
        responses?: Record<string, unknown>,
        credential = token,
        args: Record<string, unknown> = {},
      ) =>
        request(
          'tools/call',
          {
            name,
            arguments: args,
            ...(state === undefined ? {} : { requestState: state }),
            ...(responses === undefined ? {} : { inputResponses: responses }),
          },
          credential,
        );
      const rejectBeforeDispatch = async (action: () => ReturnType<typeof call>) => {
        const count = backendCalls.length;
        expect((await action()).error).toBeDefined();
        expect(backendCalls).toHaveLength(count);
      };
      const stateName = tool('test_input_required_result_request_state');
      const first = inputRequired.parse((await call(stateName)).result);
      expect(first.requestState).not.toBe(backendStates[0]);
      expect(Object.keys(first.inputRequests)).toEqual(['confirm']);
      const confirm = { confirm: accepted({ ok: true }) };
      await rejectBeforeDispatch(() => call(stateName, `${first.requestState}x`, confirm));
      await rejectBeforeDispatch(() => call(stateName, first.requestState, confirm, secondToken));
      await rejectBeforeDispatch(() => call(stateName, first.requestState, confirm, token, { changed: true }));
      await rejectBeforeDispatch(() =>
        request(
          'tools/call',
          { name: stateName, arguments: {}, requestState: first.requestState, inputResponses: confirm },
          token,
          { ...meta, 'io.modelcontextprotocol/clientCapabilities': { ...capabilities, roots: { listChanged: true } } },
        ),
      );
      await rejectBeforeDispatch(() => call(stateName, first.requestState, { confirm: accepted({ ok: 'invalid' }) }));
      expect((await call(stateName, first.requestState, confirm)).result).toMatchObject({
        content: [{ text: 'state-ok: requestState validated' }],
      });
      expect(backendCalls).toHaveLength(2);
      expect(backendCalls[1].requestState).toBe(backendStates[0]);
      expect(backendCalls[1].inputResponses).toEqual(confirm);
      await rejectBeforeDispatch(() => call(stateName, first.requestState, confirm));

      const roundName = tool('test_input_required_result_multi_round');
      const round1 = inputRequired.parse((await call(roundName)).result);
      const round2 = inputRequired.parse(
        (await call(roundName, round1.requestState, { step1: accepted({ name: 'Alice' }) })).result,
      );
      expect(round2.requestState).not.toBe(round1.requestState);
      await rejectBeforeDispatch(() => call(roundName, round1.requestState, { step1: accepted({ name: 'Alice' }) }));
      expect((await call(roundName, round2.requestState, { step2: accepted({ color: 'blue' }) })).result).toMatchObject(
        { content: [{ text: 'Multi-round complete for Alice who likes blue' }] },
      );
      expect(backendCalls).toHaveLength(5);
      expect(backendCalls[3].requestState).toBe(backendStates[1]);
      expect(backendCalls[4].requestState).toBe(backendStates[2]);

      const multipleName = tool('test_input_required_result_multiple_inputs');
      const batch = inputRequired.parse((await call(multipleName)).result);
      expect(Object.keys(batch.inputRequests).sort()).toEqual(['client_roots', 'greeting', 'user_name']);
      const partial = inputRequired.parse(
        (await call(multipleName, batch.requestState, { user_name: accepted({ name: 'Alice' }) })).result,
      );
      expect(partial.requestState).not.toBe(batch.requestState);
      expect(Object.keys(partial.inputRequests).sort()).toEqual(['client_roots', 'greeting']);
      expect(backendCalls).toHaveLength(6);
      await rejectBeforeDispatch(() =>
        call(multipleName, batch.requestState, { user_name: accepted({ name: 'Alice' }) }),
      );
      const remaining = {
        greeting: {
          role: 'assistant',
          model: 'fixture',
          content: { type: 'text', text: 'Hello' },
          stopReason: 'endTurn',
        },
        client_roots: { roots: [{ uri: 'file:///owned' }] },
      };
      expect((await call(multipleName, partial.requestState, remaining)).result).toMatchObject({
        content: [{ text: 'Name: Alice; Greeting: Hello; Roots: 1' }],
      });
      expect(backendCalls).toHaveLength(7);
      expect(backendCalls[6].requestState).toBe(backendStates[3]);
      expect(backendCalls[6].inputResponses).toEqual({ user_name: accepted({ name: 'Alice' }), ...remaining });
      await rejectBeforeDispatch(() => call(multipleName, partial.requestState, remaining));
      for (const params of backendCalls) {
        expect(params.arguments).toEqual({});
        expect(params._meta).toMatchObject({ 'io.modelcontextprotocol/clientCapabilities': capabilities });
      }
      expect(backendStates).toHaveLength(4);
      expect(
        new Set([
          first.requestState,
          round1.requestState,
          round2.requestState,
          batch.requestState,
          partial.requestState,
        ]).size,
      ).toBe(5);
    } finally {
      for (const close of cleanup.reverse()) {
        cleanupResults.push(...(await Promise.allSettled([Promise.resolve().then(close)])));
      }
      await rm(directory, { recursive: true, force: true });
    }
    expect(cleanupResults.filter((result) => result.status === 'rejected')).toEqual([]);
  },
);
