import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import {
  createEffectiveRequestAuthority,
  createGatewayRequestEnvelope,
  GatewayDispatcher,
  type ImmutableJsonValue,
  LegacyInboundEraAdapter,
  LegacyOutboundEraAdapter,
  ModernInboundEraAdapter,
  ModernOutboundEraAdapter,
  type ProtocolEra,
  type ProtocolEraPin,
} from '@src/gateway/index.js';
import type { LegacyConnectionId, LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  acquireBrowserGrant,
  acquireCliGrant,
  approveOpenUpstreamAuthorization,
  createUpstreamProvider,
  type OAuthEra,
  openUpstreamAuthorization,
  startAuthoritySurfaceFixture,
  startProviderAuthorization,
  startUpstreamAuthorityFixture,
} from './fixtures/oauth-authority.js';

const MATRIX = [
  ['legacy', 'legacy'],
  ['legacy', 'modern'],
  ['modern', 'legacy'],
  ['modern', 'modern'],
] as const satisfies ReadonlyArray<readonly [ProtocolEra, OAuthEra]>;

const revision = {
  legacy: '2025-11-25',
  modern: '2026-07-28',
} as const;

describe('OAuth authority across the four protocol-era cells', () => {
  let browser: Browser;

  beforeAll(async () => {
    vi.spyOn(McpConfigManager.getInstance(), 'getAvailableTags').mockReturnValue(['allowed']);
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser?.close();
    vi.restoreAllMocks();
  });

  it.each(MATRIX)(
    '%s inbound / %s upstream binds OAuth before code exchange and keeps inbound permission independent',
    async (inboundEra, upstreamEra) => {
      const upstream = await startUpstreamAuthorityFixture();
      const surface = await startAuthoritySurfaceFixture();
      const providers = [];
      try {
        const initial = createUpstreamProvider({ era: upstreamEra, upstream, surface });
        providers.push(initial);
        surface.setUpstreamProvider(initial, upstreamEra, upstream.resourceUrl);
        await startProviderAuthorization(initial, upstreamEra, upstream.resourceUrl);
        const authorizationUrl = new URL(initial.getAuthorizationUrl()!);
        const page = await browser.newPage();
        const completedCallback = await openUpstreamAuthorization(page, surface);
        expect(completedCallback.searchParams.get('state')).toBe(authorizationUrl.searchParams.get('state'));
        const callback = new URL(`${surface.baseUrl}/oauth/callback/same-display-name`);
        callback.search = new URLSearchParams({
          state: authorizationUrl.searchParams.get('state')!,
          code: 'fixture-rejected-code',
          iss: upstream.baseUrl,
        }).toString();

        const foreign = createUpstreamProvider({
          era: upstreamEra,
          upstream,
          surface,
          authority: { source: 'configured-upstream-b' },
        });
        providers.push(foreign);
        surface.setUpstreamProvider(foreign, upstreamEra, upstream.resourceUrl);
        const beforeRejectedCallback = countRequests(upstream.requests, '/token');
        const rejected = await fetch(callback, { redirect: 'manual' });
        expect(rejected.status).toBe(302);
        expect(rejected.headers.get('location')).toBe('/admin/oauth?error=callback_failed');
        expect(countRequests(upstream.requests, '/token')).toBe(beforeRejectedCallback);
        expect(rejected.headers.get('location')).not.toContain('fixture-rejected-code');

        const restarted = createUpstreamProvider({ era: upstreamEra, upstream, surface });
        providers.push(restarted);
        surface.setUpstreamProvider(restarted, upstreamEra, upstream.resourceUrl);
        try {
          await approveOpenUpstreamAuthorization(page, surface);
        } finally {
          await page.close();
        }
        expect(restarted.tokens()?.access_token).toBe('fixture-upstream-access-token');
        expect(countRequests(upstream.requests, '/token')).toBe(beforeRejectedCallback + 1);
        expect(new URLSearchParams(lastRequest(upstream.requests, '/token').body).get('resource')).toBe(
          upstream.resourceUrl,
        );

        const replay = await fetch(completedCallback, { redirect: 'manual' });
        expect(replay.headers.get('location')).toBe('/admin/oauth?error=callback_failed');
        expect(countRequests(upstream.requests, '/token')).toBe(beforeRejectedCallback + 1);

        const inboundToken =
          inboundEra === 'legacy' ? await acquireCliGrant(surface) : await acquireBrowserGrant(browser, surface);
        const grant = await surface.inboundProvider.verifyAccessToken(inboundToken);
        expect(grant.scopes).toContain('tag:allowed');

        let outboundCalls = 0;
        const outbound = createOutbound(upstreamEra, () => {
          outboundCalls++;
          return { tools: [{ name: 'allowed-tool', inputSchema: { type: 'object' } }] };
        });
        const dispatcher = new GatewayDispatcher({ resolveOutbound: () => outbound, now: () => 1_000 });
        const deniedInbound = createInbound(inboundEra, {
          target: 'blocked',
          allowed: grant.scopes.includes('tag:allowed') ? ['allowed'] : [],
          outbound: outbound.pin,
        });
        const deniedEvent = await deniedInbound.nextEvent();
        if (deniedEvent.type !== 'request') throw new Error('Inbound adapter did not produce a gateway request');
        const denied = await dispatcher.dispatch(deniedEvent.request);
        expect(denied).toMatchObject({
          ok: false,
          failure: { kind: 'authorization', code: 'gateway_target_not_authorized' },
        });
        expect(outboundCalls).toBe(0);
        expect(restarted.tokens()?.access_token).toBe('fixture-upstream-access-token');

        const allowedInbound = createInbound(inboundEra, {
          target: 'allowed',
          allowed: ['allowed'],
          outbound: outbound.pin,
        });
        const allowedEvent = await allowedInbound.nextEvent();
        if (allowedEvent.type !== 'request') throw new Error('Inbound adapter did not produce a gateway request');
        await expect(dispatcher.dispatch(allowedEvent.request)).resolves.toMatchObject({
          ok: true,
          value: { tools: [{ name: 'allowed-tool' }] },
        });
        expect(outboundCalls).toBe(1);
      } finally {
        for (const provider of providers) provider.shutdown();
        await surface.close();
        await upstream.close();
      }
    },
    30_000,
  );
});

