import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Simple Stdio E2E Test', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should create simple stdio configuration', async () => {
    const config = configBuilder
      .enableStdioTransport()
      .addStdioServer('simple-server', 'echo', ['hello'], ['simple'])
      .build();

    expect(config.transport?.stdio).toBe(true);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('simple-server');
    expect(config.servers[0].command).toBe('echo');
    expect(config.servers[0].args).toEqual(['hello']);
  });

  it('should validate simple protocol messages', async () => {
    const simpleRequests = [
      { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ];

    simpleRequests.forEach((request) => {
      const validation = ProtocolValidator.validateRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle simple process management', async () => {
    const processInfo = await processManager.startProcess('simple-process', {
      command: 'sleep',
      args: ['1'],
      timeout: 5000,
    });

    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('simple-process')).toBe(true);

    await processManager.stopProcess('simple-process');
    expect(processManager.isProcessRunning('simple-process')).toBe(false);
  });

  it('should validate simple error handling', async () => {
    const simpleError = { code: -32600, message: 'Invalid Request' };
    const validation = ProtocolValidator.validateError(simpleError);

    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should handle simple configuration file operations', async () => {
    const configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('file-test', 'echo', ['test'], ['file'])
      .writeToFile();

    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    configBuilder.cleanup();
  });
});
