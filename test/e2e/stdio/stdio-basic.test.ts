import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestProcessManager, ConfigBuilder, ProtocolValidator } from '@test/e2e/utils/index.js';
describe('Stdio MCP Server Basic E2E', () => {
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

  it('should create basic stdio server configuration', async () => {
    const config = configBuilder
      .enableStdioTransport()
      .addStdioServer('basic-server', 'echo', ['hello'], ['basic', 'test'])
      .build();

    expect(config.transport?.stdio).toBe(true);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('basic-server');
    expect(config.servers[0].command).toBe('echo');
    expect(config.servers[0].args).toEqual(['hello']);
    expect(config.servers[0].tags).toContain('basic');
  });

  it('should handle basic MCP protocol validation', async () => {
    const basicRequests = [
      { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'test' } } },
    ];

    basicRequests.forEach((request) => {
      const validation = ProtocolValidator.validateRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle process lifecycle management', async () => {
    const processInfo = await processManager.startProcess('basic-process', {
      command: 'sleep',
      args: ['1'],
      timeout: 5000,
    });

    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('basic-process')).toBe(true);

    await processManager.stopProcess('basic-process');
    expect(processManager.isProcessRunning('basic-process')).toBe(false);
  });

  it('should validate basic error handling', async () => {
    const errors = [
      { code: -32700, message: 'Parse error' },
      { code: -32600, message: 'Invalid Request' },
      { code: -32601, message: 'Method not found' },
    ];

    errors.forEach((error) => {
      const validation = ProtocolValidator.validateError(error);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle multiple server configurations', async () => {
    const config = configBuilder
      .enableStdioTransport()
      .addStdioServer('server1', 'echo', ['test1'], ['group1'])
      .addStdioServer('server2', 'echo', ['test2'], ['group2'])
      .addStdioServer('server3', 'echo', ['test3'], ['group1'])
      .build();

    expect(config.servers).toHaveLength(3);

    const group1Servers = config.servers.filter((s) => s.tags?.includes('group1'));
    const group2Servers = config.servers.filter((s) => s.tags?.includes('group2'));

    expect(group1Servers).toHaveLength(2);
    expect(group2Servers).toHaveLength(1);
  });
});
