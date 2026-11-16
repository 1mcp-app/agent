import { CommandTestEnvironment, McpTestClient, TestProcessManager } from '@test/e2e/utils/index.js';

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
  let environment: CommandTestEnvironment;
  let client: McpTestClient | undefined;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'body-limit',
      createConfigFile: true,
      mockMcpServers: [
        {
          name: 'echo',
          command: 'node',
          args: [join(process.cwd(), 'test/e2e/fixtures/echo-server.js')],
          tags: ['http', 'e2e'],
          type: 'stdio',
        },
      ],
    });
    await environment.setup();
    client = undefined;
  });

  afterEach(async () => {
    await client?.disconnect();
    client = undefined;
    await processManager.cleanup();
    await environment.cleanup();
  });

  async function startServer(extraArgs: string[]): Promise<string> {
    const port = await getAvailablePort();
    await processManager.startProcess('1mcp-server', {
      command: 'node',
      args: [
        'build/index.js',
        'serve',
        '--transport',
        'http',
        '--port',
        String(port),
        '--config',
        environment.getConfigPath(),
        '--config-dir',
        environment.getConfigDir(),
        '--no-enable-config-reload',
        '--log-level',
        'error',
        ...extraArgs,
      ],
      cwd: process.cwd(),
      env: environment.getEnvironmentVariables(),
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServerReady(`${baseUrl}/health/ready`);
    return `${baseUrl}/mcp`;
  }

  async function openSession(url: string): Promise<string> {
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
    const sessionId = response.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    return sessionId as string;
  }

  async function postOversizedBody(url: string, sessionId: string): Promise<{ status: number; error: string }> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'unregistered-tool', arguments: { blob: 'x'.repeat(BODY_BYTES) } },
      }),
    });
    const body = (await response.json()) as { error?: { message?: string } };
    return { status: response.status, error: body.error?.message ?? '' };
  }

  it('carries a body over the parser default through the SDK protocol journey when the limit is raised', async () => {
    const url = await startServer(['--http-body-limit', '25mb']);

    client = new McpTestClient({
      transport: 'streamable-http',
      streamableHttpConfig: { url },
    });
    await client.connect();

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('echo_1mcp_echo');

    const blob = 'x'.repeat(BODY_BYTES);
    const result = await client.callTool('echo_1mcp_echo', { message: blob });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining(blob) })]),
    );
  }, 60_000);

  it('rejects an oversized raw body on an initialized session when the default limit applies', async () => {
    const url = await startServer([]);
    const sessionId = await openSession(url);

    const rejection = await postOversizedBody(url, sessionId);
    expect(rejection.status).toBe(500);
    expect(rejection.error).toBe('Internal server error');
  }, 60_000);
});
