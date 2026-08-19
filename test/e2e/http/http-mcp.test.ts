import { CommandTestEnvironment, McpTestClient, TestProcessManager } from '@test/e2e/utils/index.js';

import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const supportsLoopbackListen = await canBindLoopback();
const describeHttpE2E = supportsLoopbackListen ? describe : describe.skip;

describeHttpE2E('Streamable HTTP MCP protocol E2E', () => {
  let environment: CommandTestEnvironment;
  let processManager: TestProcessManager;
  let client: McpTestClient | undefined;

  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'http-mcp-protocol',
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
    processManager = new TestProcessManager();
  });

  afterEach(async () => {
    await client?.disconnect();
    await processManager.cleanup();
    await environment.cleanup();
  });

  it('connects with the SDK and completes tool and resource requests', async () => {
    const port = await getAvailablePort();
    await processManager.startProcess('1mcp-http', {
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
      ],
      cwd: process.cwd(),
      env: environment.getEnvironmentVariables(),
    });
    await waitForReady(`http://127.0.0.1:${port}/health/ready`);

    client = new McpTestClient({
      transport: 'streamable-http',
      streamableHttpConfig: { url: `http://127.0.0.1:${port}/mcp` },
    });
    await client.connect();

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('echo_1mcp_echo');

    const result = await client.callTool('echo_1mcp_echo', { message: 'over http', data: { verified: true } });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('over http') })]),
    );

    const resources = await client.listResources();
    expect(resources.resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ uri: 'echo_1mcp_echo://test', name: 'Echo Test Resource' })]),
    );
  });
});

async function waitForReady(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = 'server did not respond';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function canBindLoopback(): Promise<boolean> {
  return await new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an available port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
