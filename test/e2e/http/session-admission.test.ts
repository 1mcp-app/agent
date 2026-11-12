import { TestProcessManager } from '@test/e2e/utils/TestProcessManager.js';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { afterEach, describe, expect, it } from 'vitest';

async function allocatePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port allocated');
  await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
  return address.port;
}

describe.each([false, true])('Built Streamable session admission (persistence=%s)', (persistence) => {
  const processes = new TestProcessManager();
  const clients: Client[] = [];
  let directory: string;

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)));
    await processes.cleanup();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('returns 503 at the safety cap, keeps existing sessions usable, and recovers after DELETE', async () => {
    directory = await mkdtemp(join(tmpdir(), '1mcp-session-admission-'));
    const config = join(directory, 'mcp.json');
    await writeFile(config, '{"mcpServers":{}}');
    const port = await allocatePort();
    const base = `http://127.0.0.1:${port}`;
    await processes.startProcess('runtime', {
      command: process.execPath,
      args: [resolve('build/index.js'), 'serve', '--config', config, '--port', String(port), '--host', '127.0.0.1'],
      env: {
        ONE_MCP_CONFIG_DIR: directory,
        HOME: directory,
        USERPROFILE: directory,
        ONE_MCP_ENABLE_AUTH: 'false',
        ONE_MCP_ENABLE_ASYNC_LOADING: 'false',
        ONE_MCP_ENABLE_SESSION_PERSISTENCE: String(persistence),
        ONE_MCP_LOG_LEVEL: 'error',
      },
    });
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/health/ready`)).ok) break;
      } catch {
        /* The owned child has not bound the port yet. */
      }
      if (Date.now() >= deadline) throw new Error(processes.getOutputTail('runtime'));
      await new Promise((done) => setTimeout(done, 50));
    }
    const connect = async () => {
      const client = new Client({ name: 'admission-test', version: '1' });
      clients.push(client);
      const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
      await client.connect(transport);
      return { client, transport };
    };
    const existing = await connect();
    for (let index = 1; index < 1024; index++) {
      const admitted = await connect();
      // Closing the HTTP client without DELETE leaves an abandoned server session.
      await admitted.client.close();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(connect()).rejects.toMatchObject({ code: 503 });
    }
    const exhausted = await fetch(`${base}/health/ready`);
    expect(exhausted.status).toBe(503);
    expect(await exhausted.json()).toMatchObject({ status: 'not_ready', sessionAdmission: { available: false } });
    expect(await existing.client.listTools()).toMatchObject({ tools: [] });
    await existing.transport.terminateSession();
    const ready = await fetch(`${base}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: 'ready', sessionAdmission: { available: true } });
    const replacement = await connect();
    expect(await replacement.client.listTools()).toMatchObject({ tools: [] });
    await replacement.transport.terminateSession();
  }, 120_000);
});
