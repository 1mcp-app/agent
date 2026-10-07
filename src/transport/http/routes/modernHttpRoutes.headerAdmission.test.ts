import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import * as pagination from '@src/core/capabilities/capabilityPagination.js';
import { InternalCapabilitiesProvider } from '@src/core/capabilities/internalCapabilitiesProvider.js';
import { ClientStatus } from '@src/core/types/index.js';
import { ClientFactory } from '@src/sdk/legacy/client/runtime/clientFactory.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';

import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { setupModernHttpRoutes } from './modernHttpRoutes.js';

const revision = '2026-07-28';
const name = 'admission-peer_1mcp_region';
const meta = {
  'io.modelcontextprotocol/protocolVersion': revision,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'header-admission-control', version: '1' },
};

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture() {
  let listReads = 0;
  let executions = 0;
  let beforeListing = async () => {};
  const backend = new Server({ name: 'admission-peer', version: '1' }, { capabilities: { tools: {} } });
  backend.setRequestHandler(ListToolsRequestSchema, async () => {
    listReads++;
    await beforeListing();
    return {
      tools: [
        {
          name: 'region',
          inputSchema: {
            type: 'object',
            properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
            required: ['region'],
          },
        },
      ],
    };
  });
  backend.setRequestHandler(CallToolRequestSchema, async () => {
    executions++;
    return { content: [{ type: 'text', text: 'actual-admitted-peer' }] };
  });
  const [transport, upstreamTransport] = InMemoryTransport.createLinkedPair();
  const client = new ClientFactory().createClient(transport, {});
  await backend.connect(upstreamTransport);
  await client.connect(transport);
  const connection = createLegacyOutboundConnection({
    name: 'admission-peer',
    client,
    transport,
    status: ClientStatus.Connected,
    capabilities: { tools: {} },
  });
  const connections = new Map([['admission-peer', connection]]);
  const manager = ServerManager.getOrCreateInstance(
    { name: 'admission-gateway', version: '1' },
    { capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} } },
    connections,
    {},
  );
  const app = express();
  app.use(express.json());
  setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
    allowsHost: () => true,
    allowsOrigin: () => true,
  });
  // Own one endpoint for the whole pressure batch; request(app) otherwise
  // creates a separate ephemeral listening server for every request.
  const listener = createServer(app);
  const requestPorts: number[] = [];
  let listenerCloses = 0;
  listener.on('request', (incoming) => requestPorts.push(incoming.socket.localPort!));
  listener.on('close', () => listenerCloses++);
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as AddressInfo).port;
  return {
    post: () =>
      request(listener)
        .post('/mcp')
        .set('Accept', 'application/json')
        .set('MCP-Protocol-Version', revision)
        .set('Mcp-Method', 'tools/call')
        .set('Mcp-Name', name)
        .send({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: { name, arguments: { region: 'west' }, _meta: meta },
        }),
    beforeListing: (hook: () => Promise<void>) => {
      beforeListing = hook;
    },
    listReads: () => listReads,
    executions: () => executions,
    listenerState: () => ({ port, listening: listener.listening, requestPorts: [...requestPorts], listenerCloses }),
    async close() {
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
      await ServerManager.resetInstance();
      await connection.adapter.close();
      await backend.close();
    },
  };
}

function expectOwnedListener(peer: Awaited<ReturnType<typeof fixture>>, requestCount: number) {
  const state = peer.listenerState();
  expect(state).toMatchObject({ listening: true, listenerCloses: 0 });
  expect(state.requestPorts).toHaveLength(requestCount);
  expect(new Set(state.requestPorts)).toEqual(new Set([state.port]));
}

