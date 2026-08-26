import { createServer as createHttpServer } from 'node:http';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { TOOL_NAME, TOOL_RESULT_SENTINEL } from '../constants.mjs';

export function createV1Server() {
  const server = new McpServer({ name: '1mcp-conformance-v1', version: '1.0.0' });
  server.registerTool(TOOL_NAME, { description: 'Acknowledges a synthetic conformance request.' }, async () => ({
    content: [{ type: 'text', text: TOOL_RESULT_SENTINEL }],
  }));
  return server;
}

export async function serveV1Stdio() {
  const server = createV1Server();
  await server.connect(new StdioServerTransport());
  return () => server.close();
}

function failHttp(res) {
  if (res.writableEnded) return;
  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'application/json' });
  }
  res.end('{"error":"fixture_transport_error"}');
}

export async function serveV1Http(transportName) {
  const closeables = new Set();
  const sessions = new Map();
  let requestHandler;

  if (transportName === 'streamable-http') {
    requestHandler = async (req, res) => {
      if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      const server = createV1Server();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      closeables.add(server);
      res.once('close', () => {
        closeables.delete(server);
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    };
  } else {
    requestHandler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/sse') {
        const server = createV1Server();
        const transport = new SSEServerTransport('/message', res);
        sessions.set(transport.sessionId, transport);
        closeables.add(server);
        transport.onclose = () => {
          sessions.delete(transport.sessionId);
          closeables.delete(server);
        };
        await server.connect(transport);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/message') {
        const transport = sessions.get(url.searchParams.get('sessionId'));
        if (!transport) {
          res.writeHead(404).end();
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }
      res.writeHead(404).end();
    };
  }

  const httpServer = createHttpServer((req, res) => void requestHandler(req, res).catch(() => failHttp(res)));
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('HTTP_LISTEN_FAILED');

  return {
    port: address.port,
    async close() {
      for (const closeable of closeables) await closeable.close();
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export function createV1ClientTransport(transportName, options) {
  if (transportName === 'stdio') {
    return new StdioClientTransport({
      command: options.command,
      args: options.args,
      stderr: 'pipe',
    });
  }
  if (transportName === 'sse') return new SSEClientTransport(new URL(options.endpoint));
  return new StreamableHTTPClientTransport(new URL(options.endpoint));
}

export function createV1Client() {
  return new Client({ name: '1mcp-conformance-client-v1', version: '1.0.0' });
}
