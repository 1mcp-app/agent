import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import * as pagination from '@src/core/capabilities/capabilityPagination.js';
import { LazyLoadingOrchestrator } from '@src/core/capabilities/lazyLoadingOrchestrator.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { ClientStatus } from '@src/core/types/index.js';
import type { JsonObject, JsonValue } from '@src/sdk/contracts/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import {
  createLegacyOutboundConnection,
  setOutboundNotificationHandler,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';

import express from 'express';
import request, { type Response } from 'supertest';
import { z } from 'zod';

import { setupModernHttpRoutes } from './modernHttpRoutes.js';

const revision = '2026-07-28';
const meta = {
  'io.modelcontextprotocol/protocolVersion': revision,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'owned-header-control', version: '1' },
};
const inputSchema = {
  type: 'object' as const,
  properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, value: { type: 'integer' } },
  required: ['region', 'value'],
};
const outputSchema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

function responseEvidence(response: Response): string {
  return JSON.stringify({
    status: response.status,
    contentType: response.headers['content-type'],
    body: response.body,
    text: response.text,
  });
}

async function fixture(era: 'legacy' | 'modern' = 'legacy', ownedSession?: string) {
  const calls: Array<unknown> = [];
  let schema: JsonObject & { type: 'object' } = inputSchema;
  let initialDiscovery: 'empty' | 'partial' | 'provider-addition' | 'epoch' | undefined;
  let listReads = 0;
  let beforeBridge = async () => {};
  let loseCatalogCoverage: () => Promise<void> = async () => {
    throw new Error('Catalog loss requires the real modern peer');
  };
  let connections: ReturnType<typeof createConnections>;
  const tools = () => [
    { name: 'region', inputSchema: schema, outputSchema },
    { name: 'plain', inputSchema: { type: 'object' as const } },
    {
      name: 'unsafe',
      inputSchema: { type: 'object' as const, properties: { value: { type: 'string', pattern: '(' } } },
    },
  ];
  const list = async () => {
    listReads++;
    const initial = initialDiscovery;
    initialDiscovery = undefined;
    if (initial === 'partial') throw new Error('Owned initial listing unavailable');
    if (initial === 'provider-addition') {
      const current = connections.get('header-peer')!;
      connections.set('added', { ...current, name: 'added' });
    }
    if (initial === 'epoch') await backend.notification({ method: 'notifications/tools/list_changed' });
    return { tools: initial === 'empty' || initial === 'epoch' ? [] : tools() };
  };
  const call = async (message: { params: { arguments?: unknown } }) => {
    calls.push(message);
    return {
      content: [{ type: 'text' as const, text: 'actual-owned-peer' }],
      structuredContent: {
        ok: (message.params.arguments as { value?: number } | undefined)?.value === 13 ? 'invalid' : true,
      },
      _meta: { 'owned.fixture/result': 'preserved' },
    };
  };
  const backend = new Server({ name: 'header-peer', version: '1' }, { capabilities: { tools: {} } });
  backend.setRequestHandler(ListToolsRequestSchema, list);
  backend.setRequestHandler(CallToolRequestSchema, call);
  const cleanup: Array<() => Promise<unknown>> = [];
  let client;
  let clientTransport;
  if (era === 'legacy') {
    const [legacyClientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    clientTransport = legacyClientTransport;
    client = new ClientFactory().createClient(clientTransport, {});
    await backend.connect(serverTransport);
    await client.connect(clientTransport);
  } else {
    const handler = createMcpHandler(
      () => {
        const server = new ModernServer(
          { name: 'header-peer', version: '2' },
          { capabilities: { tools: { listChanged: true } } },
        );
        server.setRequestHandler('tools/list', list);
        server.setRequestHandler('tools/call', call);
        return server;
      },
      { legacy: 'reject' },
    );
    let catalogResponse: ServerResponse | undefined;
    const nodeHandler = toNodeHandler(handler);
    const http = createServer((request, response) => {
      if (request.headers['mcp-method'] === 'subscriptions/listen') catalogResponse = response;
      void nodeHandler(request, response);
    });
    loseCatalogCoverage = async () => {
      if (!catalogResponse) throw new Error('Owned catalog stream is unavailable');
      // End only the live catalog stream; the actual peer still serves tool calls.
      catalogResponse.end();
    };
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    cleanup.push(async () => {
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
      await handler.close();
    });
    client = new ModernClient(
      { name: 'owned-modern-backend', version: '1' },
      {
        versionNegotiation: { mode: { pin: revision } },
      },
    );
    clientTransport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`),
    );
    await client.connect(clientTransport);
  }
  const connection = createLegacyOutboundConnection({
    name: 'header-peer',
    client,
    transport: clientTransport,
    status: ClientStatus.Connected,
    capabilities: { tools: era === 'modern' ? { listChanged: true } : {} },
  });
  if (era === 'modern') await connection.adapter.start();
  function createConnections() {
    return new Map([['header-peer', connection]]);
  }
  connections = createConnections();
  const manager = ServerManager.getOrCreateInstance(
    { name: 'header-gateway', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} } },
    connections,
    {},
  );
  const app = express();
  app.use(express.json());
  setupModernHttpRoutes(
    app as never,
    manager as never,
    [],
    async (...args) => {
      await beforeBridge();
      const [manager, config, options] = args;
      return createModernInboundLegacyBridge(
        manager,
        ownedSession ? { ...config, context: { sessionId: ownedSession } } : config,
        options,
      );
    },
    {
      allowsHost: () => true,
      allowsOrigin: () => true,
    },
  );
  // The fixture owns one listening endpoint for its entire lifetime. Supertest
  // must not create and tear down a different HTTP server for each call.
  const requestPorts: number[] = [];
  let listenerCloses = 0;
  const listener = createServer(app);
  listener.on('request', (incoming) => requestPorts.push(incoming.socket.localPort!));
  listener.on('close', () => listenerCloses++);
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as AddressInfo).port;
  const post = (name: string, args: unknown) =>
    request(listener)
      .post('/mcp')
      .set('MCP-Protocol-Version', revision)
      .set('Mcp-Method', 'tools/call')
      .set('Mcp-Name', name)
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args, _meta: meta } })
      .on('response', (response: Response) => {
        if (response.body?.result === undefined && response.body?.error === undefined)
          console.info('OWNED-HEADER-WIRE', responseEvidence(response));
      })
      .on('error', (error: Error & { code?: string; status?: number; response?: Response }) => {
        console.info(
          'OWNED-HEADER-REQUEST-ERROR',
          JSON.stringify({
            name,
            message: error.message,
            code: error.code,
            status: error.status,
            response: error.response ? responseEvidence(error.response) : undefined,
          }),
        );
      });
  return {
    manager,
    client,
    calls,
    connection,
    connections,
    post,
    listenerState: () => ({ port, listening: listener.listening, requestPorts: [...requestPorts], listenerCloses }),
    loseCatalogCoverage,
    listTools: () =>
      request(listener)
        .post('/mcp')
        .set('MCP-Protocol-Version', revision)
        .set('Mcp-Method', 'tools/list')
        .send({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: meta } }),
    setSchema: (next: JsonObject & { type: 'object' }) => {
      schema = next;
    },
    beforeDispatch: (next: () => Promise<void>) => {
      beforeBridge = next;
    },
    notifySchemaChanged: () => backend.notification({ method: 'notifications/tools/list_changed' }),
    initialDiscovery: (next: typeof initialDiscovery) => {
      initialDiscovery = next;
    },
    listReads: () => listReads,
    async close() {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
      await ServerManager.resetInstance();
      await connection.adapter.close();
      await backend.close();
      for (const close of cleanup) await close();
    },
  };
}

describe('modern param headers through real gateway and SDK peer', () => {
  it.each(['legacy', 'modern'] as const)(
    'validates headers against a real %s upstream and retains authless/unannotated calls',
    async (era) => {
      const peer = await fixture(era);
      const registered = vi.spyOn(pagination, 'registerCapabilityPaginationNotifications');
      const unregistered = vi.spyOn(pagination, 'unregisterCapabilityPaginationConnections');
      try {
        const name = 'header-peer_1mcp_region';
        const matching = await peer.post(name, { region: 'west', value: 1 }).set('Mcp-Param-Region', 'west');
        expect(matching.status).toBe(200);
        expect(matching.body.result, JSON.stringify(matching.body)).toMatchObject({
          content: [{ type: 'text', text: 'actual-owned-peer' }],
          structuredContent: { ok: true },
          _meta: { 'owned.fixture/result': 'preserved' },
        });
        expect(peer.calls).toHaveLength(1);
        await vi.waitFor(() => expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[0][0]));
        for (const value of [undefined, 'east']) {
          registered.mockClear();
          const pending = peer.post(name, { region: 'west', value: 1 });
          if (value !== undefined) pending.set('Mcp-Param-Region', value);
          const rejected = await pending;
          expect(rejected.status).toBe(400);
          expect(rejected.body).toMatchObject({ id: 7, error: { code: -32020 } });
          expect(peer.calls).toHaveLength(1);
          await vi.waitFor(() => expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[0][0]));
        }
        const plain = await peer.post('header-peer_1mcp_plain', {}).set('Mcp-Param-Region', 'unrelated');
        expect(plain.status).toBe(200);
        expect(plain.body.result.content).toEqual([{ type: 'text', text: 'actual-owned-peer' }]);
        expect(peer.calls).toHaveLength(2);
        const invalid = await peer.post(name, { region: 'west', value: 1.5 }).set('Mcp-Param-Region', 'west');
        expect(invalid.body.result).toMatchObject({ isError: true, content: [{ text: 'schema_input_invalid' }] });
        expect(peer.calls).toHaveLength(2);
        const badOutput = await peer.post(name, { region: 'west', value: 13 }).set('Mcp-Param-Region', 'west');
        expect(badOutput.body.error).toBeDefined();
        expect(badOutput.body.result).toBeUndefined();
        expect(peer.calls).toHaveLength(3);
        const unsafe = await peer.post('header-peer_1mcp_unsafe', { value: 'anything' });
        expect(unsafe.body.error).toBeDefined();
        expect(peer.calls).toHaveLength(3);
        const ownedListener = peer.listenerState();
        expect(ownedListener.listening).toBe(true);
        expect(ownedListener.listenerCloses).toBe(0);
        expect(ownedListener.requestPorts).toHaveLength(7);
        expect(new Set(ownedListener.requestPorts)).toEqual(new Set([ownedListener.port]));
      } finally {
        registered.mockRestore();
        unregistered.mockRestore();
        await peer.close();
        expect(peer.listenerState()).toMatchObject({ listening: false, listenerCloses: 1 });
      }
    },
  );

  it('does not enforce an unsupported number declaration and preserves ordinary schema validation', async () => {
    const peer = await fixture();
    try {
      peer.setSchema({
        type: 'object',
        properties: { region: { type: 'number', 'x-mcp-header': 'Region' } },
        required: ['region'],
      });
      for (const header of [undefined, 'mismatched']) {
        const pending = peer.post('header-peer_1mcp_region', { region: 1.5 });
        if (header !== undefined) pending.set('Mcp-Param-Region', header);
        const response = await pending;
        expect(response.body.result, responseEvidence(response)).toMatchObject({
          content: [{ text: 'actual-owned-peer' }],
        });
      }
      expect(peer.calls).toHaveLength(2);
      const invalid = await peer.post('header-peer_1mcp_region', { region: 'invalid' });
      expect(invalid.body.result).toMatchObject({ isError: true, content: [{ text: 'schema_input_invalid' }] });
      expect(peer.calls).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });

  it.each([
    'items',
    'prefixItems',
    'contains',
    'additionalItems',
    'contentSchema',
    'additionalProperties',
    'unevaluatedProperties',
    'unevaluatedItems',
    'propertyNames',
    'patternProperties',
    'dependentSchemas',
    'dependencies',
    'oneOf',
    'anyOf',
    'allOf',
    'not',
    'if',
    'then',
    'else',
    '$defs',
    'definitions',
  ])('ignores the entire mixed declaration set when %s contains an excluded annotation', async (keyword) => {
    const peer = await fixture();
    try {
      const annotation: JsonObject = { type: 'string', 'x-mcp-header': 'Hidden' };
      const mapped = ['patternProperties', 'dependentSchemas', 'dependencies', '$defs', 'definitions'].includes(
        keyword,
      );
      const array = ['prefixItems', 'oneOf', 'anyOf', 'allOf'].includes(keyword);
      let branch: JsonValue = annotation;
      if (mapped) branch = { hidden: annotation };
      else if (array) branch = [annotation];
      peer.setSchema({
        ...inputSchema,
        properties: { ...inputSchema.properties, unused: { type: 'object', [keyword]: branch } },
      });
      // Region is valid and present, but the excluded annotation invalidates the
      // whole declaration set. Neither missing nor mismatched Region is enforced.
      for (const header of [undefined, 'east']) {
        const pending = peer.post('header-peer_1mcp_region', { region: 'west', value: 1 });
        if (header !== undefined) pending.set('Mcp-Param-Region', header);
        const response = await pending;
        expect(response.body.result, responseEvidence(response)).toMatchObject({
          content: [{ text: 'actual-owned-peer' }],
        });
      }
      expect(peer.calls).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });

  it('rejects unsafe annotated integers before dispatch and allows both safe boundaries', async () => {
    const peer = await fixture();
    try {
      peer.setSchema({
        ...inputSchema,
        properties: { ...inputSchema.properties, value: { type: 'integer', 'x-mcp-header': 'Value' } },
      });
      for (const header of [undefined, 'mismatched']) {
        const pending = peer
          .post('header-peer_1mcp_region', { region: 'west', value: Number.MAX_SAFE_INTEGER + 1 })
          .set('Mcp-Param-Region', 'west');
        if (header !== undefined) pending.set('Mcp-Param-Value', header);
        const response = await pending;
        expect(response.body).toMatchObject({ id: 7, error: { code: -32602 } });
        expect(peer.calls).toHaveLength(0);
      }
      for (const value of [1.5, '1.5']) {
        const response = await peer
          .post('header-peer_1mcp_region', { region: 'west', value })
          .set('Mcp-Param-Region', 'west')
          .set('Mcp-Param-Value', String(value));
        expect(response.body.error, responseEvidence(response)).toBeUndefined();
        expect(response.body.result, responseEvidence(response)).toMatchObject({
          isError: true,
          content: [{ text: 'schema_input_invalid' }],
        });
        expect(peer.calls).toHaveLength(0);
      }
      for (const value of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]) {
        const response = await peer
          .post('header-peer_1mcp_region', { region: 'west', value })
          .set('Mcp-Param-Region', 'west')
          .set('Mcp-Param-Value', String(value));
        expect(response.body.result, responseEvidence(response)).toMatchObject({
          content: [{ text: 'actual-owned-peer' }],
        });
      }
      expect(peer.calls).toHaveLength(2);
    } finally {
      await peer.close();
    }
  });

  it.each(['empty', 'partial', 'provider-addition', 'epoch'] as const)(
    'fences absent-to-present definitions after %s discovery',
    async (mode) => {
      for (const header of [undefined, 'east']) {
        const peer = await fixture();
        try {
          peer.initialDiscovery(mode);
          const name = mode === 'provider-addition' ? 'added_1mcp_region' : 'header-peer_1mcp_region';
          const pending = peer.post(name, { region: 'west', value: 1 });
          if (header !== undefined) pending.set('Mcp-Param-Region', header);
          const response = await pending;
          expect(response.body, responseEvidence(response)).toMatchObject({ id: 7, error: { code: -32602 } });
          expect(peer.calls).toHaveLength(0);
          expect(peer.listReads()).toBe(1);
        } finally {
          await peer.close();
        }
      }
    },
  );

  it('retains an explicitly enabled internal tool without authorizing an external provider', async () => {
    const config = vi.spyOn(AgentConfigManager.getInstance(), 'getInternalToolsList').mockReturnValue(['status']);
    const peer = await fixture();
    try {
      const listed = await peer.listTools();
      expect(listed.body.error, JSON.stringify(listed.body)).toBeUndefined();
      const status = listed.body.result.tools.find(
        (tool: { name: string; _meta?: Record<string, { server?: string; upstreamIdentity?: string }> }) =>
          tool._meta?.['app.1mcp/route']?.server === '1mcp' &&
          tool._meta?.['app.1mcp/route']?.upstreamIdentity === 'mcp_status',
      );
      expect(status).toBeDefined();
      const response = await peer.post(status.name, {}).set('Mcp-Param-Region', 'unrelated');
      expect(response.body.error, responseEvidence(response)).toBeUndefined();
      expect(response.body.result).toBeDefined();
      expect(peer.calls).toHaveLength(0);
    } finally {
      config.mockRestore();
      await peer.close();
    }
  });

  it('retains lazy gateway meta-tools from the same initialized manager inventory', async () => {
    const config = AgentConfigManager.getInstance();
    const previous = config.get('lazyLoading');
    config.updateConfig({ lazyLoading: { ...previous, enabled: true } });
    const peer = await fixture();
    try {
      peer.manager.setLazyLoadingOrchestrator(new LazyLoadingOrchestrator(peer.connections, config));
      const listed = await peer.listTools();
      expect(listed.body.error, JSON.stringify(listed.body)).toBeUndefined();
      expect(listed.body.result.tools.some((tool: { name: string }) => tool.name === 'tool_list')).toBe(true);
      const response = await peer.post('tool_list', {}).set('Mcp-Param-Region', 'unrelated');
      expect(response.body.error, responseEvidence(response)).toBeUndefined();
      expect(response.body.result.isError).not.toBe(true);
      expect(peer.calls).toHaveLength(0);
    } finally {
      config.updateConfig({ lazyLoading: previous });
      await peer.close();
    }
  });

  it('serves an owned session-bound lazy cursor without another upstream listing', async () => {
    const config = AgentConfigManager.getInstance();
    const previous = config.get('lazyLoading');
    config.updateConfig({ lazyLoading: { ...previous, enabled: true } });
    // The existing cursor is session-bound. Supply an owned public config
    // context to test cached continuation admission without changing production
    // stateless bridge identity or SDK frames.
    const peer = await fixture('legacy', 'owned-lazy-cursor-session');
    try {
      peer.manager.setLazyLoadingOrchestrator(new LazyLoadingOrchestrator(peer.connections, config));
      const first = await peer.post('tool_list', { limit: 1 });
      expect(first.body.error, JSON.stringify(first.body)).toBeUndefined();
      const cursor = first.body.result.structuredContent.nextCursor;
      expect(typeof cursor).toBe('string');
      const reads = peer.listReads();
      peer.initialDiscovery('partial');
      const next = await peer.post('tool_list', { limit: 1, cursor });
      expect(next.body.error, JSON.stringify(next.body)).toBeUndefined();
      expect(next.body.result.isError, JSON.stringify(next.body)).not.toBe(true);
      expect(next.body.result.structuredContent.tools).toHaveLength(1);
      expect(peer.listReads()).toBe(reads);
      expect(peer.calls).toHaveLength(0);
    } finally {
      config.updateConfig({ lazyLoading: previous });
      await peer.close();
    }
  });

  it('rejects a held validated header call after trusted modern catalog coverage loss', async () => {
    const peer = await fixture('modern');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = vi.fn();
    const loss = vi.fn();
    const upstream = vi.spyOn(peer.client, 'request');
    setOutboundNotificationHandler(
      peer.connection,
      z.object({ method: z.literal('notifications/1mcp/subscription_lost') }),
      loss,
    );
    peer.beforeDispatch(async () => {
      entered();
      await held;
    });
    try {
      const pending = peer
        .post('header-peer_1mcp_region', { region: 'west', value: 1 })
        .set('Mcp-Param-Region', 'west')
        .then((response) => response);
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      await peer.loseCatalogCoverage();
      await vi.waitFor(() => expect(loss).toHaveBeenCalledOnce());
      release();
      const response = await pending;
      expect(response.body.error, responseEvidence(response)).toBeDefined();
      expect(peer.calls).toHaveLength(0);
      expect(upstream.mock.calls.filter(([message]) => message.method === 'tools/call')).toHaveLength(0);
    } finally {
      upstream.mockRestore();
      release();
      await peer.close();
    }
  });

  it.each(['schema', 'provider'] as const)(
    'fences changed %s after SDK header validation before backend dispatch',
    async (change) => {
      const peer = await fixture();
      try {
        const name = 'header-peer_1mcp_region';
        peer.beforeDispatch(async () => {
          if (change === 'schema') {
            peer.setSchema({ ...inputSchema, required: ['region'] });
            await peer.notifySchemaChanged();
          } else {
            peer.connections.set('header-peer', { ...peer.connection });
          }
        });
        const rejected = await peer.post(name, { region: 'west', value: 1 }).set('Mcp-Param-Region', 'west');
        expect(rejected.body.error, JSON.stringify(rejected.body)).toBeDefined();
        expect(peer.calls).toHaveLength(0);
      } finally {
        await peer.close();
      }
    },
  );
});
