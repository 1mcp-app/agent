import { createServer } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { startHttpWireTap } from './httpWireTap.js';
import { createSanitizedWireCapture } from './sanitizedWireEvidence.js';

describe('retained legacy SDK HTTP error envelopes', () => {
  it.each([
    { jsonrpc: '2.0', id: 43, error: { code: 'invalid', message: 'malformed' } },
    { jsonrpc: '2.0', id: null, result: {} },
    { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'rejected' } },
  ])('keeps malformed negotiated responses invalid: %j', (envelope) => {
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'negotiated-legacy-upstream', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: (value) => JSONRPCMessageSchema.safeParse(value).success,
    });
    expect(
      capture.observe({
        contextId: 'negotiated-legacy-upstream',
        hop: 'upstream',
        direction: 'peer_to_gateway',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(envelope)),
      }).schemaResult,
    ).toBe('invalid');
  });

  it('correlates discovery rejection and retains its invalid verdict after successful legacy calls', async () => {
    const closeTasks: Array<() => Promise<void>> = [];
    const peer = createServer((request, response) => {
      const server = new McpServer({ name: 'legacy-envelope-peer', version: '1.0.0' });
      server.registerTool('acknowledge', { inputSchema: { marker: z.string() } }, async () => ({
        content: [{ type: 'text', text: 'acknowledged' }],
      }));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      closeTasks.push(() => server.close());
      void server.connect(transport).then(() => transport.handleRequest(request, response));
    });
    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    const address = peer.address();
    if (!address || typeof address === 'string') throw new Error('Test peer did not bind');

    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'legacy-envelope-upstream', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: (envelope) => JSONRPCMessageSchema.safeParse(envelope).success,
    });
    // Synthetic IDs are inspected only in this test; persisted evidence remains value-free.
    const observed: Array<{
      direction: string;
      headers: Record<string, string | string[] | undefined>;
      envelope: Record<string, unknown>;
    }> = [];
    const tap = await startHttpWireTap({
      target: `http://127.0.0.1:${address.port}`,
      contextId: 'legacy-envelope-upstream',
      hop: 'upstream',
      capture: {
        snapshot: () => capture.snapshot(),
        observe(observation) {
          observed.push({
            direction: observation.direction,
            headers: observation.headers,
            envelope: JSON.parse(Buffer.from(observation.body).toString('utf8')) as Record<string, unknown>,
          });
          return capture.observe(observation);
        },
      },
    });

    async function send(id: number, method: string, params: Record<string, unknown>, revision: string) {
      const response = await fetch(`${tap.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': revision,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      return { status: response.status, envelope: await response.json() };
    }

    try {
      const discovery = await send(
        41,
        'server/discover',
        { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
        '2026-07-28',
      );
      expect(discovery).toMatchObject({ status: 400, envelope: { jsonrpc: '2.0', id: null, error: { code: -32000 } } });
      expect(discovery.envelope.error.message).toContain('Unsupported protocol version: 2026-07-28');
      expect(discovery.envelope).not.toHaveProperty('result');
      expect(observed.slice(0, 2)).toEqual([
        {
          direction: 'gateway_to_peer',
          headers: expect.objectContaining({
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
          }),
          envelope: {
            jsonrpc: '2.0',
            id: 41,
            method: 'server/discover',
            params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
          },
        },
        {
          direction: 'peer_to_gateway',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
          envelope: discovery.envelope,
        },
      ]);

      const initialized = await send(
        42,
        'initialize',
        {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'legacy-envelope-client', version: '1.0.0' },
        },
        '2025-11-25',
      );
      expect(initialized).toMatchObject({
        status: 200,
        envelope: { id: 42, result: { protocolVersion: '2025-11-25' } },
      });
      const call = await send(
        43,
        'tools/call',
        { name: 'acknowledge', arguments: { marker: 'synthetic' } },
        '2025-11-25',
      );
      expect(call).toMatchObject({
        status: 200,
        envelope: { id: 43, result: { content: [{ type: 'text', text: 'acknowledged' }] } },
      });

      const records = capture.snapshot().records;
      expect(records.map((record) => record.schemaResult)).toEqual([
        'valid',
        'invalid',
        'valid',
        'valid',
        'valid',
        'valid',
      ]);
      expect(records.every((record) => record.contextId === 'legacy-envelope-upstream')).toBe(true);
      expect(records[1]).toMatchObject({ correlation: 'error', direction: 'peer_to_gateway', schemaResult: 'invalid' });
      expect(JSONRPCMessageSchema.safeParse({ ...discovery.envelope, id: 41 }).success).toBe(true);
      expect(
        JSONRPCMessageSchema.safeParse({ jsonrpc: '2.0', id: 43, error: { code: 'invalid', message: 'malformed' } })
          .success,
      ).toBe(false);
      expect(JSONRPCMessageSchema.safeParse({ jsonrpc: '2.0', id: null, result: {} }).success).toBe(false);
    } finally {
      await tap.close();
      await Promise.all(closeTasks.map((close) => close()));
      await new Promise<void>((resolve, reject) => peer.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
