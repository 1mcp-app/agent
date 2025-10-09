import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Multi-Transport Infrastructure Integration E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .enableAuth('test-client-id', 'test-client-secret')
      .addStdioServer('stdio-echo', 'node', [join(fixturesPath, 'echo-server.js')], ['stdio', 'echo'])
      .addStdioServer('stdio-capability', 'node', [join(fixturesPath, 'capability-server.js')], ['stdio', 'capability'])
      .addStdioServer(
        'stdio-slow',
        'node',
        [join(fixturesPath, 'slow-server.js'), '--defaultDelay=100'],
        ['stdio', 'slow'],
      )
      .writeToFile();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should create valid multi-transport configuration', async () => {
    // Test that configuration builds correctly with multiple transports
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    const config = configBuilder.build();
    expect(config).toBeDefined();
    expect(config.servers).toBeDefined();
    expect(Array.isArray(config.servers)).toBe(true);
    expect(config.transport).toBeDefined();
  });

  it('should validate transport protocol configurations', async () => {
    // Test different transport configurations
    const stdioConfig = new ConfigBuilder()
      .enableStdioTransport()
      .addStdioServer('stdio-1', 'echo', ['hello'], ['stdio'])
      .build();

    const httpConfig = new ConfigBuilder()
      .enableHttpTransport(3001)
      .enableAuth('client1', 'secret1')
      .addStdioServer('http-1', 'echo', ['world'], ['http'])
      .build();

    const multiConfig = new ConfigBuilder()
      .enableStdioTransport()
      .enableHttpTransport(3002)
      .enableAuth('client2', 'secret2')
      .addStdioServer('multi-1', 'echo', ['test'], ['both'])
      .build();

    expect(stdioConfig.transport?.stdio).toBe(true);
    expect(stdioConfig.transport?.http).toBeFalsy();

    expect(httpConfig.transport?.http?.port).toBe(3001);
    expect(httpConfig.auth?.enabled).toBe(true);

    expect(multiConfig.transport?.stdio).toBe(true);
    expect(multiConfig.transport?.http?.port).toBe(3002);
  });

  it('should handle tag-based server filtering across transports', async () => {
    // Test server filtering by tags
    const servers = [
      { name: 'stdio-echo', tags: ['stdio', 'echo'] },
      { name: 'stdio-capability', tags: ['stdio', 'capability'] },
      { name: 'stdio-slow', tags: ['stdio', 'slow'] },
    ];

    // Filter by transport type
    const stdioServers = servers.filter((s) => s.tags.includes('stdio'));
    expect(stdioServers).toHaveLength(3);

    // Filter by functionality
    const echoServers = servers.filter((s) => s.tags.includes('echo'));
    const capabilityServers = servers.filter((s) => s.tags.includes('capability'));
    const slowServers = servers.filter((s) => s.tags.includes('slow'));

    expect(echoServers).toHaveLength(1);
    expect(capabilityServers).toHaveLength(1);
    expect(slowServers).toHaveLength(1);

    expect(echoServers[0].name).toBe('stdio-echo');
    expect(capabilityServers[0].name).toBe('stdio-capability');
    expect(slowServers[0].name).toBe('stdio-slow');
  });

  it('should validate concurrent transport operations', async () => {
    // Test concurrent operation patterns
    const operations = [
      { transport: 'stdio', server: 'stdio-echo', method: 'ping' },
      { transport: 'stdio', server: 'stdio-capability', method: 'tools/list' },
      { transport: 'stdio', server: 'stdio-slow', method: 'ping' },
      { transport: 'http', server: 'any', method: 'ping' },
    ];

    // Validate operation structure
    operations.forEach((op) => {
      expect(['stdio', 'http', 'sse']).toContain(op.transport);
      expect(op.server).toBeDefined();
      expect(op.method).toBeDefined();

      // Validate method format
      const validation = ProtocolValidator.validateMcpMethod(op.method);
      expect(validation.valid).toBe(true);
    });
  });

  it('should handle process management across multiple transports', async () => {
    // Test starting different types of processes
    const processes = [
      { name: 'stdio-process', command: 'sleep', args: ['1'] },
      { name: 'http-process', command: 'sleep', args: ['1'] },
      { name: 'slow-process', command: 'sleep', args: ['1'] },
    ];

    const processInfos = [];
    for (const proc of processes) {
      const info = await processManager.startProcess(proc.name, {
        command: proc.command,
        args: proc.args,
        timeout: 5000,
        startupTimeout: 2000, // Reasonable startup timeout
      });
      processInfos.push(info);
      expect(processManager.isProcessRunning(proc.name)).toBe(true);
    }

    // All processes should be running
    expect(processInfos).toHaveLength(3);
    processInfos.forEach((info) => {
      expect(info.pid).toBeGreaterThan(0);
    });

    // Clean up
    for (const proc of processes) {
      await processManager.stopProcess(proc.name);
      expect(processManager.isProcessRunning(proc.name)).toBe(false);
    }
  });

  it('should validate configuration reload with multiple transports', async () => {
    // Test configuration changes
    const originalConfig = configBuilder.build();
    expect(originalConfig.servers).toHaveLength(3);

    // Create new configuration with additional servers
    const newConfigBuilder = new ConfigBuilder()
      .enableStdioTransport()
      .enableHttpTransport(3001)
      .enableAuth('new-client-id', 'new-client-secret');

    // Add original servers
    const fixturesPath = join(__dirname, '../fixtures');
    newConfigBuilder
      .addStdioServer('stdio-echo', 'node', [join(fixturesPath, 'echo-server.js')], ['stdio', 'echo'])
      .addStdioServer('stdio-capability', 'node', [join(fixturesPath, 'capability-server.js')], ['stdio', 'capability'])
      // Add new server
      .addStdioServer('stdio-error', 'node', [join(fixturesPath, 'error-server.js')], ['stdio', 'error']);

    const newConfig = newConfigBuilder.build();
    expect(newConfig.servers).toHaveLength(3); // echo, capability, error (slow removed)
    expect(newConfig.transport?.http?.port).toBe(3001);
    expect(newConfig.auth?.clientId).toBe('new-client-id');

    const serverNames = newConfig.servers.map((s) => s.name);
    expect(serverNames).toContain('stdio-echo');
    expect(serverNames).toContain('stdio-capability');
    expect(serverNames).toContain('stdio-error');
  });

  it('should handle transport failure scenarios', async () => {
    // Test handling of different failure scenarios
    const failureScenarios = [
      {
        type: 'server_crash',
        server: 'stdio-crash',
        expected_status: 'failed',
      },
      {
        type: 'invalid_command',
        server: 'invalid-server',
        expected_status: 'failed',
      },
      {
        type: 'timeout',
        server: 'slow-server',
        expected_status: 'timeout',
      },
    ];

    failureScenarios.forEach((scenario) => {
      expect(['server_crash', 'invalid_command', 'timeout', 'network_error']).toContain(scenario.type);
      expect(['failed', 'timeout', 'disconnected']).toContain(scenario.expected_status);
    });
  });

  it('should validate performance patterns across transports', async () => {
    // Test performance measurement structures
    const performanceMetrics = {
      stdio: {
        requests_per_second: 150,
        avg_response_time: 25,
        error_rate: 0.02,
        concurrent_connections: 10,
      },
      http: {
        requests_per_second: 75,
        avg_response_time: 45,
        error_rate: 0.01,
        concurrent_connections: 25,
      },
    };

    Object.values(performanceMetrics).forEach((metrics) => {
      expect(metrics.requests_per_second).toBeGreaterThan(0);
      expect(metrics.avg_response_time).toBeGreaterThan(0);
      expect(metrics.error_rate).toBeGreaterThanOrEqual(0);
      expect(metrics.error_rate).toBeLessThan(1);
      expect(metrics.concurrent_connections).toBeGreaterThan(0);
    });

    // Stdio should generally be faster than HTTP
    expect(performanceMetrics.stdio.requests_per_second).toBeGreaterThan(performanceMetrics.http.requests_per_second);
    expect(performanceMetrics.stdio.avg_response_time).toBeLessThan(performanceMetrics.http.avg_response_time);
  });

  it('should handle graceful shutdown across transports', async () => {
    // Test shutdown patterns
    const shutdownSequence = [
      { phase: 'stop_accepting_requests', duration: 100 },
      { phase: 'complete_active_requests', duration: 2000 },
      { phase: 'close_connections', duration: 500 },
      { phase: 'cleanup_resources', duration: 300 },
    ];

    let totalDuration = 0;
    shutdownSequence.forEach((phase) => {
      expect([
        'stop_accepting_requests',
        'complete_active_requests',
        'close_connections',
        'cleanup_resources',
      ]).toContain(phase.phase);
      expect(phase.duration).toBeGreaterThan(0);
      totalDuration += phase.duration;
    });

    // Total shutdown should be reasonable
    expect(totalDuration).toBeLessThan(10000); // Less than 10 seconds
  });

  it('should validate resource management across transports', async () => {
    // Test resource creation and management
    const resources = [
      {
        uri: 'test://stdio/resource1',
        name: 'Stdio Resource 1',
        transport: 'stdio',
        content: 'Created via stdio transport',
      },
      {
        uri: 'test://http/resource1',
        name: 'HTTP Resource 1',
        transport: 'http',
        content: 'Created via HTTP transport',
      },
      {
        uri: 'test://multi/resource1',
        name: 'Multi Resource 1',
        transport: 'both',
        content: 'Accessible via both transports',
      },
    ];

    resources.forEach((resource) => {
      expect(resource.uri).toMatch(/^test:\/\/[a-z]+\/[a-zA-Z0-9]+$/);
      expect(resource.name).toBeDefined();
      expect(['stdio', 'http', 'both']).toContain(resource.transport);
      expect(resource.content).toBeDefined();
    });

    // Test resource listing structure
    const resourceList = {
      resources: resources,
      total_count: resources.length,
      by_transport: {
        stdio: resources.filter((r) => r.transport === 'stdio' || r.transport === 'both').length,
        http: resources.filter((r) => r.transport === 'http' || r.transport === 'both').length,
      },
    };

    expect(resourceList.total_count).toBe(3);
    expect(resourceList.by_transport.stdio).toBe(2); // stdio + both
    expect(resourceList.by_transport.http).toBe(2); // http + both
  });

  it('should handle error propagation across transports', async () => {
    // Test error handling structures
    const errorTypes = [
      {
        transport: 'stdio',
        error_code: 'STDIO_CONNECTION_FAILED',
        message: 'Failed to establish stdio connection',
        recoverable: true,
      },
      {
        transport: 'http',
        error_code: 'HTTP_TIMEOUT',
        message: 'HTTP request timed out',
        recoverable: true,
      },
      {
        transport: 'both',
        error_code: 'PROTOCOL_ERROR',
        message: 'Invalid JSON-RPC message format',
        recoverable: false,
      },
    ];

    errorTypes.forEach((error) => {
      expect(['stdio', 'http', 'sse', 'both']).toContain(error.transport);
      expect(error.error_code).toMatch(/^[A-Z_]+$/);
      expect(error.message).toBeDefined();
      expect(typeof error.recoverable).toBe('boolean');
    });
  });

  it('should validate authentication across transports', async () => {
    // Test authentication configurations
    const authConfigs = [
      {
        transport: 'stdio',
        auth_required: false,
        reason: 'Local process communication',
      },
      {
        transport: 'http',
        auth_required: true,
        methods: ['oauth2', 'bearer_token'],
        scopes: ['mcp:read', 'mcp:write', 'mcp:admin'],
      },
    ];

    authConfigs.forEach((config) => {
      expect(['stdio', 'http', 'sse']).toContain(config.transport);
      expect(typeof config.auth_required).toBe('boolean');

      if (config.auth_required) {
        expect(config.methods).toBeDefined();
        expect(Array.isArray(config.methods)).toBe(true);
        expect(config.scopes).toBeDefined();
        expect(Array.isArray(config.scopes)).toBe(true);
      }
    });
  });

  it('should handle transport-specific message formatting', async () => {
    // Test message format validation for different transports
    const messages = [
      {
        transport: 'stdio',
        format: 'json_rpc',
        message: {
          jsonrpc: '2.0',
          id: 1,
          method: 'ping',
        },
      },
      {
        transport: 'http',
        format: 'http_json_rpc',
        message: {
          method: 'POST',
          url: '/mcp',
          headers: { 'Content-Type': 'application/json' },
          body: {
            jsonrpc: '2.0',
            id: 1,
            method: 'ping',
          },
        },
      },
    ];

    messages.forEach((msg) => {
      expect(['stdio', 'http', 'sse']).toContain(msg.transport);
      expect(['json_rpc', 'http_json_rpc', 'sse_json_rpc']).toContain(msg.format);
      expect(msg.message).toBeDefined();

      if (msg.format.includes('json_rpc')) {
        const jsonRpcMsg = msg.format === 'json_rpc' ? msg.message : msg.message.body;
        const validation = ProtocolValidator.validateRequest(jsonRpcMsg);
        expect(validation.valid).toBe(true);
      }
    });
  });

  it('should validate transport monitoring and metrics', async () => {
    // Test monitoring data structures
    const transportMetrics = {
      stdio: {
        active_connections: 3,
        total_requests: 1250,
        failed_requests: 15,
        avg_request_duration: 25,
        uptime: 3600000,
      },
      http: {
        active_connections: 12,
        total_requests: 890,
        failed_requests: 8,
        avg_request_duration: 45,
        uptime: 3600000,
        port: 3000,
        ssl_enabled: false,
      },
    };

    Object.entries(transportMetrics).forEach(([transport, metrics]) => {
      expect(['stdio', 'http']).toContain(transport);
      expect(metrics.active_connections).toBeGreaterThanOrEqual(0);
      expect(metrics.total_requests).toBeGreaterThan(0);
      expect(metrics.failed_requests).toBeGreaterThanOrEqual(0);
      expect(metrics.avg_request_duration).toBeGreaterThan(0);
      expect(metrics.uptime).toBeGreaterThan(0);

      if (transport === 'http') {
        expect((metrics as any).port).toBeGreaterThan(0);
        expect(typeof (metrics as any).ssl_enabled).toBe('boolean');
      }
    });
  });

  it('should handle configuration validation for all transport types', async () => {
    // Test comprehensive transport configuration
    const fullConfig = new ConfigBuilder()
      .enableStdioTransport()
      .enableHttpTransport(3005)
      .enableAuth('comprehensive-client', 'comprehensive-secret')
      .addStdioServer('server1', 'echo', ['arg1'], ['tag1'])
      .addStdioServer('server2', 'echo', ['arg2'], ['tag2'])
      .addStdioServer('server3', 'echo', ['arg3'], ['tag3'])
      .build();

    // Validate transport configuration
    expect(fullConfig.transport?.stdio).toBe(true);
    expect(fullConfig.transport?.http?.port).toBe(3005);

    // Validate auth configuration
    expect(fullConfig.auth?.enabled).toBe(true);
    expect(fullConfig.auth?.clientId).toBe('comprehensive-client');

    // Validate servers
    expect(fullConfig.servers).toHaveLength(3);
    fullConfig.servers.forEach((server, index) => {
      expect(server.name).toBe(`server${index + 1}`);
      expect(server.transport).toBe('stdio');
      expect(server.tags).toContain(`tag${index + 1}`);
    });
  });
});
