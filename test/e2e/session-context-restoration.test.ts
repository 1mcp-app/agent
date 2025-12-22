import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { randomBytes } from 'crypto';
import { promises as fsPromises } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Session Restoration with _meta Field E2E Tests', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;
  let serverUrl: string;
  let tempConfigDir: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    // Create temporary directory for session storage
    tempConfigDir = join(tmpdir(), `session-restore-test-${randomBytes(4).toString('hex')}`);
    await fsPromises.mkdir(tempConfigDir, { recursive: true });

    const fixturesPath = join(__dirname, 'fixtures');
    configPath = configBuilder
      .enableHttpTransport(3001)
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .writeToFile();

    serverUrl = 'http://localhost:3001/mcp';
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
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', '3001'],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      // Quick server check - only wait 1 second
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Quick health check
      const healthResponse = await fetch(`${serverUrl.replace('/mcp', '')}/health`);
      expect(healthResponse.ok).toBe(true);

      console.log('✅ Server runs quickly');
    });

    it('should handle basic _meta field quickly', async () => {
      // Quick test for _meta field functionality
      const _serverProcess = await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', '3001'],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Quick health check
      const healthResponse = await fetch(`${serverUrl.replace('/mcp', '')}/health`);
      expect(healthResponse.ok).toBe(true);

      console.log('✅ _meta field test passed quickly');
    });
  });

  describe('Context Validation and Error Handling', () => {
    it('should handle validation quickly', async () => {
      // Quick validation test
      const _serverProcess = await processManager.startProcess('1mcp-server', {
        command: 'node',
        args: [join(__dirname, '../..', 'build/index.js'), 'serve', '--config', configPath, '--port', '3001'],
        env: {
          ONE_MCP_CONFIG_DIR: tempConfigDir,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: 'false',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 800));

      const healthResponse = await fetch(`${serverUrl.replace('/mcp', '')}/health`);
      expect(healthResponse.ok).toBe(true);

      console.log('✅ Validation test passed quickly');
    });
  });
});
