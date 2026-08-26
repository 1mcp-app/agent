import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startHttpWireTap } from './httpWireTap.js';
import { createSanitizedWireCapture, writeEvidence } from './sanitizedWireEvidence.js';

describe('HTTP wire tap', () => {
  const closeTasks: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.allSettled(
      closeTasks
        .splice(0)
        .reverse()
        .map((close) => close()),
    );
  });

  it('captures distinct inbound and upstream facts while forwarding SSE incrementally', async () => {
    const secret = 'wire!Secret-._~42';
    const peer = createServer((req, res) => {
      req.resume();
      req.once('end', () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-secret': secret });
        res.write(`event: response\ndata: {"jsonrpc":"2.0","id":"${secret}","result":{"token":"${secret}"}}\n\n`);
        setTimeout(() => res.end('event: done\ndata: {}\n\n'), 35);
      });
    });
    await new Promise<void>((resolve) => peer.listen(0, '127.0.0.1', resolve));
    closeTasks.push(
      () => new Promise<void>((resolve, reject) => peer.close((error) => (error ? reject(error) : resolve()))),
    );
    const peerAddress = peer.address();
    if (!peerAddress || typeof peerAddress === 'string') throw new Error('Test peer did not bind');

    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-loopback', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: (value) => value.jsonrpc === '2.0',
    });
    const upstream = await startHttpWireTap({
      target: `http://127.0.0.1:${peerAddress.port}`,
      capture,
      contextId: 'case-loopback',
      hop: 'upstream',
    });
    closeTasks.push(upstream.close);

    const gateway = createServer((clientRequest, clientResponse) => {
      const proxied = request(
        `${upstream.url}${clientRequest.url ?? '/'}`,
        { method: clientRequest.method, headers: clientRequest.headers },
        (proxiedResponse) => {
          clientResponse.writeHead(proxiedResponse.statusCode ?? 502, proxiedResponse.headers);
          proxiedResponse.pipe(clientResponse);
        },
      );
      clientRequest.pipe(proxied);
    });
    await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve));
    closeTasks.push(
      () => new Promise<void>((resolve, reject) => gateway.close((error) => (error ? reject(error) : resolve()))),
    );
    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === 'string') throw new Error('Test gateway did not bind');

    const inbound = await startHttpWireTap({
      target: `http://127.0.0.1:${gatewayAddress.port}`,
      capture,
      contextId: 'case-loopback',
      hop: 'inbound',
    });
    closeTasks.push(inbound.close);

    let firstChunkAt = 0;
    let completedAt = 0;
    const responseText = await new Promise<string>((resolve, reject) => {
      const client = request(
        `${inbound.url}/mcp?userPath=${encodeURIComponent(`/Users/person/${secret}`)}`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${secret}`,
            cookie: `session=${secret}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            if (!firstChunkAt) firstChunkAt = Date.now();
            chunks.push(chunk);
          });
          response.once('end', () => {
            completedAt = Date.now();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
        },
      );
      client.once('error', reject);
      client.end(JSON.stringify({ jsonrpc: '2.0', id: secret, method: 'tools/call', params: { token: secret } }));
    });

    expect(responseText).toContain(secret);
    expect(completedAt - firstChunkAt).toBeGreaterThanOrEqual(20);

    const evidence = capture.snapshot();
    expect(evidence.records.map(({ hop, direction }) => `${hop}:${direction}`)).toEqual([
      'inbound:client_to_gateway',
      'upstream:gateway_to_peer',
      'upstream:peer_to_gateway',
      'inbound:gateway_to_client',
    ]);
    expect(evidence.records[0].method).toBe('tools_call');
    expect(evidence.records[2]).toMatchObject({ contentKind: 'sse', schemaResult: 'not_applicable' });

    const directory = await mkdtemp(join(tmpdir(), 'wire-evidence-'));
    const evidencePath = join(directory, 'evidence.json');
    await writeEvidence(evidencePath, evidence);
    const persisted = await readFile(evidencePath, 'utf8');
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain('/Users/person');

    await inbound.close();
    await upstream.close();
    await expect(fetch(inbound.url)).rejects.toThrow();
    await expect(fetch(upstream.url)).rejects.toThrow();
  });

  it('emits only generic forwarding failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-failure', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    const tap = await startHttpWireTap({
      target: 'http://127.0.0.1:1/private/AlphaSecret',
      capture,
      contextId: 'case-failure',
      hop: 'inbound',
    });
    closeTasks.push(tap.close);
    const response = await fetch(tap.url, { method: 'POST', body: 'AlphaSecret' });
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('wire tap forwarding failure');
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('AlphaSecret');
    errorSpy.mockRestore();
  });
});