describe('modern live tool-header admission through a real provider', () => {
  it('releases all permits when the SDK factory fails before a registry is returned', async () => {
    const peer = await fixture();
    const registered = vi.spyOn(pagination, 'registerCapabilityPaginationNotifications');
    const unregistered = vi.spyOn(pagination, 'unregisterCapabilityPaginationConnections');
    const gate = deferred();
    const initialize = vi
      .spyOn(InternalCapabilitiesProvider.getInstance(), 'initialize')
      .mockImplementation(async () => {
        await gate.promise;
        throw new Error('Owned capability initialization failure');
      });
    const pending = Array.from({ length: 256 }, () => peer.post().then((response) => response));
    const settled = Promise.allSettled(pending);
    try {
      await vi.waitFor(() => expect(initialize).toHaveBeenCalledTimes(256), { timeout: 5000 });
      expectOwnedListener(peer, 256);
      const observed = new Set(registered.mock.calls.map(([map]) => map));
      expect(observed.size).toBe(256);
      expect(peer.listReads()).toBe(0);
      const overloaded = await peer.post();
      expect(overloaded.body.error).toMatchObject({
        code: -32000,
        data: { 'app.1mcp/failure': { code: 'gateway_overloaded' } },
      });
      expect(initialize).toHaveBeenCalledTimes(256);
      expect(registered).toHaveBeenCalledTimes(256);
      gate.release();
      const failed = await Promise.all(pending);
      expect(failed.every((response) => response.status === 500 && response.body.error.code === -32603)).toBe(true);
      for (const map of observed) expect(unregistered).toHaveBeenCalledWith(map);
      initialize.mockRestore();
      const observerIndex = registered.mock.calls.length;
      const recovered = await peer.post().set('Mcp-Param-Region', 'west');
      expect(recovered.body.result.content).toEqual([{ type: 'text', text: 'actual-admitted-peer' }]);
      expect(peer.executions()).toBe(1);
      await vi.waitFor(() => expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[observerIndex][0]));
      expectOwnedListener(peer, 258);
    } finally {
      gate.release();
      await settled;
      initialize.mockRestore();
      registered.mockRestore();
      unregistered.mockRestore();
      await peer.close();
      expect(peer.listenerState()).toMatchObject({ listening: false, listenerCloses: 1 });
    }
  }, 30_000);

  it('bounds observer/catalog allocation at 256 and releases failed, rejected and successful admissions', async () => {
    const peer = await fixture();
    const registered = vi.spyOn(pagination, 'registerCapabilityPaginationNotifications');
    const unregistered = vi.spyOn(pagination, 'unregisterCapabilityPaginationConnections');
    const gate = deferred();
    const pending: Array<Promise<request.Response>> = [];
    try {
      peer.beforeListing(async () => {
        throw new Error('Owned provider listing failure');
      });
      const failed = await peer.post().set('Mcp-Param-Region', 'west');
      expect(failed.body.error).toBeDefined();
      expect(peer.executions()).toBe(0);
      expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[0][0]);

      peer.beforeListing(async () => {});
      const successObserverIndex = registered.mock.calls.length;
      const successful = await peer.post().set('Mcp-Param-Region', 'west');
      expect(successful.body.result.content).toEqual([{ type: 'text', text: 'actual-admitted-peer' }]);
      expect(peer.executions()).toBe(1);
      // Response bytes can arrive before the route finishes SDK/registry close.
      await vi.waitFor(() => expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[successObserverIndex][0]));
      const readsBeforePressure = peer.listReads();
      registered.mockClear();
      unregistered.mockClear();
      peer.beforeListing(() => gate.promise);
      // Missing the provider-declared header must reject after acquisition. These
      // calls retain all admission observers while the real tools/list is held.
      pending.push(...Array.from({ length: 256 }, () => peer.post().then((response) => response)));
      await vi.waitFor(() => expect(peer.listReads() - readsBeforePressure).toBe(256), { timeout: 5000 });
      expectOwnedListener(peer, 258);
      const observed = new Set(registered.mock.calls.map(([map]) => map));
      expect(observed.size).toBe(256);
      let excess: request.Response | undefined;
      pending.push(peer.post().then((response) => (excess = response)));
      await vi.waitFor(() => expect(excess !== undefined || peer.listReads() - readsBeforePressure > 256).toBe(true), {
        timeout: 5000,
      });
      expect(peer.listReads() - readsBeforePressure).toBe(256);
      expect(registered).toHaveBeenCalledTimes(256);
      expect(excess?.status).toBe(200);
      expect(excess?.body.error).toMatchObject({
        code: -32000,
        data: { 'app.1mcp/failure': { kind: 'transport', code: 'gateway_overloaded' } },
      });
      expect(peer.executions()).toBe(1);

      // The SDK's standard header ladder still runs before a saturated factory.
      const malformed = await peer.post().set('Mcp-Method', 'tools/list');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe(-32020);
      expect(registered).toHaveBeenCalledTimes(256);

      gate.release();
      const rejected = (await Promise.all(pending)).slice(0, 256);
      expect(rejected.every((response) => response.status === 400 && response.body.error.code === -32020)).toBe(true);
      for (const map of observed) expect(unregistered).toHaveBeenCalledWith(map);
      expect(peer.executions()).toBe(1);
      const recoveryObserverIndex = registered.mock.calls.length;
      const recovered = await peer.post().set('Mcp-Param-Region', 'west');
      expect(recovered.body.result.content).toEqual([{ type: 'text', text: 'actual-admitted-peer' }]);
      expect(peer.executions()).toBe(2);
      await vi.waitFor(() =>
        expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[recoveryObserverIndex][0]),
      );
      expectOwnedListener(peer, 261);
    } finally {
      gate.release();
      await Promise.allSettled(pending);
      registered.mockRestore();
      unregistered.mockRestore();
      await peer.close();
      expect(peer.listenerState()).toMatchObject({ listening: false, listenerCloses: 1 });
    }
  }, 30_000);

  it('releases all 256 disconnected admissions before their upstream listings finish', async () => {
    const peer = await fixture();
    const registered = vi.spyOn(pagination, 'registerCapabilityPaginationNotifications');
    const unregistered = vi.spyOn(pagination, 'unregisterCapabilityPaginationConnections');
    const gate = deferred();
    peer.beforeListing(() => gate.promise);
    const requests = Array.from({ length: 256 }, () => peer.post().set('Mcp-Param-Region', 'west'));
    const settled = Promise.allSettled(requests.map((pending) => pending.then((response) => response)));
    let recovered: Promise<request.Response> | undefined;
    try {
      await vi.waitFor(() => expect(peer.listReads()).toBe(256), { timeout: 5000 });
      expectOwnedListener(peer, 256);
      const observed = new Set(registered.mock.calls.map(([map]) => map));
      expect(observed.size).toBe(256);
      for (const pending of requests) pending.abort();
      await settled;
      await vi.waitFor(() => {
        for (const map of observed) expect(unregistered).toHaveBeenCalledWith(map);
      });
      expect(peer.executions()).toBe(0);
      const recoveryObserverIndex = registered.mock.calls.length;
      recovered = peer
        .post()
        .set('Mcp-Param-Region', 'west')
        .then((response) => response);
      await vi.waitFor(() => expect(peer.listReads()).toBe(257));
      gate.release();
      const response = await recovered;
      expect(response.body.result.content).toEqual([{ type: 'text', text: 'actual-admitted-peer' }]);
      expect(peer.executions()).toBe(1);
      await vi.waitFor(() =>
        expect(unregistered).toHaveBeenCalledWith(registered.mock.calls[recoveryObserverIndex][0]),
      );
      expectOwnedListener(peer, 257);
    } finally {
      for (const pending of requests) pending.abort();
      gate.release();
      await settled;
      await recovered;
      registered.mockRestore();
      unregistered.mockRestore();
      await peer.close();
      expect(peer.listenerState()).toMatchObject({ listening: false, listenerCloses: 1 });
    }
  }, 30_000);
});
