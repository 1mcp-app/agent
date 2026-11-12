import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { EventEmitter } from 'node:events';

import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';
import { BackendSleep } from '@src/core/server/backendSleep.js';
import { BackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { LegacyConnectionId } from '@src/sdk/contracts/index.js';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler, createToolsHandler } from './toolRoutes.js';

const { admission } = vi.hoisted(() => ({ admission: vi.fn() }));
vi.mock('@src/application/backendPreparationAdmission.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/application/backendPreparationAdmission.js')>()),
  admitBackendPreparationTool: admission,
}));
vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ codegraph: { type: 'stdio', command: 'configured-native-observer' } }),
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
        () => undefined,
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
    [false, true].flatMap((lazy) => ['same', 'changed', 'removed', 'cancelled'].map((outcome) => ({ lazy, outcome }))),
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
      capabilities: { tools: {} },
      adapter: {
        request: vi.fn(async () => ({ tools: [definition] })),
      },
    });
    const replacement = createMockOutboundConnection({
      name: 'codegraph',
      capabilities: { tools: {} },
      adapter: {
        connectionId: 'replacement' as LegacyConnectionId,
        request: vi.fn(async ({ method }) => (method === 'tools/list' ? { tools: replacementTools } : result)),
      },
    });
    vi.useFakeTimers();
    const wake = vi.fn(async () => {
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
        () => {},
      );
      expect(listResponse.json.mock.calls[0][0].tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'echo' })]),
      );
      expect(wake).not.toHaveBeenCalled();
      expect(released).not.toHaveBeenCalled();
      const invokeResponse = response();
      await createToolInvocationsHandler(manager as never)(
        Object.assign(requestEvents, { headers: {}, body: { tool: 'codegraph/echo', args: {} } }) as unknown as Request,
        invokeResponse as unknown as Response,
        () => {},
      );
      if (outcome === 'same') {
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
      vi.useRealTimers();
    }
  });
});
