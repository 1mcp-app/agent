import { Client, SSEClientTransport, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { SSEServerTransport } from '@modelcontextprotocol/server-legacy/sse';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

import { createServer as createHttpServer } from 'node:http';

import { TOOL_NAME, TOOL_RESULT_SENTINEL } from '../constants.mjs';

const legacyProtocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'];

export function createV2Server(protocolEra) {
  const supportedProtocolVersions =
    protocolEra === 'modern'
      ? ['2026-07-28']
      : protocolEra === 'legacy'
        ? legacyProtocolVersions
        : ['2026-07-28', ...legacyProtocolVersions];
  const server = new McpServer(
    { name: '1mcp-conformance-v2', version: '2.0.0' },
    {
      supportedProtocolVersions,
    },
  );
  server.registerTool(TOOL_NAME, { description: 'Acknowledges a synthetic conformance request.' }, async () => ({
    content: [{ type: 'text', text: TOOL_RESULT_SENTINEL }],
  }));
  return server;
}

export async function serveV2Stdio(protocolEra) {
  const handle = serveStdio(() => createV2Server(protocolEra), {
    legacy: protocolEra === 'modern' ? 'reject' : 'serve',
  });
  return () => handle.close();
}

function failHttp(res) {
  if (res.writableEnded) return;
  if (!res.headersSent) {
    res.writeHead(500, { 'content-type': 'application/json' });
  }
  res.end('{"error":"fixture_transport_error"}');
}

export async function serveV2Http(transportName, protocolEra) {
  const closeables = new Set();
  const sessions = new Map();
  let requestHandler;

  if (transportName === 'streamable-http') {
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();
    const handler = createMcpHandler(() => createV2Server(protocolEra));
    const nodeHandler = toNodeHandler(handler);
    closeables.add(handler);
    requestHandler = async (req, res) => {
      if (!validateHost(req, res) || !validateOrigin(req, res)) return;
      if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      await nodeHandler(req, res);
    };
  } else {
    requestHandler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/sse') {
        const server = createV2Server(protocolEra);
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

export function createV2ClientTransport(transportName, options) {
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

export function createV2Client(protocolEra, capabilities) {
  return new Client(
    { name: '1mcp-conformance-client-v2', version: '2.0.0' },
    {
      ...(capabilities ? { capabilities } : {}),
      versionNegotiation: {
        mode: protocolEra === 'modern' ? { pin: '2026-07-28' } : 'legacy',
      },
    },
  );
}
