import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, ProtocolError, Server } from '@modelcontextprotocol/server';

import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { Client } from '@src/sdk/legacy/client/index.js';
import { StreamableHTTPClientTransport } from '@src/sdk/legacy/client/streamableHttp.js';

import { describe, expect, it } from 'vitest';

const knownUri = 'test://owned-resource';
const unknownUri = 'test://nonexistent-resource-for-conformance-testing';
const longUnknownUri = `test://${'x'.repeat(8192)}`;

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.once('exit', done);
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    force.unref();
    child.once('exit', () => clearTimeout(force));
  });
}

describe('resource misses across real gateway HTTP eras', () => {
  it('finishes cleanup after a real child already exited by signal', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    await once(child, 'spawn');
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    expect(child.exitCode).toBeNull();
    expect(child.signalCode).toBe('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        Promise.race([
          stop(child).then(() => 'stopped'),
          new Promise<string>((done) => {
            timer = setTimeout(() => done('timeout'), 500);
          }),
        ]),
      ).resolves.toBe('stopped');
    } finally {
      clearTimeout(timer);
    }
  });

  it.each([
    ['modern', false],
    ['modern', true],
    ['legacy', false],
    ['legacy', true],
  ] as const)('rejects unknown public URIs without upstream reads on %s with auth=%s', async (era, auth) => {
    const directory = await mkdtemp(join(tmpdir(), '1mcp-resource-miss-'));
    const home = join(directory, 'home');
    await mkdir(home);
    const reads: string[] = [];
    const handler = createMcpHandler(() => {
      const server = new Server({ name: 'owned-resource-fixture', version: '1' }, { capabilities: { resources: {} } });
      server.setRequestHandler('resources/list', async () => ({ resources: [{ name: 'owned', uri: knownUri }] }));
      server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
      server.setRequestHandler('resources/read', async ({ params }) => {
        reads.push(params.uri);
        if (params.uri !== knownUri) throw new ProtocolError(-32602, 'Foreign resource diagnostics');
        return { contents: [{ uri: knownUri, text: 'owned response' }] };
      });
      return server;
    });
    const upstream = createServer(toNodeHandler(handler));
    let child: ChildProcess | undefined;
    let legacy: Client | undefined;
    try {
      const upstreamOrigin = await listen(upstream);
      await writeFile(
        join(directory, 'mcp.json'),
        JSON.stringify({ mcpServers: { owned_fixture: { type: 'streamableHttp', url: `${upstreamOrigin}/mcp` } } }),
      );
      const reservation = createServer();
      const origin = await listen(reservation);
      const port = new URL(origin).port;
      await new Promise<void>((done) => reservation.close(() => done()));
      child = spawn(
        process.execPath,
        [
          resolve('build/index.js'),
          'serve',
          '--transport',
          'http',
          '--host',
          '127.0.0.1',
          '--port',
          port,
          '--config-dir',
          directory,
          '--enable-auth',
          String(auth),
          '--enable-scope-validation',
          'true',
          '--credential-store',
          'file',
          '--async-max-retries',
          '0',
          '--no-async-background-retry',
        ],
        {
          cwd: directory,
          env: { PATH: process.env.PATH, HOME: home, NODE_ENV: 'test', ONE_MCP_LOG_LEVEL: 'error' },
          stdio: ['ignore', 'ignore', 'ignore'],
        },
      );
      let ready = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null) throw new Error('Owned gateway exited before readiness');
        try {
          if ((await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })).ok) {
            ready = true;
            break;
          }
        } catch {
          // The owned listener is still starting.
        }
        await delay(100);
      }
      expect(ready).toBe(true);
      const credentials: Record<string, string> = {};
      if (auth) {
        const minted = await fetch(`${origin}/api/auth/cli-token`, { method: 'POST' });
        expect(minted.status).toBe(200);
        const grant = await minted.json();
        expect(grant.authRequired).toBe(true);
        credentials.Authorization = `Bearer ${grant.token}`;
        const admitted = await fetch(`${origin}/api/v1/inspect`, { headers: credentials });
        await admitted.body?.cancel();
        expect(admitted.status).toBe(200);
      }
      if (era === 'legacy') {
        legacy = new Client({ name: 'owned-resource-miss', version: '1' }, { capabilities: {} });
        await legacy.connect(
          new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { requestInit: { headers: credentials } }),
        );
        const catalog = await legacy.listResources();
        expect(catalog.resources).toHaveLength(1);
        expect(await legacy.readResource({ uri: catalog.resources[0].uri })).toMatchObject({
          contents: [{ text: 'owned response' }],
        });
        const before = [...reads];
        expect(before).toEqual([knownUri]);
        for (const uri of [unknownUri, longUnknownUri]) {
          await expect(legacy.readResource({ uri })).rejects.toMatchObject({
            code: -32002,
            data: { uri, 'app.1mcp/failure': { kind: 'protocol', code: 'resource_not_found' } },
          });
        }
        expect(reads).toEqual(before);
      } else {
        const request = async (method: string, params: Record<string, unknown>) => {
          const response = await fetch(`${origin}/mcp`, {
            method: 'POST',
            headers: {
              ...credentials,
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
              'MCP-Protocol-Version': '2026-07-28',
              'Mcp-Method': method,
              ...(typeof params.uri === 'string' ? { 'Mcp-Name': params.uri } : {}),
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 55,
              method,
              params: {
                ...params,
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientInfo': { name: 'owned-resource-miss', version: '1' },
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              },
            }),
          });
          expect(response.status).toBe(200);
          return response.json();
        };
        const catalog = await request('resources/list', {});
        expect(catalog.result.resources).toHaveLength(1);
        expect(await request('resources/read', { uri: catalog.result.resources[0].uri })).toMatchObject({
          result: { contents: [{ text: 'owned response' }] },
        });
        const before = [...reads];
        expect(before).toEqual([knownUri]);
        for (const uri of [unknownUri, longUnknownUri]) {
          const missing = await request('resources/read', { uri });
          expect(missing).toMatchObject({
            id: 55,
            error: {
              code: -32602,
              data: { uri, 'app.1mcp/failure': { kind: 'protocol', code: 'resource_not_found' } },
            },
          });
          expect(missing.result).toBeUndefined();
        }
        expect(reads).toEqual(before);
      }
    } finally {
      await legacy?.close();
      await stop(child);
      upstream.closeAllConnections();
      await new Promise<void>((done) => upstream.close(() => done()));
      await handler.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
