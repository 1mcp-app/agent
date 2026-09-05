import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernHttpTransport,
} from '@modelcontextprotocol/client';

import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyHttpTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { ClientStatus } from '@src/core/types/client.js';
import {
  createLegacyOutboundConnection,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { AuthProviderTransport } from '@src/sdk/legacy/client/runtime/legacyTransport.js';

import { afterEach, describe, expect, it } from 'vitest';

import { ClientFactory } from './clientFactory.js';

interface FixtureServer {
  readonly port: number;
  close(): Promise<void>;
}

let fixture: FixtureServer | undefined;

afterEach(async () => {
  await fixture?.close();
  fixture = undefined;
});

describe('real outbound era negotiation', () => {
  it('connects a pinned v2 client and routes tools/list through the modern adapter', async () => {
    // @ts-expect-error The conformance fixture is executable JavaScript without a declaration file.
    const { serveV2Http } = await import('../../../test/conformance/fixtures/typescript/src/eras/v2.mjs');
    const server: FixtureServer = await serveV2Http('streamable-http', 'modern');
    fixture = server;
    const transport = Object.assign(new ModernHttpTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)), {
      outboundProtocolVersion: '2026-07-28' as const,
    }) as never as AuthProviderTransport;
    const client = new ClientFactory().createClient(transport);
    expect(client).toBeInstanceOf(ModernClient);

    await (client as ModernClient).connect(transport as never);
    const connection = createLegacyOutboundConnection({
      name: 'modern-real',
      client,
      transport,
      status: ClientStatus.Connected,
    });

    await expect(requestLegacyOutbound<{ tools: unknown[] }>(connection, 'tools/list')).resolves.toMatchObject({
      tools: [expect.objectContaining({ name: 'fixture.acknowledge' })],
    });
    await expect(
      requestLegacyOutbound(connection, 'tools/call', {
        name: 'fixture.acknowledge',
        arguments: { value: 'modern' },
      }),
    ).resolves.toMatchObject({ content: [expect.objectContaining({ type: 'text' })] });
    await connection.adapter.close();
  });

  it('retains the real v1 streamable HTTP client when legacy is pinned', async () => {
    // @ts-expect-error The conformance fixture is executable JavaScript without a declaration file.
    const { serveV1Http } = await import('../../../test/conformance/fixtures/typescript/src/eras/v1.mjs');
    const server: FixtureServer = await serveV1Http('streamable-http');
    fixture = server;
    const transport = Object.assign(new LegacyHttpTransport(new URL(`http://127.0.0.1:${server.port}/mcp`)), {
      outboundProtocolVersion: 'legacy' as const,
    }) as AuthProviderTransport;
    const client = new ClientFactory().createClient(transport);
    expect(client).toBeInstanceOf(LegacyClient);

    await (client as LegacyClient).connect(transport);
    const connection = createLegacyOutboundConnection({
      name: 'legacy-real',
      client,
      transport,
      status: ClientStatus.Connected,
    });

    await expect(requestLegacyOutbound<{ tools: unknown[] }>(connection, 'tools/list')).resolves.toMatchObject({
      tools: [expect.objectContaining({ name: 'fixture.acknowledge' })],
    });
    await expect(
      requestLegacyOutbound(connection, 'tools/call', {
        name: 'fixture.acknowledge',
        arguments: { value: 'legacy' },
      }),
    ).resolves.toMatchObject({ content: [expect.objectContaining({ type: 'text' })] });
    await connection.adapter.close();
  });
});
