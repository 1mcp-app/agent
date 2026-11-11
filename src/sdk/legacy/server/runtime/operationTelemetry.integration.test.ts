import { PassThrough } from 'node:stream';

import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import { StdioServerTransport } from '@src/sdk/legacy/server/stdio.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';
import { CallToolRequestSchema, JSONRPCMessageSchema } from '@src/sdk/legacy/types.js';

import { expect, it, vi } from 'vitest';

import { LegacySdkServerAdapter } from './legacySdkServerAdapter.js';

const facts = vi.hoisted(() => ({ begin: vi.fn((..._args: unknown[]) => ({ finish: vi.fn() })) }));
vi.mock('@src/productTelemetry/index.js', () => ({ beginProductOperation: facts.begin }));

it('counts real stdio SDK initialization and tool outcomes once without exporting payload fields', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const serverTransport = new StdioServerTransport(input, output);
  const server = new Server({ name: 'runtime', version: '1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(CallToolRequestSchema, async (request) => ({
    content: [{ type: 'text', text: 'private-result' }],
    ...(request.params.name === 'fail' ? { isError: true } : {}),
  }));
  const adapter = new LegacySdkServerAdapter('stdio-owner' as LegacyConnectionId, server, serverTransport);
  let pending = '';
  const clientTransport: Transport = {
    async start() {
      output.on('data', (chunk) => {
        pending += chunk.toString();
        let end: number;
        while ((end = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (line) clientTransport.onmessage?.(JSONRPCMessageSchema.parse(JSON.parse(line)));
        }
      });
    },
    async send(message) {
      input.write(JSON.stringify(message) + '\n');
    },
    async close() {
      input.end();
      output.end();
      clientTransport.onclose?.();
    },
  };
  const client = new Client({ name: 'codex', version: 'private-version' });
  try {
    await adapter.start();
    await client.connect(clientTransport);
    await expect(
      client.callTool({ name: 'private-success', arguments: { secret: 'never-export' } }),
    ).resolves.toMatchObject({ content: [{ text: 'private-result' }] });
    await expect(client.callTool({ name: 'fail' })).resolves.toMatchObject({ isError: true });
    expect(facts.begin.mock.calls).toEqual([
      ['initialize', 'stdio', 'codex'],
      ['tools_call', 'stdio', 'codex'],
      ['tools_call', 'stdio', 'codex'],
    ]);
    expect(facts.begin.mock.results.map((result) => result.value.finish.mock.calls)).toEqual([
      [['success']],
      [['success']],
      [['failure']],
    ]);
  } finally {
    await client.close();
    await adapter.close();
  }
});
