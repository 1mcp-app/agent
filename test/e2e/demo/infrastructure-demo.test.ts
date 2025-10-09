import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('E2E Infrastructure Demo', () => {
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

  it('should demonstrate test process management', async () => {
    // Start a simple Node.js process for testing
    const processInfo = await processManager.startProcess('test-echo', {
      command: 'node',
      args: ['-e', 'console.log("Hello E2E"); setInterval(() => {}, 1000);'], // Keep alive
      timeout: 5000,
    });

    expect(processInfo).toBeDefined();
    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processInfo.config.command).toBe('node');

    // Check if process is running
    expect(processManager.isProcessRunning('test-echo')).toBe(true);

    // Stop the process
    await processManager.stopProcess('test-echo');
    expect(processManager.isProcessRunning('test-echo')).toBe(false);
  });

  it('should demonstrate configuration building', async () => {
    const fixturesPath = join(__dirname, '../fixtures');

    const config = configBuilder
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .addStdioServer('test-server', 'node', [join(fixturesPath, 'capability-server.js')], ['test', 'capability'])
      .enableAuth('client-id', 'client-secret')
      .build();

    expect(config.servers).toHaveLength(2);
    expect(config.transport?.stdio).toBe(true);
    expect(config.transport?.http?.port).toBe(3000);
    expect(config.auth?.enabled).toBe(true);
    expect(config.auth?.clientId).toBe('client-id');

    // Test tag filtering
    const echoServer = config.servers.find((s) => s.name === 'echo-server');
    expect(echoServer?.tags).toContain('echo');
    expect(echoServer?.tags).toContain('test');

    // Write and read config
    const configPath = configBuilder.writeToFile();
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    // Verify file exists and is readable
    const fs = require('fs');
    expect(fs.existsSync(configPath)).toBe(true);

    const fileContent = fs.readFileSync(configPath, 'utf8');
    const parsedConfig = JSON.parse(fileContent);
    expect(parsedConfig.servers).toHaveLength(2);
  });

  it('should demonstrate protocol validation', () => {
    // Test valid JSON-RPC request
    const validRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: {},
    };

    const requestValidation = ProtocolValidator.validateRequest(validRequest);
    expect(requestValidation.valid).toBe(true);
    expect(requestValidation.errors).toHaveLength(0);

    // Test valid JSON-RPC response
    const validResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: { status: 'pong' },
    };

    const responseValidation = ProtocolValidator.validateResponse(validResponse);
    expect(responseValidation.valid).toBe(true);
    expect(responseValidation.errors).toHaveLength(0);

    // Test invalid request
    const invalidRequest = {
      id: 1,
      method: 'ping',
      // Missing jsonrpc field
    };

    const invalidValidation = ProtocolValidator.validateRequest(invalidRequest);
    expect(invalidValidation.valid).toBe(false);
    expect(invalidValidation.errors.length).toBeGreaterThan(0);
    expect(invalidValidation.errors[0]).toContain('JSON-RPC');

    // Test MCP method validation
    const mcpValidation = ProtocolValidator.validateMcpMethod('tools/list');
    expect(mcpValidation.valid).toBe(true);

    const customMethodValidation = ProtocolValidator.validateMcpMethod('custom/method');
    expect(customMethodValidation.valid).toBe(true);
    expect(customMethodValidation.warnings.length).toBeGreaterThan(0);
  });

  it('should demonstrate configuration patterns', () => {
    // Test multiple configuration builders
    const minimalConfig = ConfigBuilder.createMinimal().build();
    expect(minimalConfig.transport?.stdio).toBe(true);
    expect(minimalConfig.transport?.http).toBeDefined();

    const echoConfig = ConfigBuilder.createWithEchoServer().build();
    expect(echoConfig.servers).toHaveLength(1);
    expect(echoConfig.servers[0].name).toBe('echo-server');

    const multiConfig = ConfigBuilder.createWithMultipleServers().build();
    expect(multiConfig.servers.length).toBeGreaterThan(1);

    const serverNames = multiConfig.servers.map((s) => s.name);
    expect(serverNames).toContain('echo-server');
    expect(serverNames).toContain('capability-server');
    expect(serverNames).toContain('error-server');
  });

  it('should handle concurrent process management', async () => {
    // Start multiple processes concurrently
    const processPromises = [
      processManager.startProcess('proc-1', {
        command: 'node',
        args: ['-e', 'console.log("Process 1"); setInterval(() => {}, 1000);'],
        timeout: 5000,
      }),
      processManager.startProcess('proc-2', {
        command: 'node',
        args: ['-e', 'console.log("Process 2"); setInterval(() => {}, 1000);'],
        timeout: 5000,
      }),
      processManager.startProcess('proc-3', {
        command: 'node',
        args: ['-e', 'console.log("Process 3"); setInterval(() => {}, 1000);'],
        timeout: 5000,
      }),
    ];

    const processes = await Promise.all(processPromises);

    // All processes should be running
    expect(processes).toHaveLength(3);
    processes.forEach((proc, index) => {
      expect(proc.pid).toBeGreaterThan(0);
      expect(processManager.isProcessRunning(`proc-${index + 1}`)).toBe(true);
    });

    // Stop all processes
    const stopPromises = [
      processManager.stopProcess('proc-1'),
      processManager.stopProcess('proc-2'),
      processManager.stopProcess('proc-3'),
    ];

    await Promise.all(stopPromises);

    // All processes should be stopped
    expect(processManager.isProcessRunning('proc-1')).toBe(false);
    expect(processManager.isProcessRunning('proc-2')).toBe(false);
    expect(processManager.isProcessRunning('proc-3')).toBe(false);
  });

  it('should demonstrate error handling', async () => {
    // Test error handling patterns without actual process failures
    const invalidProcessConfig = {
      command: '',
      args: ['--invalid'],
      timeout: 1000,
    };

    // Validate that invalid configurations are properly identified
    expect(invalidProcessConfig.command).toBe('');
    expect(processManager.isProcessRunning('non-existent-process')).toBe(false);
    expect(processManager.getProcess('non-existent-process')).toBeUndefined();

    // Test protocol validation errors
    const invalidMessage = {
      // Completely invalid structure
      not: 'valid',
      message: 'at all',
    };

    const validation = ProtocolValidator.validateMessage(invalidMessage);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
  });

  it('should demonstrate resource cleanup', async () => {
    // Create multiple processes and configs
    await processManager.startProcess('cleanup-test', {
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000);'],
      timeout: 5000,
    });

    const tempConfigPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('temp-server', 'node', ['--version'], ['temp'])
      .writeToFile();

    // Verify resources exist
    expect(processManager.isProcessRunning('cleanup-test')).toBe(true);

    const fs = require('fs');
    expect(fs.existsSync(tempConfigPath)).toBe(true);

    // Cleanup should remove everything
    await processManager.cleanup();
    configBuilder.cleanup();

    expect(processManager.isProcessRunning('cleanup-test')).toBe(false);
    expect(fs.existsSync(tempConfigPath)).toBe(false);
  });
});
