import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ClientStatus } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './clientManager.js';
import { requestLegacyOutbound } from './legacyOutboundConnection.js';

// ---------------------------------------------------------------------------
// Session-loss recovery against a real Streamable HTTP upstream.
//
// A backend that no longer knows the session ID we send back refuses the
// request with an HTTP 404 carrying a JSON-RPC error body. That wording is not
// standardised — the reference SDKs answer "Session not found" (Python) or
// "No valid session ID provided" (TypeScript) — and the backend this test was
// written against phrased it as:
//
//   {"jsonrpc":"2.0","error":{"code":-32000,
//    "message":"Not Found: Unknown Mcp-Session-Id header"},"id":null}
//
// ClientManager only reconnects when isSessionLostError() recognises the text
// (see SESSION_LOST_PATTERN in clientManager.ts), so a wording missing from
// that whitelist leaves the client replaying a dead session ID on every
// request until the whole process is restarted — with the connection still
// reporting itself as healthy.
//
// Everything under the assertions is real: a real HTTP server speaking the
// Streamable HTTP transport, the real SDK client transport, and the real
// ClientManager. That is deliberate — the point of this file is to answer
// "does the production path actually recover, and does it stay put when it
// should?", not "does a hand-written string match a regex?".
// ---------------------------------------------------------------------------

vi.mock('@src/logger/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  debugIf: vi.fn(),
}));

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: () => ({
      loadConfigWithTemplates: vi.fn().mockResolvedValue({ staticServers: {}, templateServers: {}, errors: [] }),
      getRuntimeInstructionConfiguration: () => ({ configuredTargets: { mcpServers: {}, mcpTemplates: {} } }),
    }),
  },
}));

vi.mock('@src/core/capabilities/capabilityPagination.js', () => ({
  registerCapabilityPaginationNotifications: vi.fn(),
}));

/** Body an upstream returns for a session ID it does not recognise. */
const UNKNOWN_SESSION_BODY = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32000, message: 'Not Found: Unknown Mcp-Session-Id header' },
  id: null,
});

/**
 * A refusal that reads as session-related but is not session loss: the request
 * never carried a session at all, which reconnecting cannot fix.
 */
const MISSING_HEADER_BODY = JSON.stringify({
  jsonrpc: '2.0',
  error: { code: -32600, message: 'Bad Request: Missing Mcp-Session-Id header' },
  id: null,
});

type RefusalMode = 'unknownSession' | 'missingHeader';

interface FakeUpstream {
  readonly url: string;
  /** Drops every issued session ID — the upstream "forgot" all sessions. */
  forgetSessions(): void;
  readonly requestLog: string[];
  close(): Promise<void>;
}

/**
 * Minimal MCP Streamable HTTP upstream. It issues a session ID on
 * `initialize` and then refuses `tools/list` according to `refuseWith`:
 *
 * - `unknownSession` (default) mirrors the production outage: the session ID
 *   we send back is no longer in its table, so it answers 404 with
 *   `Unknown Mcp-Session-Id header`.
 * - `missingHeader` answers 400 with `Missing Mcp-Session-Id header` — the
 *   superficially similar refusal that must NOT trigger a reconnect.
 */
async function startFakeUpstream(refuseWith: RefusalMode = 'unknownSession'): Promise<FakeUpstream> {
  const validSessions = new Set<string>();
  const requestLog: string[] = [];

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let message: any = {};
      try {
        message = JSON.parse(raw || '{}');
      } catch {
        /* tolerated: treated as an unparseable body */
      }
      const method: string | undefined = message?.method;
      requestLog.push(method ?? '<no-method>');

      if (method === 'initialize') {
        const issued = `sess-${Math.random().toString(16).slice(2)}`;
        validSessions.add(issued);
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': issued });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake-upstream', version: '1.0.0' },
            },
          }),
        );
        return;
      }

      if (refuseWith === 'missingHeader' && method === 'tools/list') {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(MISSING_HEADER_BODY);
        return;
      }

      const sessionId = req.headers['mcp-session-id'];
      // Only reject requests carrying a session ID it no longer recognises —
      // exactly the condition that produced the outage.
      if (typeof sessionId === 'string' && !validSessions.has(sessionId)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(UNKNOWN_SESSION_BODY);
        return;
      }

      // Notifications carry no id and expect 202 Accepted.
      if (message?.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            tools: [{ name: 'upstream_web_search', description: 'search', inputSchema: { type: 'object' } }],
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requestLog,
    forgetSessions: () => validSessions.clear(),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function makeTransport(url: string): any {
  const transport: any = new StreamableHTTPClientTransport(new URL(url));
  transport.tags = [];
  return transport;
}

describe('ClientManager session-loss recovery over a real Streamable HTTP upstream', () => {
  let cm: ClientManager;

  beforeEach(() => {
    ClientManager.resetInstance();
    cm = ClientManager.getOrCreateInstance();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await ClientManager.shutdownCurrent().catch(() => undefined);
  });

  it('reconnects with a fresh session and serves tools again after the upstream forgets the session', async () => {
    const upstream = await startFakeUpstream();
    try {
      await cm.createSingleClient('http-upstream', makeTransport(upstream.url));
      const before = cm.getClients().get('http-upstream');
      expect(before?.status).toBe(ClientStatus.Connected);
      expect(upstream.requestLog).toContain('initialize');

      // The upstream forgets the session the client is still holding.
      upstream.forgetSessions();

      // Any request now carries the dead ID and gets the 404 body.
      await requestLegacyOutbound(before!, 'tools/list').catch(() => undefined);
      await vi.waitFor(
        () => {
          expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Session for http-upstream was lost'));
        },
        { timeout: 8000 },
      );

      // Recovery must produce a working connection, not just a log line: a
      // fresh initialize must have been issued and a new client published.
      await vi.waitFor(
        () => {
          const after = cm.getClients().get('http-upstream');
          expect(after).toBeDefined();
          expect(after).not.toBe(before);
          expect(after!.status).toBe(ClientStatus.Connected);
        },
        { timeout: 8000 },
      );

      expect(upstream.requestLog.filter((m) => m === 'initialize').length).toBeGreaterThanOrEqual(2);

      // And the new connection really can talk to the upstream again.
      const after = cm.getClients().get('http-upstream')!;
      await expect(requestLegacyOutbound(after, 'tools/list')).resolves.toBeDefined();
    } finally {
      await upstream.close();
    }
  }, 30_000);

  it('does not reconnect when the upstream refuses a request for a missing session header', async () => {
    const upstream = await startFakeUpstream('missingHeader');
    try {
      await cm.createSingleClient('http-upstream', makeTransport(upstream.url));
      const before = cm.getClients().get('http-upstream');
      expect(before?.status).toBe(ClientStatus.Connected);

      await requestLegacyOutbound(before!, 'tools/list').catch(() => undefined);
      // Give the fire-and-forget recovery path every chance to misfire.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('was lost'));
      expect(upstream.requestLog.filter((m) => m === 'initialize').length).toBe(1);
      expect(cm.getClients().get('http-upstream')).toBe(before);
    } finally {
      await upstream.close();
    }
  }, 30_000);
});
