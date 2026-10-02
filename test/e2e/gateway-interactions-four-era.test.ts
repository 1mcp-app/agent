import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import type { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import { Client as LegacyClient } from '@src/sdk/legacy/client/index.js';
import {
  createLegacyOutboundConnection,
  getLegacyTransport,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import {
  CallToolRequestSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListRootsRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ResultSchema,
} from '@src/sdk/legacy/types.js';
import { createScopeAuthMiddleware } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import rateLimit from 'express-rate-limit';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const serverCapabilities = { tools: {}, prompts: {}, resources: {}, completions: {} };
const clientCapabilities = { roots: {}, sampling: {}, elicitation: { form: {} } };
function selectedCapabilities(method: string) {
  if (method === 'roots/list') return { roots: {} };
  if (method === 'sampling/createMessage') return { sampling: {} };
  return { elicitation: { form: {} } };
}
const interactions = [
  {
    method: 'roots/list',
    schema: ListRootsRequestSchema,
    params: {},
    response: { roots: [{ uri: 'file:///allowed', name: 'Allowed' }] },
  },
  {
    method: 'sampling/createMessage',
    schema: CreateMessageRequestSchema,
    params: { messages: [{ role: 'user', content: { type: 'text', text: 'Summarize' } }], maxTokens: 10 },
    response: {
      role: 'assistant',
      content: { type: 'text', text: 'Summary' },
      model: 'fixture-model',
      stopReason: 'endTurn',
    },
  },
  {
    method: 'elicitation/create',
    schema: ElicitRequestSchema,
    params: {
      mode: 'form',
      message: 'Confirm',
      requestedSchema: { type: 'object', properties: { confirmed: { type: 'boolean' } }, required: ['confirmed'] },
    },
    response: { action: 'accept', content: { confirmed: true } },
  },
] as const;
const operations = [
  {
    method: 'tools/call',
    schema: CallToolRequestSchema,
    params: { name: 'fixture_1mcp_act', arguments: {} },
    result: { content: [{ type: 'text', text: 'done' }] },
  },
  {
    method: 'prompts/get',
    schema: GetPromptRequestSchema,
    params: { name: 'fixture_1mcp_prompt' },
    result: { messages: [{ role: 'assistant', content: { type: 'text', text: 'done' } }] },
  },
  {
    method: 'resources/read',
    schema: ReadResourceRequestSchema,
    params: { uri: 'fixture_1mcp_file:///value' },
    result: { contents: [{ uri: 'file:///value', text: 'done' }] },
  },
] as const;
const lists = [
  [ListToolsRequestSchema, { tools: [{ name: 'act', inputSchema: { type: 'object', properties: {} } }] }],
  [ListPromptsRequestSchema, { prompts: [{ name: 'prompt' }] }],
  [ListResourcesRequestSchema, { resources: [{ name: 'Value', uri: 'file:///value' }] }],
  [ListResourceTemplatesRequestSchema, { resourceTemplates: [] }],
] as const;
async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}
async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('real gateway interaction peers across protocol eras', () => {
  it.each([
    ['legacy', 'legacy', 1],
    ['legacy', 'modern', 1],
    ['modern', 'legacy', 1],
    ['modern', 'modern', 1],
    ['modern', 'modern', 32],
    ['legacy', 'modern', 32],
  ] as const)(
    'routes Roots, Sampling and Elicitation for all eligible methods: %s inbound / %s upstream / %i inputs',
    async (inboundEra, upstreamEra, inputCount) => {
      const cleanup: Array<() => Promise<unknown>> = [];
      let selected: (typeof interactions)[number] = interactions[0];
      let upstreamExecutions = 0;
      let sideEffects = 0;
      let answers = 0;
      const downstreamBatchSizes: number[] = [];
      let legacyConnections = 0;
      let privateSchemaChanged = false;
      let privateRevisionChanged = false;
      try {
        let connection;
        if (upstreamEra === 'legacy') {
          const recreate = (): AuthProviderTransport => {
            legacyConnections++;
            const privatePeer = legacyConnections > 1;
            const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities: serverCapabilities });
            if (privatePeer && privateRevisionChanged)
              backend.setRequestHandler(InitializeRequestSchema, async () => ({
                protocolVersion: '2024-11-05',
                serverInfo: { name: 'fixture', version: '1' },
                capabilities: serverCapabilities,
              }));
            for (const [schema, result] of lists)
              backend.setRequestHandler(schema, async () =>
                privatePeer && privateSchemaChanged && schema === ListToolsRequestSchema
                  ? {
                      tools: [
                        { name: 'act', inputSchema: { type: 'object', properties: { changed: { type: 'string' } } } },
                      ],
                    }
                  : result,
              );
            for (const operation of operations)
              backend.setRequestHandler(operation.schema, async () => {
                if (privatePeer) expect(backend.getClientCapabilities()).toEqual(selectedCapabilities(selected.method));
                upstreamExecutions++;
                // A side effect before parking must never be repeated by a continuation.
                sideEffects++;
                const response = await backend.request(
                  { method: selected.method, params: selected.params },
                  ResultSchema,
                );
                expect(response).toMatchObject(selected.response);
                return operation.result;
              });
            const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
            cleanup.push(() => backend.close());
            void backend.connect(serverTransport);
            return Object.assign(clientTransport, { recreate });
          };
          const client = new LegacyClient(
            { name: 'gateway-upstream', version: '1' },
            { capabilities: clientCapabilities },
          );
          const clientTransport = recreate();
          await client.connect(clientTransport);
          connection = createLegacyOutboundConnection({
            name: 'fixture',
            client,
            transport: clientTransport,
            status: ClientStatus.Connected,
            capabilities: serverCapabilities,
          });
        } else {
          const handler = createMcpHandler(
            () => {
              const backend = new ModernServer({ name: 'fixture', version: '2' }, { capabilities: serverCapabilities });
              for (const [schema, result] of lists)
                backend.setRequestHandler(schema.shape.method.value, async () => result as never);
              for (const operation of operations)
                backend.setRequestHandler(operation.method, async (_request, context) => {
                  upstreamExecutions++;
                  if (context.mcpReq.requestState() === undefined)
                    return {
                      resultType: 'input_required',
                      requestState: 'private-upstream-state',
                      inputRequests: Object.fromEntries(
                        Array.from({ length: inputCount }, (_, index) => [
                          String(index),
                          { method: selected.method, params: selected.params },
                        ]),
                      ),
                    } as never;
                  expect(context.mcpReq.requestState()).toBe('private-upstream-state');
                  expect(context.mcpReq.inputResponses).toEqual(
                    Object.fromEntries(
                      Array.from({ length: inputCount }, (_, index) => [String(index), selected.response]),
                    ),
                  );
                  sideEffects++;
                  return operation.result as never;
                });
              return backend;
            },
            { legacy: 'reject' },
          );
          const http = createServer(toNodeHandler(handler));
          cleanup.push(
            () => handler.close(),
            () => closeHttp(http),
          );
          const client = new ModernClient(
            { name: 'gateway-upstream', version: '2' },
            { capabilities: clientCapabilities, versionNegotiation: { mode: { pin: '2026-07-28' } } },
          );
          const transport = new StreamableHTTPClientTransport(await listen(http));
          await client.connect(transport);
          connection = createLegacyOutboundConnection({
            name: 'fixture',
            client,
            transport,
            status: ClientStatus.Connected,
            capabilities: serverCapabilities,
          });
        }
        cleanup.push(() => connection.adapter.close());
        const manager = ServerManager.getOrCreateInstance(
          { name: 'aggregate', version: '1' },
          { capabilities: { ...serverCapabilities, logging: {} } },
          new Map([['fixture', connection]]),
          {},
        );
        cleanup.push(() => ServerManager.resetInstance());
        let request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        if (inboundEra === 'legacy') {
          const client = new LegacyClient({ name: 'inbound', version: '1' }, { capabilities: clientCapabilities });
          for (const interaction of interactions)
            client.setRequestHandler(interaction.schema, async (request) => {
              expect(request.method).toBe(selected.method);
              expect(request.params ?? {}).toMatchObject(selected.params);
              answers++;
              return selected.response;
            });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          await manager.connectTransport(serverTransport, 'interaction-inbound', {});
          await client.connect(clientTransport);
          cleanup.push(() => client.close());
          request = (method, params) => client.request({ method, params }, ResultSchema, { timeout: 10000 });
        } else {
          const app = express();
          app.use(express.json());
          app.use(rateLimit({ windowMs: 60_000, limit: 1000 }));
          // Exercise native admission and its provider-bound continuation revalidation.
          const expiresAt = Date.now() + 120_000;
          const authProvider = {
            verifyAccessToken: async (token: string) => {
              if (token !== 'interaction-fixture') throw new Error('Invalid fixture credential');
              return { token, clientId: 'fixture', scopes: [], expiresAt };
            },
          } as unknown as SDKOAuthServerProvider;
          const config = AgentConfigManager.getInstance();
          const features = config.get('features');
          try {
            config.updateConfig({ features: { ...features, auth: true, scopeValidation: true } });
            app.use(createScopeAuthMiddleware(authProvider));
          } finally {
            config.updateConfig({ features });
          }
          setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
            allowsHost: () => true,
            allowsOrigin: () => true,
          });
          const http = createServer(app);
          cleanup.push(() => closeHttp(http));
          const client = new ModernClient(
            { name: 'inbound', version: '2' },
            {
              capabilities: clientCapabilities,
              inputRequired: { autoFulfill: true },
              versionNegotiation: { mode: { pin: '2026-07-28' } },
            },
          );
          for (const interaction of interactions)
            client.setRequestHandler(interaction.method, async (request) => {
              expect(request.method).toBe(selected.method);
              expect(request.params ?? {}).toMatchObject(selected.params);
              answers++;
              return selected.response as never;
            });
          await client.connect(
            new StreamableHTTPClientTransport(await listen(http), {
              requestInit: { headers: { Authorization: 'Bearer interaction-fixture' } },
              fetch: async (input, init) => {
                const response = await fetch(input, init);
                const frame = await response
                  .clone()
                  .json()
                  .catch(() => undefined);
                if (frame?.result?.resultType === 'input_required')
                  downstreamBatchSizes.push(Object.keys(frame.result.inputRequests).length);
                return response;
              },
            }),
          );
          cleanup.push(() => client.close());
          request = (method, params) =>
            client.request(
              {
                method,
                params: {
                  ...params,
                  _meta: { 'io.modelcontextprotocol/clientCapabilities': selectedCapabilities(selected.method) },
                },
              } as never,
              z.looseObject({}),
              { timeout: 10000 },
            );
        }
        for (const operation of operations) {
          for (const interaction of interactions) {
            selected = interaction;
            const before = { upstreamExecutions, sideEffects, answers, batches: downstreamBatchSizes.length };
            const result = await request(operation.method, operation.params);
            expect(result, `${operation.method} / ${interaction.method}`).toMatchObject(
              operation.method === 'resources/read' ? { contents: [{ text: 'done' }] } : operation.result,
            );
            expect(answers - before.answers).toBe(inputCount);
            if (inboundEra === 'modern') expect(downstreamBatchSizes.slice(before.batches)).toEqual([inputCount]);
            expect(sideEffects - before.sideEffects).toBe(1);
            expect(upstreamExecutions - before.upstreamExecutions).toBe(upstreamEra === 'legacy' ? 1 : 2);
          }
        }
        if (upstreamEra === 'legacy') expect(legacyConnections).toBe(inboundEra === 'modern' ? 10 : 1);
        if (upstreamEra === 'legacy' && inboundEra === 'modern') {
          const before = sideEffects;
          const transport = getLegacyTransport(connection);
          const recreate = transport.recreate;
          delete transport.recreate;
          await expect(request('tools/call', operations[0].params)).rejects.toBeDefined();
          expect(sideEffects).toBe(before);
          transport.recreate = recreate;
          privateSchemaChanged = true;
          await expect(request('tools/call', operations[0].params)).rejects.toBeDefined();
          expect(sideEffects).toBe(before);
          privateSchemaChanged = false;
          privateRevisionChanged = true;
          await expect(request('tools/call', operations[0].params)).rejects.toBeDefined();
          expect(sideEffects).toBe(before);
        }
      } finally {
        for (const close of cleanup.reverse()) await close();
      }
    },
  );
});
