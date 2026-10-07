import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { MCP_URI_SEPARATOR } from '@src/constants.js';
import { ClientStatus } from '@src/core/types/index.js';
import { Client as LegacyClient } from '@src/sdk/legacy/client/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server as LegacyServer } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ResultSchema,
} from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';
import { buildUri } from '@src/utils/core/parsing.js';
import {
  buildPublicResourceTemplate,
  buildPublicResourceUri,
  isValidResourceUri,
} from '@src/utils/core/resourceUris.js';

import express from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capabilities, prompt, resource, results, template, tool } from './fixtures/capabilityCatalog.js';

const schemas = [
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
];

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}

async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

describe('capability catalog with real SDK peers', () => {
  it.each([
    ['legacy', 'legacy', false],
    ['legacy', 'modern', false],
    ['modern', 'legacy', false],
    ['modern', 'modern', false],
    ['modern', 'legacy', true],
    ['modern', 'modern', true],
  ] as const)('round-trips %s-%s capabilities (grant: %s)', async (inboundEra, outboundEra, authenticated) => {
    const cleanup: Array<() => Promise<unknown>> = [];
    const observed: Array<{ method: string; params?: unknown }> = [];
    let verifiedAuth = {
      token: 'fixture-verified-token',
      clientId: 'fixture-client',
      grantedScopes: ['tag:fixture'],
      grantedTags: ['fixture'],
    };
    const schemaTool = {
      name: 'schema-probe',
      inputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } } },
      outputSchema:
        outboundEra === 'modern'
          ? { type: 'array', items: { $ref: '#/$defs/n' }, $defs: { n: { type: 'integer' } } }
          : {
              type: 'object',
              properties: { result: { type: 'array', items: { type: 'integer' } } },
              required: ['result'],
            },
    };
    const fixtureResult = (request: { method: string; params?: unknown }) => {
      if (request.method === 'tools/list')
        return {
          tools: [tool, schemaTool, { name: 'invalid-schema', inputSchema: { type: 'object', $ref: '#/missing' } }],
        };
      const params = request.params as { name?: string; arguments?: { value?: number } } | undefined;
      if (request.method === 'tools/call' && params?.name === schemaTool.name) {
        let structuredContent: unknown = outboundEra === 'modern' ? [2] : { result: [2] };
        if (params.arguments?.value === 13) structuredContent = 'invalid-output';
        return {
          content: [],
          structuredContent,
        };
      }
      if (request.method === 'tools/call') return { ...results[request.method], structuredContent: {} };
      if (request.method === 'resources/read' && (request.params as { uri?: string })?.uri === 'file:///dynamic')
        return {
          contents: [
            { uri: resource.uri, text: 'Guide' },
            { uri: 'file:///second%2f', text: 'Template content' },
            { uri: 'custom:///unlisted%2f?q=one#part', text: 'Unlisted content' },
          ],
        };
      return results[request.method];
    };
    try {
      let connection;
      if (outboundEra === 'legacy') {
        const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities });
        for (const schema of schemas) {
          backend.setRequestHandler(schema, async (request) => {
            observed.push(request);
            return fixtureResult(request);
          });
        }
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const client = new ClientFactory().createClient(clientTransport, {});
        cleanup.push(() => backend.close());
        await backend.connect(serverTransport);
        await client.connect(clientTransport);
        connection = createLegacyOutboundConnection({
          name: 'fixture',
          client,
          transport: clientTransport,
          status: ClientStatus.Connected,
          capabilities,
        });
      } else {
        const handler = createMcpHandler(
          () => {
            const backend = new ModernServer({ name: 'fixture', version: '2' }, { capabilities });
            for (const schema of schemas) {
              backend.setRequestHandler(schema.shape.method.value, async (request) => {
                observed.push(request);
                return fixtureResult(request) as never;
              });
            }
            return backend;
          },
          { legacy: 'reject' },
        );
        const server = createServer(toNodeHandler(handler));
        cleanup.push(
          () => closeHttp(server),
          () => handler.close(),
        );
        const url = await listen(server);
        const client = new ModernClient(
          { name: 'gateway-backend', version: '2' },
          {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
          },
        );
        const transport = new StreamableHTTPClientTransport(url);
        await client.connect(transport);
        connection = createLegacyOutboundConnection({
          name: 'fixture',
          client,
          transport,
          status: ClientStatus.Connected,
          capabilities,
        });
      }
      cleanup.push(() => connection.adapter.close());
      const manager = ServerManager.getOrCreateInstance(
        { name: 'aggregate', version: '1' },
        { capabilities: { ...capabilities, logging: {} } },
        new Map([['fixture', connection]]),
        {},
      );
      cleanup.push(() => ServerManager.resetInstance());
      let request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
      if (inboundEra === 'legacy') {
        const client = new LegacyClient({ name: 'inbound', version: '1' });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await manager.connectTransport(serverTransport, 'fixture-inbound', {});
        await client.connect(clientTransport);
        cleanup.push(() => client.close());
        request = (method, params) => client.request({ method, ...(params ? { params } : {}) }, ResultSchema);
      } else {
        const app = express();
        app.use(express.json());
        setupModernHttpRoutes(
          app as never,
          manager as never,
          authenticated
            ? [
                (_req, res, next) => {
                  // This fixture supplies admitted grant facts; production middleware verifies the token.
                  res.locals.auth = verifiedAuth;
                  next();
                },
              ]
            : [],
          createModernInboundLegacyBridge,
          {
            allowsHost: () => true,
            allowsOrigin: () => true,
          },
        );
        const server = createServer(app);
        cleanup.push(() => closeHttp(server));
        const client = new ModernClient(
          { name: 'inbound', version: '2' },
          {
            versionNegotiation: { mode: { pin: '2026-07-28' } },
          },
        );
        await client.connect(new StreamableHTTPClientTransport(await listen(server)));
        cleanup.push(() => client.close());
        expect(client.getServerCapabilities()).toEqual(capabilities);
        request = (method, params) => client.request({ method, ...(params ? { params } : {}) }, z.looseObject({}));
      }
      const publicIdentity = (value: string) => buildUri('fixture', value, MCP_URI_SEPARATOR);
      expect(
        ((await request('tools/list')).tools as Array<{ name: string }>).find(
          (item) => item.name === publicIdentity(tool.name),
        ),
      ).toMatchObject({ ...tool, name: publicIdentity(tool.name) });
      expect(await request('prompts/list')).toMatchObject({
        prompts: [{ ...prompt, name: publicIdentity(prompt.name) }],
      });
      expect(await request('resources/list')).toMatchObject({
        resources: [{ ...resource, uri: buildPublicResourceUri('fixture', resource.uri) }],
      });
      expect(await request('resources/templates/list')).toMatchObject({
        resourceTemplates: [{ ...template, uriTemplate: buildPublicResourceTemplate('fixture', template.uriTemplate) }],
      });
      expect(await request('tools/call', { name: publicIdentity(tool.name), arguments: {} })).toMatchObject(
        results['tools/call'],
      );
      const schemaList = await request('tools/list');
      const advertised = (schemaList.tools as Array<{ name: string; outputSchema: Record<string, unknown> }>).find(
        (item) => item.name === publicIdentity(schemaTool.name),
      );
      expect(advertised).toBeDefined();
      expect((schemaList.tools as Array<{ name: string }>).some((item) => item.name.endsWith('invalid-schema'))).toBe(
        false,
      );
      const beforeInvalid = observed.filter((item) => item.method === 'tools/call').length;
      expect(
        await request('tools/call', { name: publicIdentity(schemaTool.name), arguments: { value: 'wrong' } }),
      ).toMatchObject({ isError: true });
      expect(observed.filter((item) => item.method === 'tools/call')).toHaveLength(beforeInvalid);
      const validSchemaResult = await request('tools/call', {
        name: publicIdentity(schemaTool.name),
        arguments: { value: 2 },
      });
      expect(validSchemaResult.structuredContent).toEqual(
        inboundEra === 'modern' && outboundEra === 'modern' ? [2] : { result: [2] },
      );
      expect(advertised!.outputSchema.type).toBe(
        inboundEra === 'modern' && outboundEra === 'modern' ? 'array' : 'object',
      );
      await expect(
        request('tools/call', { name: publicIdentity(schemaTool.name), arguments: { value: 13 } }),
      ).rejects.toThrow();
      expect(
        await request('prompts/get', { name: publicIdentity(prompt.name), arguments: { topic: 'test' } }),
      ).toMatchObject(results['prompts/get']);
      expect(await request('resources/read', { uri: buildPublicResourceUri('fixture', resource.uri) })).toMatchObject({
        contents: [{ uri: buildPublicResourceUri('fixture', resource.uri), text: 'Guide' }],
      });
      const dynamicRead = await request('resources/read', {
        uri: buildPublicResourceUri('fixture', 'file:///dynamic'),
      });
      expect(dynamicRead).toMatchObject({
        contents: [
          { uri: buildPublicResourceUri('fixture', resource.uri), text: 'Guide' },
          { uri: buildPublicResourceUri('fixture', 'file:///second%2f'), text: 'Template content' },
          { uri: expect.stringMatching(/^urn:1mcp:resource:/), text: 'Unlisted content' },
        ],
      });
      const contents = dynamicRead.contents as Array<{ uri: string }>;
      expect(contents.every(({ uri }) => isValidResourceUri(uri))).toBe(true);
      await request('resources/read', { uri: contents[2].uri });
      expect(observed).toContainEqual(
        expect.objectContaining({
          method: 'resources/read',
          params: expect.objectContaining({ uri: 'custom:///unlisted%2f?q=one#part' }),
        }),
      );
      const readsBeforeGuess = observed.filter(({ method }) => method === 'resources/read').length;
      await expect(
        request('resources/read', { uri: 'urn:1mcp:resource:00000000-0000-4000-8000-000000000000' }),
      ).rejects.toBeDefined();
      expect(observed.filter(({ method }) => method === 'resources/read')).toHaveLength(readsBeforeGuess);
      expect(manager.getInboundConnections().size).toBe(inboundEra === 'modern' ? 0 : 1);
      if (authenticated) {
        const originalAuth = verifiedAuth;
        verifiedAuth = { ...originalAuth, token: 'different-verified-token' };
        await expect(request('resources/read', { uri: contents[2].uri })).rejects.toBeDefined();
        verifiedAuth = { ...originalAuth, grantedScopes: ['tag:narrow'], grantedTags: ['narrow'] };
        await expect(request('resources/read', { uri: contents[2].uri })).rejects.toBeDefined();
        expect(observed.filter(({ method }) => method === 'resources/read')).toHaveLength(readsBeforeGuess);
        verifiedAuth = originalAuth;
        await request('resources/read', { uri: contents[2].uri });
      }
      expect(
        await request('completion/complete', {
          ref: { type: 'ref/prompt', name: publicIdentity(prompt.name) },
          argument: { name: 'topic', value: 't' },
        }),
      ).toMatchObject(results['completion/complete']);
      expect(isValidResourceUri(buildPublicResourceUri('fixture', resource.uri))).toBe(true);
      expect(
        await request('completion/complete', {
          ref: { type: 'ref/resource', uri: buildPublicResourceTemplate('fixture', template.uriTemplate) },
          argument: { name: 'name', value: 'g' },
        }),
      ).toMatchObject(results['completion/complete']);
      expect(observed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'tools/call', params: expect.objectContaining({ name: tool.name }) }),
          expect.objectContaining({ method: 'prompts/get', params: expect.objectContaining({ name: prompt.name }) }),
          expect.objectContaining({
            method: 'resources/read',
            params: expect.objectContaining({ uri: resource.uri }),
          }),
          expect.objectContaining({
            method: 'completion/complete',
            params: expect.objectContaining({ ref: { type: 'ref/resource', uri: template.uriTemplate } }),
          }),
          expect.objectContaining({
            method: 'resources/read',
            params: expect.objectContaining({ uri: 'file:///dynamic' }),
          }),
          expect.objectContaining({
            method: 'resources/read',
            params: expect.objectContaining({ uri: 'custom:///unlisted%2f?q=one#part' }),
          }),
        ]),
      );
    } finally {
      for (const close of cleanup.reverse()) await close();
    }
  });
});
