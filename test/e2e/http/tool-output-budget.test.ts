import { CommandTestEnvironment, McpTestClient, TestProcessManager } from '@test/e2e/utils/index.js';

import { createServer } from 'node:net';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const supportsLoopbackListen = await canBindLoopback();
const describeHttpE2E = supportsLoopbackListen ? describe : describe.skip;

describeHttpE2E('tool output byte budget across built HTTP runtime', () => {
  let environment: CommandTestEnvironment;
  let processManager: TestProcessManager;
  let client: McpTestClient | undefined;
  beforeEach(async () => {
    environment = new CommandTestEnvironment({
      name: 'tool-output-budget',
      createConfigFile: true,
      mockMcpServers: [
        {
          name: 'blob',
          command: process.execPath,
          args: [join(process.cwd(), 'test/e2e/fixtures/large-tool-result-server.js')],
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
  it.each([false, true])('delivers accepted output and recognizable overflow with lazy=%s', async (lazy) => {
    const port = await getAvailablePort();
    await processManager.startProcess('runtime', {
      command: process.execPath,
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
        ...(lazy ? ['--enable-lazy-loading'] : []),
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
    const invoke = (bytes: number) =>
      lazy
        ? client!.callTool('tool_invoke', { server: 'blob', toolName: 'read_file', args: { bytes } })
        : client!.callTool('blob_1mcp_read_file', { bytes });
    const bytes = lazy ? 600_000 : 1_000_000;
    const result = await invoke(bytes);
    expect(result.isError).not.toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized.length).toBeGreaterThan(1_000_000);
    expect(serialized).toContain(Buffer.alloc(bytes, 7).toString('base64'));
    if (lazy) {
      expect(result.content).toHaveLength(1);
      expect(result.structuredContent).toHaveProperty('result');
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    }
    await expect(invoke(lazy ? 1_700_000 : 3_200_000)).rejects.toThrow('schema_budget_exceeded');
    if (!lazy) {
      const rest = (bytes: number) =>
        fetch(`http://127.0.0.1:${port}/api/v1/tool-invocations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tool: 'blob/read_file', args: { bytes } }),
        });
      const accepted = await rest(1_000_000);
      expect(accepted.ok).toBe(true);
      expect(await accepted.json()).toHaveProperty('result.content');
      const oversized = await rest(3_200_000);
      expect(oversized.ok).toBe(false);
      expect(await oversized.json()).toMatchObject({
        'app.1mcp/failure': { code: 'schema_budget_exceeded' },
      });
    }
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
