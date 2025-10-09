import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Stdio Transport Integration E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should handle multiple stdio server configurations', async () => {
    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .addStdioServer('capability-server', 'node', [join(fixturesPath, 'capability-server.js')], ['test', 'capability'])
      .addStdioServer(
        'slow-server',
        'node',
        [join(fixturesPath, 'slow-server.js'), '--defaultDelay=100'],
        ['test', 'slow'],
      )
      .writeToFile();

    const config = configBuilder.build();
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);
    expect(config.servers).toHaveLength(3);
    expect(config.servers.map((s) => s.name)).toEqual(['echo-server', 'capability-server', 'slow-server']);
    expect(config.transport?.stdio).toBe(true);
  });

  it('should handle tag-based server filtering', async () => {
    configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('server1', 'echo', ['hello'], ['fast', 'simple'])
      .addStdioServer('server2', 'echo', ['world'], ['slow', 'complex'])
      .addStdioServer('server3', 'echo', ['test'], ['fast', 'complex'])
      .writeToFile();

    const config = configBuilder.build();
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    // Test that servers have correct tags
    const fastServers = config.servers.filter((s) => s.tags?.includes('fast'));
    const complexServers = config.servers.filter((s) => s.tags?.includes('complex'));

    expect(fastServers).toHaveLength(2);
    expect(complexServers).toHaveLength(2);
    expect(fastServers.map((s) => s.name)).toEqual(['server1', 'server3']);
  });

  it('should handle concurrent process management', async () => {
    // Test managing multiple processes simultaneously
    const processes = [
      { id: 'proc1', command: 'sleep', args: ['2'] },
      { id: 'proc2', command: 'sleep', args: ['2'] },
      { id: 'proc3', command: 'sleep', args: ['2'] },
    ];

    const startPromises = processes.map((proc) =>
      processManager.startProcess(proc.id, {
        command: proc.command,
        args: proc.args,
        timeout: 5000,
      }),
    );

    const processInfos = await Promise.all(startPromises);

    expect(processInfos).toHaveLength(3);
    processInfos.forEach((info, index) => {
      expect(info.pid).toBeGreaterThan(0);
      expect(processManager.isProcessRunning(processes[index].id)).toBe(true);
    });

    // Clean up all processes
    const stopPromises = processes.map((proc) => processManager.stopProcess(proc.id));

    await Promise.all(stopPromises);

    processes.forEach((proc) => {
      expect(processManager.isProcessRunning(proc.id)).toBe(false);
    });
  });

  it('should handle complex configuration scenarios', async () => {
    // Test creating complex configuration with multiple transports
    const complexConfig = new ConfigBuilder()
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .addStdioServer('primary', 'echo', ['primary'], ['main', 'critical'])
      .addStdioServer('secondary', 'echo', ['secondary'], ['backup', 'optional'])
      .build();

    expect(complexConfig.transport?.stdio).toBe(true);
    expect(complexConfig.transport?.http?.port).toBe(3000);
    expect(complexConfig.servers).toHaveLength(2);

    // Test server configurations
    const primary = complexConfig.servers.find((s) => s.name === 'primary');
    const secondary = complexConfig.servers.find((s) => s.name === 'secondary');

    expect(primary?.tags).toContain('main');
    expect(primary?.tags).toContain('critical');
    expect(secondary?.tags).toContain('backup');
    expect(secondary?.tags).toContain('optional');
  });

  it('should validate full workflow patterns', async () => {
    // Test a complete workflow pattern
    const workflow = [
      { method: 'initialize', params: { config: 'test' } },
      { method: 'tools/list', params: {} },
      { method: 'tools/call', params: { name: 'echo', arguments: { message: 'test' } } },
      { method: 'resources/list', params: {} },
      { method: 'cleanup', params: {} },
    ];

    workflow.forEach((step, index) => {
      const request = {
        jsonrpc: '2.0',
        id: index + 1,
        method: step.method,
        params: step.params,
      };

      const validation = ProtocolValidator.validateRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle configuration hot-reloading simulation', async () => {
    // Test configuration changes
    const config1 = new ConfigBuilder()
      .enableStdioTransport()
      .addStdioServer('server1', 'echo', ['v1'], ['version1'])
      .build();

    const config2 = new ConfigBuilder()
      .enableStdioTransport()
      .addStdioServer('server1', 'echo', ['v2'], ['version2'])
      .addStdioServer('server2', 'echo', ['new'], ['new-feature'])
      .build();

    expect(config1.servers).toHaveLength(1);
    expect(config2.servers).toHaveLength(2);

    // Test that server configurations have changed
    const server1_v1 = config1.servers.find((s) => s.name === 'server1');
    const server1_v2 = config2.servers.find((s) => s.name === 'server1');

    expect(server1_v1?.args).toEqual(['v1']);
    expect(server1_v2?.args).toEqual(['v2']);
    expect(server1_v1?.tags).toEqual(['version1']);
    expect(server1_v2?.tags).toEqual(['version2']);
  });

  it('should handle error recovery patterns', async () => {
    // Test error recovery in integration scenarios
    const errorScenarios = [
      { type: 'timeout', code: -32000 },
      { type: 'connection_lost', code: -32001 },
      { type: 'server_overload', code: -32002 },
      { type: 'protocol_error', code: -32603 },
    ];

    errorScenarios.forEach((scenario) => {
      const error = {
        code: scenario.code,
        message: `${scenario.type} occurred`,
        data: { type: scenario.type, timestamp: new Date().toISOString() },
      };

      const validation = ProtocolValidator.validateError(error);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle performance monitoring patterns', async () => {
    // Test performance-related configuration patterns
    const performanceConfig = new ConfigBuilder()
      .enableStdioTransport()
      .addStdioServer('fast-server', 'echo', ['--fast'], ['performance', 'fast'])
      .addStdioServer('normal-server', 'echo', ['--normal'], ['performance', 'normal'])
      .addStdioServer('slow-server', 'sleep', ['0.1'], ['performance', 'slow'])
      .build();

    const performanceServers = performanceConfig.servers.filter((s) => s.tags?.includes('performance'));

    expect(performanceServers).toHaveLength(3);

    // Test different performance characteristics
    const fastServer = performanceServers.find((s) => s.tags?.includes('fast'));
    const slowServer = performanceServers.find((s) => s.tags?.includes('slow'));

    expect(fastServer?.command).toBe('echo');
    expect(slowServer?.command).toBe('sleep');
  });
});
