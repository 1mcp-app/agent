import { Client as ModernClient } from '@modelcontextprotocol/client';

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ClientStatus } from '@src/core/types/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { SSEClientTransport } from '@src/sdk/legacy/client/sse.js';
import { StreamableHTTPClientTransport } from '@src/sdk/legacy/client/streamableHttp.js';
import { ServerManager } from '@src/sdk/legacy/server/runtime/serverManager.js';
import { SSEServerTransport } from '@src/sdk/legacy/server/sse.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { createModernInboundLegacyBridge } from '@src/sdk/legacy/transport/http/modernInboundLegacyBridge.js';
import { LoggingMessageNotificationSchema, ResultSchema } from '@src/sdk/legacy/types.js';
import { setupModernHttpRoutes } from '@src/transport/http/routes/modernHttpRoutes.js';

import express from 'express';
import { describe, expect, it, vi } from 'vitest';

const parent = '00-12345678901234567890123456789012-1234567890123456-01';
const metadata = {
  traceparent: parent,
  tracestate: 'vendor=opaque',
  baggage: 'secret=must-not-forward',
  contextProof: { signature: 'must-not-forward' },
};
const capabilities = { tools: {}, prompts: {}, resources: {}, completions: {}, logging: {} };

describe('real transport trace carriers', () => {
  it.each(['sse', 'streamable-http', 'legacy-proxy', 'modern-proxy'] as const)(
    '%s inbound preserves propagation to stdio upstream',
    async (transportKind) => {
      const directory = await mkdtemp(path.join(tmpdir(), '1mcp-tracing-'));
      const cleanup: Array<() => Promise<unknown>> = [() => rm(directory, { recursive: true, force: true })];
      try {
        const upstream = new Client(
          { name: 'upstream-client', version: '1' },
          { capabilities: { roots: { listChanged: true } } },
        );
        const recreate = (): StdioClientTransport =>
          Object.assign(
            new StdioClientTransport({
              command: process.execPath,
              args: [path.resolve('test/e2e/fixtures/tracing-stdio-server.mjs')],
              stderr: 'pipe',
            }),
            { recreate },
          );
        const stdio = recreate();
        await upstream.connect(stdio);
        const connection = createLegacyOutboundConnection({
          name: 'fixture',
          client: upstream,
          transport: stdio,
          status: ClientStatus.Connected,
          capabilities,
        });
        cleanup.push(() => connection.adapter.close());
        const manager = ServerManager.getOrCreateInstance(
          { name: 'aggregate', version: '1' },
          { capabilities },
          new Map([['fixture', connection]]),
          {},
        );
        cleanup.push(() => ServerManager.resetInstance());
        const app = express();
        app.use(express.json());
        if (transportKind === 'modern-proxy') {
          setupModernHttpRoutes(app as never, manager as never, [], createModernInboundLegacyBridge, {
            allowsHost: () => true,
            allowsOrigin: () => true,
          });
        } else if (transportKind === 'sse') {
          const sessions = new Map<string, SSEServerTransport>();
          app.get('/sse', async (_req, res) => {
            const transport = new SSEServerTransport('/message', res);
            sessions.set(transport.sessionId, transport);
            await manager.connectTransport(transport, transport.sessionId, {});
          });
          app.post('/message', async (req, res) => {
            const transport = sessions.get(String(req.query.sessionId));
            if (!transport) {
              res.sendStatus(404);
              return;
            }
            await transport.handlePostMessage(req, res, req.body);
          });
        } else {
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
          await manager.connectTransport(transport, 'tracing-http', {});
          app.all('/mcp', async (req, res) => {
            await transport.handleRequest(req, res, req.body);
          });
        }
        const http = createServer(app);
        await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
        cleanup.push(async () => {
          http.closeAllConnections();
          await new Promise<void>((resolve) => http.close(() => resolve()));
        });
        const url = new URL(
          `http://127.0.0.1:${(http.address() as AddressInfo).port}/${transportKind === 'sse' ? 'sse' : 'mcp'}`,
        );
        if (transportKind === 'modern-proxy') {
          const client = new ModernClient(
            { name: 'tracing-client', version: '2' },
            { versionNegotiation: { mode: { pin: '2026-07-28' } } },
          );
          // The released modern client speaks to the actual proxy process over stdio.
          const proxy = new StdioClientTransport({
            command: process.execPath,
            args: [path.resolve('test/e2e/fixtures/tracing-proxy.mjs'), url.href],
            stderr: 'pipe',
          });
          cleanup.push(() => client.close());
          await client.connect(proxy as never);
          await expect(
            client.request({
              method: 'tools/call',
              params: { name: 'fixture_1mcp_trace', arguments: {}, _meta: metadata },
            } as never),
          ).rejects.toThrow('Request context proof rejected');
          const { contextProof: _rejectedProof, ...acceptedMetadata } = metadata;
          const result = (await client.request({
            method: 'tools/call',
            params: { name: 'fixture_1mcp_trace', arguments: {}, _meta: acceptedMetadata },
          } as never)) as { content: Array<{ text: string }> };
          expect(JSON.parse(result.content[0].text)).toEqual({ traceparent: parent, tracestate: 'vendor=opaque' });
          expect(result).toMatchObject({ _meta: { other: 'preserved' }, structuredContent: { baggage: 'legit' } });
          expect((result as unknown as { _meta: object })._meta).not.toHaveProperty('baggage');
        } else {
          const client = new Client(
            { name: 'tracing-client', version: '1' },
            { capabilities: { roots: { listChanged: true } } },
          );
          const notifications: unknown[] = [];
          client.setNotificationHandler(LoggingMessageNotificationSchema, async (notification) => {
            notifications.push(notification.params);
            await client.notification({
              method: 'notifications/roots/list_changed',
              params: {
                _meta: {
                  baggage: 'private-roots-carrier',
                  other: 'preserved',
                  business: { baggage: 'legit-roots-data' },
                },
              },
            });
          });
          const transport =
            transportKind === 'sse'
              ? new SSEClientTransport(url)
              : transportKind === 'streamable-http'
                ? new StreamableHTTPClientTransport(url)
                : new StdioClientTransport({
                    command: process.execPath,
                    args: [path.resolve('test/e2e/fixtures/tracing-proxy.mjs'), url.href],
                    stderr: 'pipe',
                  });
          cleanup.push(() => client.close());
          await client.connect(transport);
          for (const traceparent of [parent, 'malformed-private-carrier']) {
            const result = (await client.request(
              {
                method: 'tools/call',
                params: {
                  name: 'fixture_1mcp_trace',
                  arguments: { notify: true },
                  _meta: { ...metadata, traceparent },
                },
              },
              ResultSchema,
            )) as { content: Array<{ text: string }> };
            expect(result).toMatchObject({ _meta: { other: 'preserved' }, structuredContent: { baggage: 'legit' } });
            expect((result as unknown as { _meta: object })._meta).not.toHaveProperty('baggage');
            expect(result).toMatchObject({
              structuredContent: {
                forwardedNotification: { _meta: { other: 'preserved', business: { baggage: 'legit-roots-data' } } },
              },
            });
            expect(
              (result as unknown as { structuredContent: { forwardedNotification: { _meta: object } } })
                .structuredContent.forwardedNotification._meta,
            ).not.toHaveProperty('baggage');
            expect(JSON.parse(result.content[0].text)).toEqual(
              traceparent === parent ? { traceparent: parent, tracestate: 'vendor=opaque' } : {},
            );
          }
          await vi.waitFor(() => expect(notifications).toHaveLength(2));
          expect(notifications).toEqual(
            Array.from({ length: 2 }, () => ({
              level: 'info',
              data: { baggage: 'legit-notification-data' },
              _meta: { other: 'preserved' },
            })),
          );
        }
      } finally {
        for (const close of cleanup.reverse()) await close();
      }
    },
  );
});
