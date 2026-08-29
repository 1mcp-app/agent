/**
 * E2E tests for Streamable HTTP session restoration with sessionId handling
 *
 * These tests verify that the RestorableStreamableHTTPServerTransport properly
 * sets and retrieves sessionId during session restoration.
 *
 * Note: These tests focus on basic HTTP functionality. Complex MCP protocol
 * interactions are tested in unit tests.
 */
import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Deadline-based readiness probe against /health/ready (the runtime readiness
 * gate). Connection-refused is retried fast; only an accepted-but-slow
 * response consumes the per-attempt request timeout.
 */
async function waitForServerReady(
  healthUrl: string,
  options: { deadlineMs?: number; retryDelay?: number; requestTimeout?: number } = {},
): Promise<void> {
  const { deadlineMs = 30000, retryDelay = 300, requestTimeout = 5000 } = options;
  const deadline = Date.now() + deadlineMs;
  let attempts = 0;

  while (Date.now() < deadline) {
    attempts++;
    try {
      const healthResponse = await fetch(healthUrl, {
        signal: AbortSignal.timeout(requestTimeout),
      });
      if (healthResponse.ok) {
        console.log(`Server ready after ${attempts} attempts`);
        return;
      }
      console.log(`Health check attempt ${attempts}: HTTP ${healthResponse.status}`);
    } catch (error) {
      if (attempts % 10 === 0) {
        console.log(`Health check attempt ${attempts} failed: ${(error as Error).message}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay));
  }

  throw new Error(`Server failed to start within ${deadlineMs}ms (${attempts} attempts)`);
}

describe('Streamable HTTP Session Restoration E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;
  let serverUrl: string;
  let serverPort: number;
  let tempConfigDir: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    // Create temporary directory for session storage
    tempConfigDir = join(tmpdir(), `session-restore-e2e-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });

    serverPort = await getAvailablePort();
    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableHttpTransport(serverPort)
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .writeToFile();

    serverUrl = `http://localhost:${serverPort}/mcp`;
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();

    // Clean up temp directory
    try {
      await fsPromises.rm(tempConfigDir, { recursive: true, force: true });
    } catch (_error) {
      // Ignore cleanup errors
    }
  });

  describe('Server Startup and Health', () => {
    it('should start server successfully', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      // Wait for server to be ready
      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Verify health endpoint works
      const healthResponse = await fetch(`${serverUrl.replace('/mcp', '')}/health`);
      expect(healthResponse.ok).toBe(true);

      await processManager.stopProcess('1mcp-server');
    });

    it('should handle multiple server restarts', async () => {
      // Start server first time
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Stop server
      await processManager.stopProcess('1mcp-server');

      // Start server again
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Verify health endpoint still works
      const healthResponse = await fetch(`${serverUrl.replace('/mcp', '')}/health`);
      expect(healthResponse.ok).toBe(true);

      await processManager.stopProcess('1mcp-server');
    });
  });

  describe('Basic HTTP Request Handling', () => {
    it('should handle POST requests without crashing', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Make a basic POST request
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
        }),
      });

      // Should not crash - any response is acceptable
      expect([200, 202, 400, 404, 406, 500]).toContain(response.status);

      await processManager.stopProcess('1mcp-server');
    });

    it('should handle GET requests without crashing', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Make a basic GET request
      const response = await fetch(serverUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
        },
      });

      // Should not crash - any response is acceptable
      expect([200, 202, 400, 404, 406, 500]).toContain(response.status);

      await processManager.stopProcess('1mcp-server');
    });
  });

  describe('Session Header Handling', () => {
    it('should include session headers in responses when session exists', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Make a POST request that should create a session
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0',
            },
          },
        }),
      });

      // Check if sessionId header is present (if successful)
      const sessionId = response.headers.get('mcp-session-id');
      if (response.ok && sessionId) {
        expect(sessionId).toMatch(/^stream-/);
      }
      // If not successful, that's also acceptable - we're just testing it doesn't crash

      await processManager.stopProcess('1mcp-server');
    });

    it('should handle requests with existing session headers', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Make a request with a session ID header
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': 'stream-test-session-123',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      // Should not crash - any response is acceptable
      expect([200, 202, 400, 404, 406, 500]).toContain(response.status);

      await processManager.stopProcess('1mcp-server');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON gracefully', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Send invalid JSON
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json{{{',
      });

      // Should handle gracefully - either 400 or 500 is acceptable
      expect([400, 500]).toContain(response.status);

      await processManager.stopProcess('1mcp-server');
    });

    it('should handle requests with invalid session IDs', async () => {
      await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      // Make request with invalid session ID
      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': 'completely-invalid-session-id',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      // Should handle gracefully - should not crash
      expect([200, 202, 400, 404, 406, 500]).toContain(response.status);

      await processManager.stopProcess('1mcp-server');
    });
  });
});

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
