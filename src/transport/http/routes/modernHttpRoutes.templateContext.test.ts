import type { TemplateContextAuthorization } from '@src/core/context/templateContextTrust.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import type { ContextData } from '@src/types/context.js';

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupModernHttpRoutes } from './modernHttpRoutes.js';

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock('@src/transport/http/utils/templateContextAuthority.js', () => ({
  authorizeRequestTemplateContext: authorize,
}));
vi.mock('./modernToolHeaderRegistry.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modernToolHeaderRegistry.js')>()),
  resolveModernToolHeaderRegistry: vi.fn(async () => undefined),
}));

const context: ContextData = {
  sessionId: 'proxy-a',
  project: { path: '/project/a' },
  user: {},
  environment: {},
  timestamp: '2026-10-12T00:00:00Z',
};
const meta = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
  'io.modelcontextprotocol/clientCapabilities': {},
};
function app(authenticated = false) {
  let expire!: (sessionId: string) => void;
  const prepare = vi.fn(async () => undefined);
  const release = vi.fn();
  const retain = vi.fn(() => release);
  const manager = {
    getClients: () => new Map(),
    registerCleanup: vi.fn(),
    prepareLogicalTemplateSession: prepare,
    retainLogicalTemplateSession: retain,
    registerLogicalTemplateSessionCleanup: vi.fn((listener) => {
      expire = listener;
    }),
    getInstructionAggregator: () => ({ getFilteredInstructions: () => 'Template instruction for /project/a' }),
  };
  const createBridge = vi.fn(
    async (_manager: unknown, _config: InboundConnectionConfig, _options?: { resourceOwner?: unknown }) => ({
      targetConnectionId: 'bridge',
      close: vi.fn(),
      outbound: {
        role: 'outbound' as const,
        pin: { era: 'legacy' as const, revision: '2025-11-25' },
        request: vi.fn(async (request: { operation: string }) =>
          request.operation === 'resources/list' ? { resources: [] } : { tools: [] },
        ),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      },
    }),
  );
  const instance = express();
  instance.use(express.json());
  instance.use((_req, res, next) => {
    if (authenticated)
      res.locals.auth = { token: 'verified-token', clientId: 'same-client', grantedScopes: ['safe'], grantedTags: [] };
    next();
  });
  setupModernHttpRoutes(instance as never, manager as never, [], createBridge as never, {
    allowsHost: () => true,
    allowsOrigin: () => true,
  });
  return { instance, prepare, retain, release, createBridge, expire: (id: string) => expire(id) };
}
function post(instance: express.Express, method: string, suppliedContext: ContextData = context, extraMeta = {}) {
  return request(instance)
    .post('/mcp')
    .set('MCP-Protocol-Version', '2026-07-28')
    .set('Mcp-Method', method)
    .set('mcp-session-id', suppliedContext.sessionId!)
    .send({ jsonrpc: '2.0', id: 1, method, params: { _meta: { ...meta, context: suppliedContext, ...extraMeta } } });
}
describe('modern HTTP template ingress', () => {
  beforeEach(() => {
    authorize.mockImplementation(
      ({ context: value }: { context: ContextData }) =>
        ({
          status: 'trusted',
          provenance: 'verified-local',
          context: value,
          contextHash: 'proof-hash',
        }) as TemplateContextAuthorization,
    );
  });
  it('prepares authorized logical templates before discovery emits their instructions', async () => {
    const fixture = app();
    const response = await post(fixture.instance, 'server/discover');
    expect(response.status).toBe(200);
    expect(fixture.prepare).toHaveBeenCalledWith(
      'proxy-a',
      context,
      expect.objectContaining({ logicalTemplateSessionId: 'proxy-a' }),
    );
    expect(response.body.result.instructions).toContain('Template instruction for /project/a');
    expect(fixture.retain).toHaveBeenCalledWith('proxy-a');
    expect(fixture.release).toHaveBeenCalledOnce();
    expect(fixture.createBridge).not.toHaveBeenCalled();
  });
  it('rechecks trust on every request and never lends existing membership to untrusted context', async () => {
    const fixture = app();
    await post(fixture.instance, 'tools/list');
    authorize.mockReturnValue({ status: 'untrusted', reason: 'proof_invalid', contextHash: 'tampered' });
    const rejected = await post(fixture.instance, 'tools/list');
    expect(rejected.status).toBe(200);
    expect(fixture.prepare).toHaveBeenCalledTimes(1);
    expect(fixture.createBridge.mock.calls[1][1]).not.toHaveProperty('logicalTemplateSessionId');
    expect(fixture.createBridge.mock.calls[1][1]).not.toHaveProperty('context');
  });

  it('rejects changed effective inputs and preserves membership when only timestamps change', async () => {
    const fixture = app();
    await post(fixture.instance, 'tools/list');
    const later = await post(fixture.instance, 'tools/list', { ...context, timestamp: '2026-10-12T00:01:00Z' });
    expect(later.status).toBe(200);
    expect(fixture.createBridge.mock.calls[1][1]).toEqual(fixture.createBridge.mock.calls[0][1]);
    const changed = await post(fixture.instance, 'tools/list', { ...context, project: { path: '/project/b' } });
    expect(changed.body.error).toBeDefined();
    expect(fixture.createBridge).toHaveBeenCalledTimes(2);
    expect(fixture.prepare).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'partitions resource ownership by logical proxy session with authenticated=%s',
    async (authenticated) => {
      const fixture = app(authenticated);
      const first = await post(fixture.instance, 'resources/list');
      expect(first.status).toBe(200);
      expect(first.body.error, JSON.stringify(first.body)).toBeUndefined();
      const second = await post(fixture.instance, 'resources/list', { ...context, sessionId: 'proxy-b' });
      expect(second.status).toBe(200);
      expect(second.body.error, JSON.stringify(second.body)).toBeUndefined();
      const repeated = await post(fixture.instance, 'resources/list', { ...context, timestamp: '2026-10-12T00:01:00Z' });
      expect(repeated.status).toBe(200);
      expect(repeated.body.error, JSON.stringify(repeated.body)).toBeUndefined();
      const owners = fixture.createBridge.mock.calls.map((call) => call[2]?.resourceOwner);
      expect(owners[0]).toBeDefined();
      expect(owners[1]).not.toBe(owners[0]);
      expect(owners[2]).toBe(owners[0]);
      fixture.expire('proxy-a');
      const recreated = await post(fixture.instance, 'resources/list');
      expect(recreated.status).toBe(200);
      expect(recreated.body.error, JSON.stringify(recreated.body)).toBeUndefined();
      expect(fixture.createBridge.mock.calls[3][2]?.resourceOwner).not.toBe(owners[0]);
    },
  );

  it('strips raw context and proof before the outbound backend hop', async () => {
    const fixture = app();
    const response = await post(fixture.instance, 'tools/list', context, { caller: 'unsafe' });
    expect(response.status).toBe(200);
    const bridge = await fixture.createBridge.mock.results[0].value;
    expect(bridge.outbound.request).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'tools/list', params: {} }),
    );
  });
});
