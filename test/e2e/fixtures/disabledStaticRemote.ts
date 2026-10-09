import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Server } from '@src/sdk/legacy/server/index.js';
import { SSEServerTransport } from '@src/sdk/legacy/server/sse.js';
import { StreamableHTTPServerTransport } from '@src/sdk/legacy/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@src/sdk/legacy/types.js';

import express from 'express';

/**
 * Start an independently hosted backend and expose its active stream count.
 * Gateway unload must close those streams while the health listener stays alive.
 */
export async function startDisabledStaticRemote(type: 'http' | 'sse') {
  const app = express();
  app.use(express.json());
  const peers: Server[] = [];
  const sessions = new Map<string, SSEServerTransport | StreamableHTTPServerTransport>();
  let activeStreams = 0;
  const createPeer = () => {
    const peer = new Server({ name: 'remote-fixture', version: '1' }, { capabilities: { tools: {} } });
    peer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'identity', inputSchema: { type: 'object' } }],
    }));
    peer.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'remote-alive' }] }));
    peers.push(peer);
    return peer;
  };
  app.get('/health', (_req, res) => res.send('alive'));
  app.all('/mcp', async (req, res) => {
    if (req.method === 'GET') {
      activeStreams++;
      res.once('close', () => activeStreams--);
    }
    if (type === 'sse') {
      if (req.method === 'GET') {
        const transport = new SSEServerTransport('/mcp', res);
        sessions.set(transport.sessionId, transport);
        await createPeer().connect(transport);
        return;
      }
      const transport = sessions.get(String(req.query.sessionId));
      if (transport instanceof SSEServerTransport) {
        await transport.handlePostMessage(req, res, req.body);
        return;
      }
      res.sendStatus(404);
      return;
    }
    const sessionId = req.headers['mcp-session-id'];
    const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (existing instanceof StreamableHTTPServerTransport) {
      await existing.handleRequest(req, res, req.body);
      return;
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: (id): void => {
        sessions.set(id, transport);
      },
    });
    await createPeer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  const listener = createServer(app);
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
  return {
    url: `${origin}/mcp`,
    health: `${origin}/health`,
    activeStreams: () => activeStreams,
    async close() {
      await Promise.all(peers.map((peer) => peer.close()));
      listener.closeAllConnections();
      await new Promise<void>((resolve, reject) => listener.close((error) => (error ? reject(error) : resolve())));
    },
  };
}
