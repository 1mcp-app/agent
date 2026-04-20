import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigBuilder } from '../utils/ConfigBuilder.js';
import { SimpleMcpClient } from '../utils/SimpleMcpClient.js';

/**
 * Regression test for https://github.com/1mcp-app/agent/issues/255
 *
 * Bug: When an inbound client connects to 1MCP and sends notifications/initialized,
 * 1MCP was forwarding that notification to already-connected downstream servers.
 * This caused downstream servers to re-enter initialization state, making subsequent
 * tools/list and prompts/list requests fail with:
 *   "method tools/list is invalid during session initialization"
 */
describe('notifications/initialized must not be forwarded to downstream servers (issue #255)', () => {
  let configBuilder: ConfigBuilder;
  let configPath: string;
  let client: SimpleMcpClient;

  const mockServerPath = join(__dirname, '../utils/mock-mcp-server-fast.js');
  const cliPath = join(process.cwd(), 'build', 'index.js');

  beforeEach(() => {
    configBuilder = new ConfigBuilder();
    configPath = configBuilder
      .addStdioServer('downstream-server', 'node', [mockServerPath, 'downstream-server'], ['test'])
      .writeToFile();
  });

  afterEach(async () => {
    await client?.disconnect();
    configBuilder.cleanup();
  });

  it('should successfully list tools after full MCP handshake including notifications/initialized', async () => {
    client = new SimpleMcpClient({
      transport: 'stdio',
      stdioConfig: {
        command: 'node',
        args: [cliPath, '--transport', 'stdio', '--config', configPath],
        env: { ONE_MCP_LOG_LEVEL: 'error' },
      },
    });

    // Step 1: initialize (1MCP connects to downstream at startup)
    await client.initialize();

    // Step 2: send notifications/initialized — this is the trigger for the bug.
    // Before the fix, 1MCP would forward this to the downstream server, causing it
    // to re-enter initialization state and reject the next tools/list call.
    client.notify('notifications/initialized');

    // Give 1MCP a moment to process the notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Step 3: tools/list must succeed — not fail with "method is invalid during session initialization"
    const toolsResult = await client.listTools();
    expect(toolsResult).toBeDefined();
    expect(Array.isArray(toolsResult.tools)).toBe(true);
    expect(toolsResult.tools.length).toBeGreaterThan(0);
  });

  it('should handle multiple sequential client sessions without downstream disruption', async () => {
    // First client session
    const client1 = new SimpleMcpClient({
      transport: 'stdio',
      stdioConfig: {
        command: 'node',
        args: [cliPath, '--transport', 'stdio', '--config', configPath],
        env: { ONE_MCP_LOG_LEVEL: 'error' },
      },
    });

    try {
      await client1.initialize();
      client1.notify('notifications/initialized');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const tools1 = await client1.listTools();
      expect(tools1.tools.length).toBeGreaterThan(0);
    } finally {
      await client1.disconnect();
    }

    // Second client session — downstream server must still be functional
    const client2 = new SimpleMcpClient({
      transport: 'stdio',
      stdioConfig: {
        command: 'node',
        args: [cliPath, '--transport', 'stdio', '--config', configPath],
        env: { ONE_MCP_LOG_LEVEL: 'error' },
      },
    });

    try {
      await client2.initialize();
      client2.notify('notifications/initialized');
      await new Promise((resolve) => setTimeout(resolve, 100));

      const tools2 = await client2.listTools();
      expect(tools2.tools.length).toBeGreaterThan(0);
    } finally {
      await client2.disconnect();
    }
  });
});
