import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';

import { CONNECTION_RETRY } from '@src/constants.js';
import type { MCPServerParams } from '@src/core/types/index.js';
import { ConnectionHandler } from '@src/sdk/legacy/client/runtime/connectionHandler.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';
import { TransportRecreator } from '@src/sdk/legacy/client/runtime/transportRecreator.js';
import { createTransports } from '@src/sdk/legacy/transport/transportFactory.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClientFactory } from './clientFactory.js';

interface FixtureServer {
  readonly port: number;
  close(): Promise<void>;
}

// Test-only self-signed certificate for 127.0.0.1; it is intentionally untrusted.
const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUZJGi9HMLFggFsnXwrcM+mRAkJTgwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTExNzAwNDQwOVoYDzIxMjYxMDI0
MDA0NDA5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARB8DXMSl3d72y4QZPnFOR+2d5NRFVZhNSRO2eAKyKPifO6gqnIsSaM
HUIwf0Iv8pb70dVBcZMmu89n0L8GDepYo28wbTAdBgNVHQ4EFgQU8MwkxmdIAZMU
CU97u9hL+LdaeVgwHwYDVR0jBBgwFoAU8MwkxmdIAZMUCU97u9hL+LdaeVgwDwYD
VR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2NhbGhvc3QwCgYIKoZI
zj0EAwIDSAAwRQIgfaZd8pYlfGzLcUehwg2AjY3ewp31rTr7ITTM7tktnxoCIQDD
1vxR5CCbNYhkkikaVa+sQWZttbAahtlquDop7bWrFw==
-----END CERTIFICATE-----`;
const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgSFBG4BvtKDgtkLs1
1RCh5/zwLFgfNMawbzBWmzkAtvChRANCAARB8DXMSl3d72y4QZPnFOR+2d5NRFVZ
hNSRO2eAKyKPifO6gqnIsSaMHUIwf0Iv8pb70dVBcZMmu89n0L8GDepY
-----END PRIVATE KEY-----`;

const cleanups: Array<() => Promise<void>> = [];
const originalDelay = CONNECTION_RETRY.INITIAL_DELAY_MS;

beforeEach(() => {
  CONNECTION_RETRY.INITIAL_DELAY_MS = 20;
});

afterEach(async () => {
  CONNECTION_RETRY.INITIAL_DELAY_MS = originalDelay;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function modernBackend(): Promise<FixtureServer> {
  // @ts-expect-error The conformance fixture is executable JavaScript without a declaration file.
  const { serveV2Http } = await import('../../../test/conformance/fixtures/typescript/src/eras/v2.mjs');
  const server: FixtureServer = await serveV2Http('streamable-http', 'modern');
  cleanups.push(() => server.close());
  return server;
}

async function listen(server: http.Server, port = 0): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return (server.address() as AddressInfo).port;
}

/** Answers the first `failures` negotiation probes with `status`, then forwards everything to the backend. */
async function flakyFront(backendPort: number, status: number, failures: number) {
  const seen = { probes: 0, failed: 0, legacyInitializes: 0 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (body.includes('"method":"initialize"')) seen.legacyInitializes++;
      if (body.includes('"server/discover"')) {
        seen.probes++;
        if (seen.failed < failures) {
          seen.failed++;
          res.writeHead(status, { 'content-type': 'text/plain' }).end('try again later');
          return;
        }
      }
      const upstream = http.request(
        { host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on('error', () => res.destroy());
      upstream.end(body);
    });
  });
  return { port: await listen(server), seen };
}

function productionTransport(url: string, protocolVersion?: MCPServerParams['protocolVersion']) {
  const transports = createTransports({
    backend: { type: 'http', url, ...(protocolVersion ? { protocolVersion } : {}) } as MCPServerParams,
  });
  return transports.backend;
}

