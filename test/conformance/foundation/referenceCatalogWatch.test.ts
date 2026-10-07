import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { StringDecoder } from 'node:string_decoder';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { startOfficialReferenceServer } from '../official/referenceServer.js';
import { startOfficialGateway } from './foundationRun.js';

/** Observe owned synthetic names/events while forwarding request and response bytes unchanged. */
async function observeOwnedPeer(endpoint: string) {
  const target = new URL(endpoint);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('Expected owned loopback');
  const calls: string[] = [];
  const notifications: Array<{ method: string; subscriptionId?: unknown; filter?: unknown }> = [];
  const sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.once('end', () => {
      if (!chunks.length) return;
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.method === 'tools/call') calls.push(request.params.name);
    });
    const forwarded = httpRequest(
      target,
      { method: incoming.method, headers: { ...incoming.headers, host: target.host } },
      (response) => {
        if (String(response.headers['content-type']).includes('text/event-stream')) {
          const decoder = new StringDecoder('utf8');
          let pending = '';
          response.on('data', (chunk: Buffer) => {
            pending += decoder.write(chunk);
            let separator: RegExpExecArray | null;
            while ((separator = /\r?\n\r?\n/u.exec(pending))) {
              const frame = pending.slice(0, separator.index);
              pending = pending.slice(separator.index + separator[0].length);
              const data = frame
                .split(/\r?\n/u)
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).replace(/^ /u, ''))
                .join('\n');
              if (!data) continue;
              const notification = JSON.parse(data);
              if (typeof notification.method === 'string') {
                notifications.push({
                  method: notification.method,
                  subscriptionId: notification.params?._meta?.['io.modelcontextprotocol/subscriptionId'],
                  filter: notification.params?.notifications,
                });
              }
            }
            if (pending.length > 65_536) outgoing.destroy(new Error('Owned event frame exceeded test bound'));
          });
        }
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on('error', () => outgoing.destroy());
    outgoing.once('close', () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned observer listener');
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    notifications,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      }),
  };
}

it('discovers both real stateless mutation hooks and forwards one dispatch and catalog event per kind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reference-catalog-watch-'));
  const cleanup: Array<() => Promise<unknown>> = [() => rm(directory, { recursive: true, force: true })];
  try {
    const reference = await startOfficialReferenceServer(process.cwd(), directory);
    cleanup.push(reference.close);
    const source = new Client(
      { name: 'owned-hook-discovery', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    try {
      await source.connect(new StreamableHTTPClientTransport(new URL(reference.endpoint)));
      const catalog = await source.listTools();
      for (const name of ['test_trigger_tool_change', 'test_trigger_prompt_change']) {
        const matches = catalog.tools.filter((tool) => tool.name === name);
        expect(matches).toHaveLength(1);
        expect(matches[0].inputSchema).toEqual({ type: 'object', properties: {} });
      }
    } finally {
      await source.close();
    }
    const upstream = await observeOwnedPeer(reference.endpoint);
    cleanup.push(upstream.close);
    const gateway = await startOfficialGateway(process.cwd(), directory, upstream.endpoint, '2026-07-28');
    cleanup.push(gateway.close);
    expect(gateway.accessToken).toBeDefined();
    const inbound = await observeOwnedPeer(gateway.endpoint);
    cleanup.push(inbound.close);
    const client = new Client(
      { name: 'owned-gateway-watch', version: '1' },
      { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    cleanup.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(inbound.endpoint), {
        requestInit: { headers: { Authorization: `Bearer ${gateway.accessToken}` } },
      }),
    );
    const toolsChanged = vi.fn();
    const promptsChanged = vi.fn();
    client.setNotificationHandler('notifications/tools/list_changed', toolsChanged);
    client.setNotificationHandler('notifications/prompts/list_changed', promptsChanged);
    const catalog = await client.listTools();
    const subscription = await client.listen({ toolsListChanged: true, promptsListChanged: true }, { timeout: 5_000 });
    cleanup.push(() => subscription.close());
    expect(subscription.honoredFilter).toEqual({ toolsListChanged: true, promptsListChanged: true });
    for (const [name, method, callback] of [
      ['test_trigger_tool_change', 'notifications/tools/list_changed', toolsChanged],
      ['test_trigger_prompt_change', 'notifications/prompts/list_changed', promptsChanged],
    ] as const) {
      const matches = catalog.tools.filter((tool) => {
        const route = z.object({
          kind: z.literal('tools'),
          server: z.literal('official_conformance'),
          upstreamIdentity: z.literal(name),
        });
        return route.safeParse(tool._meta?.['app.1mcp/route']).success;
      });
      expect(matches).toHaveLength(1);
      const publicName = matches[0].name;
      expect(await client.callTool({ name: publicName, arguments: {} })).toMatchObject({
        content: [{ type: 'text', text: 'Mutation triggered' }],
      });
      await expect.poll(() => callback.mock.calls.length).toBe(1);
      expect(upstream.calls.filter((call) => call === name)).toHaveLength(1);
      expect(inbound.calls.filter((call) => call === publicName)).toHaveLength(1);
      const upstreamNotes = upstream.notifications.filter((notification) => notification.method === method);
      const inboundNotes = inbound.notifications.filter((notification) => notification.method === method);
      expect(upstreamNotes).toHaveLength(1);
      expect(inboundNotes).toHaveLength(1);
      for (const [observer, notification] of [
        [upstream, upstreamNotes[0]],
        [inbound, inboundNotes[0]],
      ] as const) {
        expect(notification.subscriptionId).toEqual(expect.any(String));
        const acknowledgement = observer.notifications.find(
          (note) =>
            note.method === 'notifications/subscriptions/acknowledged' &&
            note.subscriptionId === notification.subscriptionId,
        );
        expect(acknowledgement?.filter).toMatchObject({ toolsListChanged: true, promptsListChanged: true });
      }
      expect(callback.mock.calls[0][0]).toMatchObject({
        method,
        params: { _meta: { 'io.modelcontextprotocol/subscriptionId': inboundNotes[0].subscriptionId } },
      });
    }
    expect(toolsChanged).toHaveBeenCalledTimes(1);
    expect(promptsChanged).toHaveBeenCalledTimes(1);
    expect(upstream.calls).toHaveLength(2);
    expect(inbound.calls).toHaveLength(2);
    await subscription.close();
    await subscription.closed;
  } finally {
    const errors: unknown[] = [];
    for (const close of cleanup.reverse()) {
      try {
        await close();
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors).toEqual([]);
  }
}, 30_000);