function pin(era: ProtocolEra): ProtocolEraPin {
  return Object.freeze({ era, revision: revision[era] });
}

function createInbound(era: ProtocolEra, options: { target: string; allowed: string[]; outbound: ProtocolEraPin }) {
  const request = createGatewayRequestEnvelope({
    requestId: `${era}-${options.target}-${Math.random()}`,
    operation: 'tools/list',
    targetConnectionId: options.target,
    authority: createEffectiveRequestAuthority({
      connectionIds: options.allowed,
      provenance: ['verified-inbound-oauth-grant'],
    }),
    inbound: pin(era),
    outbound: options.outbound,
    deadlineUnixMs: 2_000,
  });
  if (era === 'legacy') {
    let delivered = false;
    return new LegacyInboundEraAdapter(
      {
        async nextEvent() {
          if (delivered) return { type: 'closed' as const };
          delivered = true;
          return { type: 'request' as const, request };
        },
        async respond() {},
        async close() {},
      },
      pin(era),
    );
  }
  let delivered = false;
  return new ModernInboundEraAdapter({
    revision: revision.modern,
    async receive() {
      if (delivered) return undefined;
      delivered = true;
      return { type: 'request', correlationId: `wire-${request.requestId}`, operation: request.operation };
    },
    async requestContext() {
      return {
        requestId: request.requestId,
        targetConnectionId: request.targetConnectionId,
        authority: request.authority,
        outbound: request.outbound,
        deadlineUnixMs: request.deadlineUnixMs,
      };
    },
    async respond() {},
  });
}

function createOutbound(era: OAuthEra, response: () => ImmutableJsonValue) {
  if (era === 'modern') {
    return new ModernOutboundEraAdapter({
      revision: revision.modern,
      request: async () => response(),
      cancel: async () => {},
      now: () => 1_000,
    });
  }
  const adapter: LegacySdkAdapter = {
    connectionId: 'oauth-authority-upstream' as LegacyConnectionId,
    state: 'running',
    async start() {},
    async nextEvent() {
      return { type: 'closed' };
    },
    async respond() {},
    async request() {
      return JSON.parse(JSON.stringify(response()));
    },
    async cancel() {},
    async notify() {},
    async close() {},
  };
  return new LegacyOutboundEraAdapter(adapter, pin('legacy'), { now: () => 1_000 });
}

function countRequests(requests: ReadonlyArray<{ path: string }>, path: string): number {
  return requests.filter((request) => request.path === path).length;
}

function lastRequest<T extends { path: string }>(requests: readonly T[], path: string): T {
  for (let index = requests.length - 1; index >= 0; index--) {
    const request = requests[index];
    if (request.path === path) return request;
  }
  throw new Error(`No request observed for ${path}`);
}
