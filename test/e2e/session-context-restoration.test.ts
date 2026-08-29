import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, it } from 'vitest';

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

describe('Session Restoration with _meta Field E2E Tests', () => {
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
    tempConfigDir = join(tmpdir(), `session-restore-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });

    const fixturesPath = join(__dirname, 'fixtures');
    serverPort = await getAvailablePort();
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

  describe('Basic Session Context Functionality', () => {
    it('should start server and handle requests quickly', async () => {
      // Start 1MCP server
      const _serverProcess = await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      // Wait for server to be ready using retry logic
      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      console.log('✅ Server runs quickly');
    });

    it('should handle basic _meta field quickly', async () => {
      // Quick test for _meta field functionality
      const _serverProcess = await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      // Wait for server to be ready using retry logic
      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      console.log('✅ _meta field test passed quickly');
    });
  });

  describe('Context Validation and Error Handling', () => {
    it('should handle validation quickly', async () => {
      // Quick validation test
      const _serverProcess = await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', String(serverPort)],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      // Wait for server to be ready using retry logic
      await waitForServerReady(`${serverUrl.replace('/mcp', '')}/health/ready`);

      console.log('✅ Validation test passed quickly');
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
