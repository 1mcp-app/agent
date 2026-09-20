import { Client as ModernClient, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server as ModernServer } from '@modelcontextprotocol/server';

import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

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
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';
import { buildUri } from '@src/utils/core/parsing.js';

import express from 'express';
import { describe, expect, it } from 'vitest';

const uri = 'fixture://document?key=a%2Fb';
const publicUri = buildUri('fixture', uri, MCP_URI_SEPARATOR);
const capabilities = { resources: { subscribe: true, listChanged: true } };
type Note = { method: string; params?: { uri?: string; [key: string]: unknown } };

async function listen(server: HttpServer): Promise<URL> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`);
}
async function closeHttp(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

// Read the wire, including frame headers: SDK callbacks alone cannot prove ack ordering or absence of replay IDs.
async function openStream(url: URL, id: string) {
  const controller = new AbortController();
  const response = await fetch(url, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'Mcp-Method': 'subscriptions/listen',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'subscriptions/listen',
      params: {
        notifications: { resourceSubscriptions: [publicUri], resourcesListChanged: true },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'subscription-wire-test', version: '1' },
        },
      },
    }),
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const notes: Note[] = [];
  const frames: string[] = [];
  const reader = response.body!.getReader();
  const done = (async () => {
    const decoder = new TextDecoder();
    let pending = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        pending += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n');
        let end;
        while ((end = pending.indexOf('\n\n')) >= 0) {
          const frame = pending.slice(0, end);
          pending = pending.slice(end + 2);
          frames.push(frame);
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
          if (data) notes.push(JSON.parse(data));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  })();
  await expect.poll(() => notes.length).toBeGreaterThan(0);
  expect(notes[0]).toMatchObject({
    method: 'notifications/subscriptions/acknowledged',
    params: {
      notifications: { resourceSubscriptions: [publicUri], resourcesListChanged: true },
      _meta: { 'io.modelcontextprotocol/subscriptionId': id },
    },
  });
  return {
    notes,
    frames,
    close: async () => {
      controller.abort();
      await done;
    },
  };
}

describe('resource notification journeys with real SDK peers', () => {
  it.each([
    ['legacy', 'legacy'],
    ['legacy', 'modern'],
    ['modern', 'legacy'],
    ['modern', 'modern'],
  ] as const)(
    '%s inbound / %s backend preserves URI and independent subscription ownership',
    async (inboundEra, outboundEra) => {
      const cleanup: Array<() => Promise<unknown>> = [];
      try {
        let connection;
        let emit: (resourceUri: string) => Promise<void>;
        let emitListChanged: () => Promise<void>;
        if (outboundEra === 'legacy') {
          const backend = new LegacyServer({ name: 'fixture', version: '1' }, { capabilities });
          const subscribed = new Set<string>();
          emitListChanged = () => backend.notification({ method: 'notifications/resources/list_changed' });
          backend.setRequestHandler(ListResourcesRequestSchema, async () => ({
            resources: [{ uri, name: 'Document' }],
          }));
          backend.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: [] }));
          backend.setRequestHandler(SubscribeRequestSchema, async (request) => {
            subscribed.add(request.params.uri);
            return {};
          });
          backend.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
            subscribed.delete(request.params.uri);
            return {};
          });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const client = new ClientFactory().createClient(clientTransport, {});
          await backend.connect(serverTransport);
          await client.connect(clientTransport);
          cleanup.push(() => backend.close());
          connection = createLegacyOutboundConnection({
            name: 'fixture',
            client,
            transport: clientTransport,
            status: ClientStatus.Connected,
            capabilities,
          });
          emit = async (resourceUri) => {
            // Wrong-URI sends are deliberate: the gateway must not trust backend filtering.
            if (resourceUri !== uri || subscribed.has(uri))
              await backend.notification({ method: 'notifications/resources/updated', params: { uri: resourceUri } });
          };
        } else {
          const handler = createMcpHandler(
            () => {
              const backend = new ModernServer({ name: 'fixture', version: '2' }, { capabilities });
              backend.setRequestHandler('resources/list', async () => ({ resources: [{ uri, name: 'Document' }] }));
              backend.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
              return backend;
            },
            { legacy: 'reject' },
          );
          const server = createServer(toNodeHandler(handler));
          const url = await listen(server);
          cleanup.push(
            () => closeHttp(server),
            () => handler.close(),
          );
          const client = new ModernClient(
            { name: 'gateway-backend', version: '2' },
            { versionNegotiation: { mode: { pin: '2026-07-28' } } },
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
          emit = async (resourceUri) => {
            handler.notify.resourceUpdated(resourceUri);
          };
          emitListChanged = async () => {
            handler.notify.resourcesChanged();
          };
        }
        cleanup.push(() => connection.adapter.close());
        const manager = ServerManager.getOrCreateInstance(
          { name: 'aggregate', version: '1' },
          { capabilities: { ...capabilities, tools: {}, prompts: {}, completions: {}, logging: {} } },
          new Map([['fixture', connection]]),
          {},
        );
        cleanup.push(() => ServerManager.resetInstance());
        if (inboundEra === 'legacy') {
          const owners = await Promise.all(
            [0, 1].map(async (index) => {
              const client = new LegacyClient({ name: `owner-${index}`, version: '1' });
              const notes: Note[] = [];
              const catalogNotes: Note[] = [];
              client.setNotificationHandler(ResourceListChangedNotificationSchema, (notification) => {
                catalogNotes.push(notification);
              });
              client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
                notes.push(notification);
              });
              const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
              await manager.connectTransport(serverTransport, `owner-${index}`, {});
              await client.connect(clientTransport);
              cleanup.push(() => client.close());
              await client.subscribeResource({ uri: publicUri });
              return { client, notes, catalogNotes };
            }),
          );
          await emit(uri);
          await expect.poll(() => owners.map((owner) => owner.notes.length)).toEqual([1, 1]);
          expect(owners.map((owner) => owner.notes[0].params?.uri)).toEqual([publicUri, publicUri]);
          await emit(`${uri}/different`);
          await delay(50);
          expect(owners.map((owner) => owner.notes.length)).toEqual([1, 1]);
          await owners[0].client.unsubscribeResource({ uri: publicUri });
          await emit(uri);
          await expect.poll(() => owners[1].notes.length).toBe(2);
          expect(owners[0].notes).toHaveLength(1);
          await owners[0].client.subscribeResource({ uri: publicUri });
          await delay(50);
          expect(owners[0].notes).toHaveLength(1);
          await emit(uri);
          await expect.poll(() => owners.map((owner) => owner.notes.length)).toEqual([2, 3]);
          await emitListChanged();
          await expect.poll(() => owners.map((owner) => owner.catalogNotes.length)).toEqual([1, 1]);
          expect(owners[0].catalogNotes[0].method).toBe('notifications/resources/list_changed');
        } else {
          const app = express();
          app.use(express.json());
          setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
            allowsHost: () => true,
            allowsOrigin: () => true,
          });
          const server = createServer(app);
          const url = await listen(server);
          cleanup.push(() => closeHttp(server));
          const first = await openStream(url, 'first');
          cleanup.push(first.close);
          const second = await openStream(url, 'second');
          cleanup.push(second.close);
          await emit(uri);
          await expect.poll(() => [first.notes.length, second.notes.length]).toEqual([2, 2]);
          expect(first.notes[1]).toMatchObject({
            method: 'notifications/resources/updated',
            params: { uri: publicUri },
          });
          await emit(`${uri}/different`);
          await delay(50);
          expect([first.notes.length, second.notes.length]).toEqual([2, 2]);
          await first.close();
          await emit(uri);
          await expect.poll(() => second.notes.length).toBe(3);
          expect(first.notes).toHaveLength(2);
          const replacement = await openStream(url, 'replacement');
          cleanup.push(replacement.close);
          await delay(50);
          expect(replacement.notes).toHaveLength(1);
          await emit(uri);
          await expect.poll(() => replacement.notes.length).toBe(2);
          expect(replacement.notes[1].params?.uri).toBe(publicUri);
          await expect.poll(() => second.notes.length).toBe(4);
          await emitListChanged();
          await expect.poll(() => [second.notes.length, replacement.notes.length]).toEqual([5, 3]);
          expect(replacement.notes[2]).toMatchObject({
            method: 'notifications/resources/list_changed',
            params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'replacement' } },
          });
          expect(first.notes).toHaveLength(2);
          for (const stream of [first, second, replacement])
            expect(stream.frames.some((frame) => /^id:/m.test(frame))).toBe(false);
        }
      } finally {
        for (const close of cleanup.reverse()) await close();
      }
    },
    20_000,
  );
});
