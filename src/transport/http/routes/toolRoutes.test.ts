import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { BackendSleep } from '@src/core/server/backendSleep.js';
import { BackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/index.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler, createToolsHandler } from './toolRoutes.js';

const { admission } = vi.hoisted(() => ({ admission: vi.fn() }));
vi.mock('@src/application/backendPreparationAdmission.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/application/backendPreparationAdmission.js')>()),
  admitBackendPreparationTool: admission,
}));
vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({
    codegraph: { type: 'stdio', command: 'configured-native-observer', tags: ['a', 'b'] },
  }),
}));
vi.mock('./inspectRoutes.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./inspectRoutes.js')>()),
  ensureRequestContextInitialized: vi.fn(async () => undefined),
}));

describe('REST tool invocation preparation payload', () => {
  beforeEach(() => admission.mockReset());

  it.each(['admission', 'direct-final-check', 'catalog-final-check'] as const)(
    'returns the existing bare pending payload at %s without dispatching the source tool',
    async (stage) => {
      const pending = {
        preparation: { state: 'required', action: 'sync', instructions: 'Synchronize this checkout.' },
        operationExecuted: false,
        operationQueued: false,
      };
      const beforeDispatch = vi.fn(async () => ({ result: pending }));
      const revalidate = vi.fn(async () => true);
      const setupDeadline = vi.fn(() => ({ signal: new AbortController().signal, stop: vi.fn() }));
      admission.mockResolvedValue(
        stage === 'admission'
          ? {
              kind: 'blocked',
              result: { content: [{ type: 'text', text: JSON.stringify(pending) }], structuredContent: pending },
            }
          : { kind: 'ready', revalidate, beforeDispatch, setupDeadline },
      );
      const definition = {
        name: 'codegraph_explore',
        inputSchema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] },
      };
      const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'source result' }] }));
      const connection = createMockOutboundConnection({
        name: 'codegraph',
        capabilities: { tools: {} },
        adapter: {
          request: vi.fn(async ({ method }) => (method === 'tools/list' ? { tools: [definition] } : callTool())),
        },
      });
      const connections = new Map([['codegraph', connection]]);
      const registry = ToolRegistry.fromToolsWithServer([
        { server: 'codegraph', connectionKey: 'codegraph', tool: definition },
      ]).withConnections(connections);
      const fallback = vi.fn();
      const orchestrator = {
        getToolRegistry: () => registry,
        getSchemaCache: () => new SchemaCache({ maxEntries: 10 }),
        callMetaTool: fallback,
      };
      const manager = {
        getLazyLoadingOrchestrator: () => (stage === 'catalog-final-check' ? orchestrator : undefined),
        getClients: () => connections,
        getClient: () => connection,
      };
      const body = vi.fn();
      const response = {
        locals: { validatedTags: [], tagFilterMode: 'none' },
        json: body,
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
      };
      await createToolInvocationsHandler(manager as never)(
        { headers: {}, body: { tool: 'codegraph/codegraph_explore', args: { query: 'UniqueSymbol' } } } as Request,
        response as unknown as Response,
      );
      expect(body).toHaveBeenCalledExactlyOnceWith({ result: pending, server: 'codegraph', tool: 'codegraph_explore' });
      expect(callTool).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
      if (stage === 'admission') {
        expect(beforeDispatch).not.toHaveBeenCalled();
        expect(revalidate).not.toHaveBeenCalled();
      } else {
        expect(beforeDispatch).toHaveBeenCalledOnce();
        expect(revalidate).toHaveBeenCalledOnce();
      }
    },
  );
});

