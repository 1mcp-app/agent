import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Stdio Transport MCP Protocol E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .writeToFile();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should demonstrate working test infrastructure', async () => {
    // Test that we can create proper config
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    // Test that we can validate protocol messages
    const validRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    };

    const validation = ProtocolValidator.validateRequest(validRequest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should validate MCP method patterns', async () => {
    // Test standard MCP method validation
    const methods = ['ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read'];

    for (const method of methods) {
      const validation = ProtocolValidator.validateMcpMethod(method);
      expect(validation.valid).toBe(true);
    }

    // Test custom method validation (should have warning)
    const customValidation = ProtocolValidator.validateMcpMethod('custom/method');
    expect(customValidation.valid).toBe(true);
    expect(customValidation.warnings.length).toBeGreaterThan(0);
  });

  it('should handle test process management', async () => {
    // Start a sleep process to test process management
    const processInfo = await processManager.startProcess('test-sleep', {
      command: 'sleep',
      args: ['2'],
      timeout: 5000,
    });

    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('test-sleep')).toBe(true);

    await processManager.stopProcess('test-sleep');
    expect(processManager.isProcessRunning('test-sleep')).toBe(false);
  });

  it('should validate JSON-RPC error handling', async () => {
    // Test error validation
    const validError = {
      code: -32600,
      message: 'Invalid Request',
    };

    const errorValidation = ProtocolValidator.validateError(validError);
    expect(errorValidation.valid).toBe(true);

    const invalidError = {
      message: 'Missing code',
      // Missing code field
    };

    const invalidErrorValidation = ProtocolValidator.validateError(invalidError);
    expect(invalidErrorValidation.valid).toBe(false);
    expect(invalidErrorValidation.errors.length).toBeGreaterThan(0);
  });

  it('should handle configuration management', async () => {
    // Test creating multiple configs
    const config1 = new ConfigBuilder()
      .enableStdioTransport()
      .addStdioServer('server1', 'echo', ['hello'], ['tag1'])
      .build();

    const config2 = new ConfigBuilder()
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .addStdioServer('server2', 'echo', ['world'], ['tag2'])
      .build();

    expect(config1.servers).toHaveLength(1);
    expect(config2.servers).toHaveLength(1);
    expect(config1.transport?.stdio).toBe(true);
    expect(config2.transport?.http?.port).toBe(3000);
  });
});