async function connect(transport: AuthProviderTransport) {
  const factory = new ClientFactory();
  const recreator = new TransportRecreator();
  const connected = await new ConnectionHandler().connectWithRetry(
    factory.createClient(transport),
    transport,
    'backend',
    undefined,
    (current) => recreator.recreateForRetry(current, 'backend', { preserveSessionId: false }),
    (current) => factory.createClient(current),
  );
  cleanups.push(() => connected.client.close());
  return connected;
}

describe('transient failures at the real negotiation boundary', () => {
  it.each([
    [408, undefined],
    [429, undefined],
    [503, undefined],
    [408, '2026-07-28'],
    [429, '2026-07-28'],
    [502, '2026-07-28'],
  ] as const)(
    'retries a probe answered with HTTP %i (protocolVersion %s) and negotiates the modern era',
    async (status, protocolVersion) => {
      const backend = await modernBackend();
      const front = await flakyFront(backend.port, status, 1);

      const { client } = await connect(productionTransport(`http://127.0.0.1:${front.port}/mcp`, protocolVersion));

      // A 408/429 must not be mistaken for legacy-era evidence: no legacy initialize is attempted.
      expect(front.seen).toEqual({ probes: 2, failed: 1, legacyInitializes: 0 });
      expect((client as { getNegotiatedProtocolVersion?: () => string }).getNegotiatedProtocolVersion?.()).toBe(
        '2026-07-28',
      );
      await expect(client.listTools()).resolves.toMatchObject({
        tools: expect.arrayContaining([expect.objectContaining({ name: 'fixture.acknowledge' })]),
      });
    },
  );

  it('connects once a backend that refused the first attempt starts listening', async () => {
    const backend = await modernBackend();
    const placeholder = http.createServer();
    const port = await listen(placeholder);
    await new Promise<void>((resolve) => placeholder.close(() => resolve()));

    const transport = productionTransport(`http://127.0.0.1:${port}/mcp`);
    const late = setTimeout(() => {
      const forwarder = http.createServer((req, res) => {
        const upstream = http.request(
          { host: '127.0.0.1', port: backend.port, path: req.url, method: req.method, headers: req.headers },
          (reply) => {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.pipe(res);
          },
        );
        req.pipe(upstream);
      });
      void listen(forwarder, port);
    }, 5);
    cleanups.push(async () => clearTimeout(late));

    const { client } = await connect(transport);
    await expect(client.listTools()).resolves.toMatchObject({ tools: expect.any(Array) });
  });

  it('ends a backend that stays unreachable as retryable after the foreground budget', async () => {
    const placeholder = http.createServer();
    const port = await listen(placeholder);
    await new Promise<void>((resolve) => placeholder.close(() => resolve()));

    const failure = await connect(productionTransport(`http://127.0.0.1:${port}/mcp`)).catch((error: unknown) => error);

    expect(failure).toMatchObject({ name: 'ClientConnectionError' });
    expect(String((failure as Error).message)).toContain('connection_refused');
    expect(String((failure as Error).message)).not.toContain('OAuth');
    expect(String((failure as Error).message)).not.toContain(String(port));
  });

  it('does not retry a backend whose certificate is rejected', async () => {
    let connections = 0;
    const server = https.createServer({ cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY }, (_req, res) => res.end());
    server.on('connection', () => connections++);
    const port = await listen(server as unknown as http.Server);

    const failure = await connect(productionTransport(`https://127.0.0.1:${port}/mcp`)).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: 'NonRetryableClientConnectionError' });
    expect(String((failure as Error).message)).toContain('tls');
    expect(connections).toBe(1);
  });

  it('keeps a backend that answers the probe with a non-transient HTTP 501 terminal', async () => {
    const backend = await modernBackend();
    const front = await flakyFront(backend.port, 501, 10);

    const failure = await connect(productionTransport(`http://127.0.0.1:${front.port}/mcp`, '2026-07-28')).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ name: 'NonRetryableClientConnectionError' });
    expect(front.seen.probes).toBe(1);
  });
});
