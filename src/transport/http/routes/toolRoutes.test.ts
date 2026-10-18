import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { SchemaCache } from '@src/core/capabilities/schemaCache.js';
import { ToolRegistry } from '@src/core/capabilities/toolRegistry.js';

import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createToolInvocationsHandler } from './toolRoutes.js';

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
