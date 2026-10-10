import { EventEmitter } from 'node:events';

import type { BackendPreparationCoordinator } from '@src/application/backendPreparationCoordinator.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { getAuthInfo, revalidateAuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { authorizeRequestTemplateContext } from '@src/transport/http/utils/templateContextAuthority.js';
import type { ContextData } from '@src/types/context.js';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreparationHandler } from './preparationRoutes.js';

vi.mock('@src/transport/http/utils/templateContextAuthority.js', () => ({ authorizeRequestTemplateContext: vi.fn() }));
let authEnabled = true;
vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: { getInstance: () => ({ isAuthEnabled: () => authEnabled }) },
}));
vi.mock('@src/transport/http/middlewares/scopeAuthMiddleware.js', () => ({
  getAuthInfo: vi.fn(),
  revalidateAuthInfo: vi.fn(async () => true),
  getTagFilterMode: () => 'none',
  getValidatedTags: () => [],
  getTagExpression: () => undefined,
  getTagQuery: () => undefined,
  getPresetName: () => undefined,
}));

const context: ContextData = {
  project: { path: '/selected/checkout' },
  user: {},
  environment: {},
  sessionId: 'local-session',
};

function fixture() {
  const resolveGrant = vi.fn(async (value: unknown) => value);
  const control = vi.fn(async () => ({ state: 'required', action: 'initialize' }));
  const coordinator = { resolveGrant, control } as unknown as Pick<
    BackendPreparationCoordinator,
    'resolveGrant' | 'control'
  >;
  const handler = createPreparationHandler({} as ServerManager, { coordinator: () => coordinator });
  let disconnect = () => {};
  const invoke = async (body: unknown) => {
    let status = 200;
    let output: unknown;
    const res = Object.assign(new EventEmitter(), {
      locals: {},
      status: (value: number) => {
        status = value;
        return res;
      },
      json: (value: unknown) => {
        output = value;
        return res;
      },
      setHeader: vi.fn(),
    }) as unknown as Response;
    disconnect = () => res.emit('close');
    await handler(
      { body, query: {}, headers: { 'mcp-session-id': 'local-session' } } as unknown as Request,
      res,
      () => undefined,
    );
    return { status, output };
  };
  return { resolveGrant, control, invoke, disconnect: () => disconnect() };
}

beforeEach(() => {
  authEnabled = true;
  vi.mocked(authorizeRequestTemplateContext).mockReturnValue({
    status: 'trusted',
    provenance: 'verified-local',
    context,
    runtimeScopeId: 'scope',
    contextHash: 'hash',
  } as never);
  vi.mocked(revalidateAuthInfo).mockReset().mockResolvedValue(true);
  vi.mocked(getAuthInfo).mockReturnValue({
    token: 'fixture-token',
    clientId: 'fixture-client',
    grantedScopes: [],
    grantedTags: [],
  });
});