describe('REST tools with Backend Sleep', () => {
  it.each(
    [false, true].flatMap((lazy) =>
      [
        'same',
        'changed',
        'removed',
        'cancelled',
        'revoked',
        'tag-removed',
        'final-revoked',
        'final-tag-removed',
        'final-backend-tags',
        'preparation-revoked',
        'authenticated',
        'auth-enabled',
      ].map((outcome) => ({ lazy, outcome })),
    ),
  )('retains discovery and revalidates $outcome on wake with lazy=$lazy', async ({ lazy, outcome }) => {
    admission.mockResolvedValue({ kind: 'not-applicable' });
    const definition = { name: 'echo', inputSchema: { type: 'object' as const } };
    const requestEvents = new EventEmitter();
    const replacementTools =
      outcome === 'removed'
        ? []
        : [
            {
              ...definition,
              inputSchema: outcome === 'changed' ? { type: 'object', required: ['newField'] } : definition.inputSchema,
            },
          ];
    const result = { content: [{ type: 'text', text: 'replacement result' }] };
    const original = createMockOutboundConnection({
      name: 'codegraph',
      tags: ['a', 'b'],
      capabilities: { tools: {} },
      adapter: {
        request: vi.fn(async () => ({ tools: [definition] })),
      },
    });
    let replacementLists = 0;
    const replacement = createMockOutboundConnection({
      name: 'codegraph',
      tags: ['a', 'b'],
      capabilities: { tools: {} },
      adapter: {
        connectionId: 'replacement' as LegacyConnectionId,
        request: vi.fn(async ({ method }) => {
          if (method !== 'tools/list') return result;
          replacementLists += 1;
          if (outcome.startsWith('final-') && replacementLists === 2) {
            dispatchStarted();
            await dispatchGate;
          }
          return { tools: replacementTools };
        }),
      },
    });
    const config = AgentConfigManager.getInstance();
    const features = config.get('features');
    const directory = mkdtempSync(join(tmpdir(), '1mcp-rest-sleep-auth-'));
    const provider = new SDKOAuthServerProvider(directory, 'rest-sleep-runtime');
    const tokenId = randomUUID();
    const token = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
    const clientId = 'sleep-caller';
    const finalCheck = outcome.startsWith('final-') || outcome === 'preparation-revoked';
    const authenticated = [
      'revoked',
      'tag-removed',
      'final-revoked',
      'final-tag-removed',
      'final-backend-tags',
      'preparation-revoked',
      'authenticated',
    ].includes(outcome);
    config.updateConfig({ features: { ...features, auth: false } });
    if (authenticated) {
      config.updateConfig({ features: { ...features, auth: true, scopeValidation: true } });
      provider.oauthStorage.sessionRepository.createWithId(
        tokenId,
        clientId,
        new URL(config.getUrl()).href,
        ['tag:a', 'tag:b'],
        60_000,
      );
    }
    let finishWake!: () => void;
    const wakeGate = new Promise<void>((resolve) => {
      finishWake = resolve;
    });
    let wakeStarted!: () => void;
    const waking = new Promise<void>((resolve) => {
      wakeStarted = resolve;
    });
    let finishDispatch!: () => void;
    const dispatchGate = new Promise<void>((resolve) => {
      finishDispatch = resolve;
    });
    let dispatchStarted!: () => void;
    const dispatching = new Promise<void>((resolve) => {
      dispatchStarted = resolve;
    });
    if (outcome === 'preparation-revoked') {
      admission.mockResolvedValue({
        kind: 'ready',
        revalidate: async () => true,
        beforeDispatch: async () => {
          dispatchStarted();
          await dispatchGate;
          return { assertCurrent: () => true };
        },
      });
    }
    vi.useFakeTimers();
    const wake = vi.fn(async () => {
      wakeStarted();
      if (authenticated || outcome === 'auth-enabled') await wakeGate;
      adapter.current = replacement.adapter;
      await adapter.refresh({ tools: {} });
      if (outcome === 'cancelled') requestEvents.emit('aborted');
    });
    const lifecycle = new BackendSleep({
      idleTimeoutMs: 1,
      release: async () => {},
      wake,
      isCurrent: () => true,
      onChange: (state) => {
        original.status = state.state === 'awake' ? ClientStatus.Connected : ClientStatus.Sleeping;
        original.sleep = state;
      },
    });
    const adapter = new BackendSleepAdapter(original.adapter, lifecycle);
    const released = original.adapter.request;
    Object.assign(original, { adapter });
    await adapter.refresh({ tools: {} });
    lifecycle.ready();
    const connections = new Map([['codegraph', original]]);
    const registry = ToolRegistry.fromToolsWithServer([
      { server: 'codegraph', connectionKey: 'codegraph', tool: definition },
    ]).withConnections(connections);
    const manager = {
      getClients: () => connections,
      getClient: () => original,
      getLazyLoadingOrchestrator: () =>
        lazy
          ? {
              getToolRegistry: () => registry,
              getSchemaCache: () => new SchemaCache({ maxEntries: 10 }),
              callMetaTool: vi.fn(),
            }
          : undefined,
    };
    const response = () => ({
      locals: { validatedTags: [], tagFilterMode: 'none' },
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
    });
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      vi.useRealTimers();
      expect(original.status).toBe(ClientStatus.Sleeping);
      vi.mocked(released).mockClear();
      const listResponse = response();
      await createToolsHandler(manager as never)(
        { headers: {}, query: {} } as Request,
        listResponse as unknown as Response,
      );
      expect(listResponse.json.mock.calls[0][0].tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'echo' })]),
      );
      expect(wake).not.toHaveBeenCalled();
      expect(released).not.toHaveBeenCalled();
      const invokeResponse = response();
      if (authenticated) {
        const next = vi.fn();
        await createScopeAuthMiddleware(provider)(
          { headers: { authorization: `Bearer ${token}` } } as Request,
          invokeResponse as unknown as Response,
          next,
        );
        expect(next).toHaveBeenCalledOnce();
      }
      const invocation = createToolInvocationsHandler(manager as never)(
        Object.assign(requestEvents, { headers: {}, body: { tool: 'codegraph/echo', args: {} } }) as unknown as Request,
        invokeResponse as unknown as Response,
      );
      if (authenticated || outcome === 'auth-enabled') {
        await Promise.race([waking, invocation]);
        expect(wake).toHaveBeenCalledOnce();
        if (finalCheck) {
          finishWake();
          await Promise.race([dispatching, invocation]);
        }
        if (outcome === 'revoked' || outcome === 'final-revoked' || outcome === 'preparation-revoked') {
          await provider.revokeToken({ client_id: clientId, redirect_uris: [] }, { token });
        } else if (outcome === 'tag-removed' || outcome === 'final-tag-removed') {
          const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;
          const session = provider.oauthStorage.sessionRepository.get(sessionId)!;
          provider.oauthStorage.fileStorage.writeData(AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX, sessionId, {
            ...session,
            scopes: ['tag:a'],
          });
        }
        if (outcome === 'final-backend-tags') original.tags = ['outside-grant'];
        if (outcome === 'auth-enabled') config.updateConfig({ features: { ...features, auth: true } });
        finishWake();
        finishDispatch();
      }
      await invocation;
      if (['revoked', 'tag-removed', 'auth-enabled'].includes(outcome)) {
        expect(invokeResponse.status).toHaveBeenCalledWith(401);
      }
      if (finalCheck) expect(invokeResponse.status).toHaveBeenCalledWith(503);
      if (outcome === 'same' || outcome === 'authenticated') {
        expect(invokeResponse.json).toHaveBeenCalledWith({ result, server: 'codegraph', tool: 'echo' });
        expect(
          vi.mocked(replacement.adapter.request).mock.calls.filter(([request]) => request.method === 'tools/call'),
        ).toHaveLength(1);
      } else {
        expect(invokeResponse.json).not.toHaveBeenCalledWith({ result, server: 'codegraph', tool: 'echo' });
        expect(
          vi.mocked(replacement.adapter.request).mock.calls.filter(([request]) => request.method === 'tools/call'),
        ).toHaveLength(0);
      }
      expect(wake).toHaveBeenCalledTimes(1);
      expect(released).not.toHaveBeenCalled();
      expect(lifecycle.snapshot().blockers).toEqual([]);
    } finally {
      lifecycle.stop();
      provider.shutdown();
      config.updateConfig({ features });
      rmSync(directory, { recursive: true, force: true });
      vi.useRealTimers();
    }
  });
});
