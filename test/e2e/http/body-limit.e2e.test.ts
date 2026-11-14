/**
 * E2E coverage for the configurable inbound HTTP request body limit.
 *
 * A deployment that raises the limit must accept JSON-RPC bodies beyond the
 * 100 KB parser default, and the default must stay unchanged. Both cases cross
 * the process and HTTP boundaries, so they run against the built CLI.
 */
import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { promises as fsPromises } from 'fs';
import { createServer } from 'net';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BODY_BYTES = 400_000;

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a free port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServerReady(healthUrl: string, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Server did not become ready: ${healthUrl}`);
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Connection refused while the runtime is still binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

describe('inbound HTTP request body limit', () => {
  const processManager = new TestProcessManager();
  const configBuilders: ConfigBuilder[] = [];
  let configDir: string;

  beforeEach(async () => {
    configDir = await fsPromises.mkdtemp(join(process.env.ONE_MCP_TMPDIR ?? '/tmp', '1mcp-body-limit-'));
  });

  afterEach(async () => {
    await processManager.cleanup();
    for (const builder of configBuilders.splice(0)) builder.cleanup();
    await fsPromises.rm(configDir, { recursive: true, force: true });
  });

  async function startServer(extraArgs: string[]): Promise<string> {
    const port = await getAvailablePort();
    const builder = new ConfigBuilder();
    configBuilders.push(builder);
    const configPath = builder.enableHttpTransport(port).writeToFile();

    await processManager.startProcess('1mcp-server', {
      command: 'node',
      args: [
        join(__dirname, '../../..', 'build/index.js'),
        'serve',
        '--config',
        configPath,
        '--port',
        String(port),
        ...extraArgs,
      ],
      env: {
        ONE_MCP_CONFIG_DIR: configDir,
        ONE_MCP_LOG_LEVEL: 'error',
        ONE_MCP_ENABLE_AUTH: 'false',
      },
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServerReady(`${baseUrl}/health/ready`);
    return `${baseUrl}/mcp`;
  }

  function payload(): string {
    return JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'unregistered-tool', arguments: { blob: 'x'.repeat(BODY_BYTES) } },
    });
  }

  async function openSession(url: string): Promise<string | null> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } },
      }),
    });
    await response.text();
    expect(response.status).toBe(200);
    return response.headers.get('mcp-session-id');
  }

  async function postBody(url: string, sessionId: string | null): Promise<number> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const response = await fetch(url, { method: 'POST', headers, body: payload() });
    await response.text();
    return response.status;
  }

  it('accepts a body larger than the parser default when the limit is raised', async () => {
    const url = await startServer(['--http-body-limit', '25mb']);
    const sessionId = await openSession(url);

    expect(await postBody(url, sessionId)).toBe(200);
  }, 60_000);

  it('rejects the same body when the default limit applies', async () => {
    const url = await startServer([]);
    const sessionId = await openSession(url);

    expect(await postBody(url, sessionId)).toBeGreaterThanOrEqual(400);
  }, 60_000);
});