describe('preparation API authority', () => {
  it('permits a verified local proof without bearer credentials only when runtime authentication is disabled', async () => {
    authEnabled = false;
    vi.mocked(getAuthInfo).mockReturnValue(undefined);
    vi.mocked(revalidateAuthInfo).mockResolvedValue(false);
    const f = fixture();
    expect((await f.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(200);
    expect(f.resolveGrant).toHaveBeenCalledOnce();
    expect(f.control).toHaveBeenCalledOnce();
    expect(revalidateAuthInfo).not.toHaveBeenCalled();
  });

  it('rejects missing bearer authority when runtime authentication is enabled before any checkout resolution', async () => {
    vi.mocked(getAuthInfo).mockReturnValue(undefined);
    const f = fixture();
    expect((await f.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(401);
    expect(f.resolveGrant).not.toHaveBeenCalled();
    expect(f.control).not.toHaveBeenCalled();
  });

  it('rechecks the runtime authentication gate after asynchronous checkout resolution', async () => {
    authEnabled = false;
    vi.mocked(getAuthInfo).mockReturnValue(undefined);
    const f = fixture();
    f.resolveGrant.mockImplementationOnce(async (grant) => {
      authEnabled = true;
      return grant;
    });
    expect((await f.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(401);
    expect(f.resolveGrant).toHaveBeenCalledOnce();
    expect(f.control).not.toHaveBeenCalled();
  });

  it('rejects proof trust revocation during asynchronous checkout resolution before controls', async () => {
    const f = fixture();
    f.resolveGrant.mockImplementationOnce(async (grant) => {
      vi.mocked(authorizeRequestTemplateContext).mockReturnValue({
        status: 'disabled',
        reason: 'trust_disabled',
      } as never);
      return grant;
    });
    expect((await f.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(401);
    expect(f.control).not.toHaveBeenCalled();
  });
  it.each(['prepare', 'cancel'] as const)(
    'rechecks proof after the final awaited bearer fence before %s',
    async (action) => {
      const f = fixture();
      vi.mocked(revalidateAuthInfo)
        .mockImplementationOnce(async () => true)
        .mockImplementationOnce(async () => {
          vi.mocked(authorizeRequestTemplateContext).mockReturnValue({
            status: 'disabled',
            reason: 'trust_disabled',
          } as never);
          return true;
        });
      expect(
        (
          await f.invoke({
            action,
            backend: 'codegraph',
            ...(action === 'cancel' ? { id: 'ab71b56a-739b-4423-935d-158819dca276' } : {}),
            _meta: { context },
          })
        ).status,
      ).toBe(401);
      expect(f.resolveGrant).toHaveBeenCalledOnce();
      expect(f.control).not.toHaveBeenCalled();
    },
  );

  it('passes current proof and bearer revalidation into post-inspection scheduling admission', async () => {
    const f = fixture();
    f.control.mockImplementationOnce(async (_grant?: unknown, request?: unknown) => {
      vi.mocked(authorizeRequestTemplateContext).mockReturnValue({
        status: 'disabled',
        reason: 'trust_disabled',
      } as never);
      expect(await (request as { validateAdmission(): Promise<boolean> }).validateAdmission()).toBe(false);
      return { state: 'forbidden' } as never;
    });
    expect(await f.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).toMatchObject({
      status: 200,
      output: { state: 'forbidden' },
    });
  });
  it.each(['untrusted', 'disabled', 'legacy'])('rejects %s before coordinator filesystem resolution', async (mode) => {
    vi.mocked(authorizeRequestTemplateContext).mockReturnValue(
      mode === 'legacy'
        ? ({ status: 'trusted', provenance: 'legacy', context } as never)
        : ({ status: mode, reason: 'proof_missing' } as never),
    );
    const { resolveGrant, control, invoke } = fixture();
    expect((await invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(403);
    expect(resolveGrant).not.toHaveBeenCalled();
    expect(control).not.toHaveBeenCalled();
  });

  it('requires a verified context even when no tools exist', async () => {
    const { resolveGrant, invoke } = fixture();
    expect((await invoke({ action: 'status', backend: 'codegraph' })).status).toBe(403);
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it('performs status independent of binding and tool discovery with exact selected checkout', async () => {
    const { resolveGrant, control, invoke } = fixture();
    expect(await invoke({ action: 'status', backend: 'codegraph', _meta: { context } })).toMatchObject({
      status: 200,
      output: { state: 'required' },
    });
    expect(resolveGrant).toHaveBeenCalledWith(
      expect.objectContaining({ backendName: 'codegraph', checkoutPath: '/selected/checkout' }),
    );
    expect(control).toHaveBeenCalledTimes(1);
    expect(revalidateAuthInfo).toHaveBeenCalledTimes(2);
  });

  it('rejects a revoked grant before target resolution and again before process control', async () => {
    const first = fixture();
    vi.mocked(revalidateAuthInfo).mockResolvedValueOnce(false);
    expect((await first.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(401);
    expect(first.resolveGrant).not.toHaveBeenCalled();
    const second = fixture();
    vi.mocked(revalidateAuthInfo).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect((await second.invoke({ action: 'prepare', backend: 'codegraph', _meta: { context } })).status).toBe(401);
    expect(second.resolveGrant).toHaveBeenCalledTimes(1);
    expect(second.control).not.toHaveBeenCalled();
  });

  it('validates requests before reading context and rejects runtime authority assertions', async () => {
    const { resolveGrant, invoke } = fixture();
    expect(
      (
        await invoke({
          action: 'prepare',
          backend: 'codegraph',
          executable: '/caller/binary',
          allowedActions: ['install'],
          _meta: { context },
        })
      ).status,
    ).toBe(400);
    expect((await invoke({ action: 'cancel', backend: 'codegraph', _meta: { context } })).status).toBe(400);
    expect(resolveGrant).not.toHaveBeenCalled();
  });

  it('releases only the disconnected request waiter through its abort signal', async () => {
    const { control, invoke, disconnect } = fixture();
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    control.mockImplementation(async (_grant?: unknown, request?: unknown) => {
      const signal = (request as { signal: AbortSignal }).signal;
      reached();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return { state: 'unknown', reason: 'caller_disconnected' } as never;
    });
    const pending = invoke({
      action: 'wait',
      backend: 'codegraph',
      id: 'ab71b56a-739b-4423-935d-158819dca276',
      _meta: { context },
    });
    await started;
    disconnect();
    expect(await pending).toMatchObject({ status: 200, output: { state: 'unknown', reason: 'caller_disconnected' } });
    expect(control).toHaveBeenCalledTimes(1);
  });

  it('does not expose storage or native error text', async () => {
    const { resolveGrant, invoke } = fixture();
    resolveGrant.mockRejectedValue(new Error('private credential path /secret'));
    expect(await invoke({ action: 'status', backend: 'codegraph', _meta: { context } })).toEqual({
      status: 503,
      output: {
        error: 'Preparation controls are unavailable; inspect runtime configuration and backend prerequisites',
      },
    });
  });
});
