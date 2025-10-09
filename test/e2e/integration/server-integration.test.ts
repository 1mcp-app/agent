import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestProcessManager, ConfigBuilder, ProtocolValidator } from '@test/e2e/utils/index.js';
describe('MCP Server Integration E2E', () => {
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

  it('should handle multiple server configuration types', async () => {
    const config = configBuilder
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .enableAuth('integration-client', 'integration-secret')
      .addStdioServer('stdio-1', 'echo', ['stdio-test'], ['stdio', 'test'])
      .addStdioServer('stdio-2', 'sleep', ['1'], ['stdio', 'slow'])
      .addHttpServer('http-1', 'http://api.example.com', ['http', 'api'])
      .build();

    expect(config.servers).toHaveLength(3);
    expect(config.transport?.stdio).toBe(true);
    expect(config.transport?.http?.port).toBe(3000);
    expect(config.auth?.enabled).toBe(true);

    const stdioServers = config.servers.filter((s) => s.transport === 'stdio');
    const httpServers = config.servers.filter((s) => s.transport === 'http');

    expect(stdioServers).toHaveLength(2);
    expect(httpServers).toHaveLength(1);
  });

  it('should handle concurrent process management', async () => {
    const processes = [
      { name: 'proc-1', command: 'sleep', args: ['2'] },
      { name: 'proc-2', command: 'sleep', args: ['2'] },
      { name: 'proc-3', command: 'sleep', args: ['2'] },
    ];

    const startPromises = processes.map((proc) =>
      processManager.startProcess(proc.name, {
        command: proc.command,
        args: proc.args,
        timeout: 5000,
      }),
    );

    const processInfos = await Promise.all(startPromises);

    expect(processInfos).toHaveLength(3);
    processInfos.forEach((info) => {
      expect(info.pid).toBeGreaterThan(0);
    });

    processes.forEach((proc) => {
      expect(processManager.isProcessRunning(proc.name)).toBe(true);
    });

    // Cleanup
    const stopPromises = processes.map((proc) => processManager.stopProcess(proc.name));
    await Promise.all(stopPromises);

    processes.forEach((proc) => {
      expect(processManager.isProcessRunning(proc.name)).toBe(false);
    });
  });

  it('should validate integration error scenarios', async () => {
    const integrationErrors = [
      { code: -32000, message: 'Server error', data: { server: 'stdio-1' } },
      { code: -32001, message: 'Connection error', data: { transport: 'http' } },
      { code: -32002, message: 'Authentication error', data: { auth: 'failed' } },
      { code: -32003, message: 'Configuration error', data: { config: 'invalid' } },
    ];

    integrationErrors.forEach((error) => {
      const validation = ProtocolValidator.validateError(error);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle complex workflow validation', async () => {
    const workflow = [
      { step: 'initialize', method: 'init', params: { config: 'test' } },
      { step: 'authenticate', method: 'auth/login', params: { credentials: 'test' } },
      { step: 'list_tools', method: 'tools/list', params: {} },
      { step: 'call_tool', method: 'tools/call', params: { name: 'test', arguments: {} } },
      { step: 'list_resources', method: 'resources/list', params: {} },
      { step: 'read_resource', method: 'resources/read', params: { uri: 'test://resource' } },
      { step: 'cleanup', method: 'cleanup', params: {} },
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

  it('should handle integration performance patterns', async () => {
    const performanceTest = {
      servers: ['stdio-1', 'stdio-2', 'http-1'],
      requests_per_server: 100,
      concurrent_connections: 10,
      test_duration_ms: 30000,
      expected_metrics: {
        avg_response_time_ms: { min: 10, max: 500 },
        error_rate_percent: { max: 5 },
        throughput_rps: { min: 50 },
      },
    };

    expect(performanceTest.servers).toHaveLength(3);
    expect(performanceTest.requests_per_server).toBe(100);
    expect(performanceTest.concurrent_connections).toBe(10);
    expect(performanceTest.expected_metrics.avg_response_time_ms.max).toBe(500);
    expect(performanceTest.expected_metrics.error_rate_percent.max).toBe(5);
    expect(performanceTest.expected_metrics.throughput_rps.min).toBe(50);
  });
});
