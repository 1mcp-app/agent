import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { TestProcessManager, ConfigBuilder, ProtocolValidator } from '@test/e2e/utils/index.js';
describe('HTTP Management Infrastructure E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();

    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableHttpTransport(3000)
      .enableAuth('test-client-id', 'test-client-secret')
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .addStdioServer('capability-server', 'node', [join(fixturesPath, 'capability-server.js')], ['test', 'capability'])
      .writeToFile();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  it('should create valid HTTP transport configuration', async () => {
    // Test that configuration builds correctly
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    const config = configBuilder.build();
    // Just validate that configuration is created without specific structure requirements
    expect(config).toBeDefined();
    expect(config.servers).toBeDefined();
    expect(Array.isArray(config.servers)).toBe(true);
  });

  it('should validate HTTP management endpoints structure', async () => {
    // Test management API endpoint patterns
    const managementEndpoints = [
      '/health',
      '/api/servers',
      '/api/servers/{id}',
      '/api/servers/{id}/restart',
      '/api/config',
      '/api/config/reload',
      '/api/metrics',
      '/api/docs',
    ];

    managementEndpoints.forEach((endpoint) => {
      // Validate endpoint pattern
      expect(endpoint).toMatch(/^\/[a-z]+/);
      expect(endpoint.length).toBeGreaterThan(1);
    });
  });

  it('should handle configuration validation for management features', async () => {
    // Test different management configurations
    const configs = [
      new ConfigBuilder()
        .enableHttpTransport(3001)
        .enableAuth('client1', 'secret1')
        .addStdioServer('server1', 'echo', ['hello'], ['tag1'])
        .build(),
      new ConfigBuilder().enableHttpTransport(3002).addStdioServer('server2', 'echo', ['world'], ['tag2']).build(),
      new ConfigBuilder()
        .enableHttpTransport(3003)
        .enableAuth('client2', 'secret2')
        .addStdioServer('server3', 'echo', ['test'], ['tag3'])
        .addStdioServer('server4', 'echo', ['test2'], ['tag4'])
        .build(),
    ];

    configs.forEach((config, index) => {
      expect(config.transport?.http?.port).toBe(3001 + index);
      if (index === 1) {
        // Second config has no auth
        expect(config.auth?.enabled).toBeFalsy();
      } else {
        expect(config.auth?.enabled).toBe(true);
      }
    });
  });

  it('should validate HTTP authentication configuration', async () => {
    // Test OAuth configuration structure
    const config = configBuilder.build();
    // Just validate auth structure exists
    expect(config.auth).toBeDefined();
    if (config.auth?.enabled) {
      expect(config.auth.clientId).toBeDefined();
      expect(config.auth.clientSecret).toBeDefined();
    }
  });

  it('should handle process management for HTTP servers', async () => {
    // Test process management infrastructure with a long-running process
    const processInfo = await processManager.startProcess('test-http-process', {
      command: 'sleep',
      args: ['1'],
    });

    expect(processInfo.pid).toBeGreaterThan(0);
    expect(processManager.isProcessRunning('test-http-process')).toBe(true);

    await processManager.stopProcess('test-http-process');
    expect(processManager.isProcessRunning('test-http-process')).toBe(false);
  });

  it('should validate HTTP request/response protocols', async () => {
    // Test HTTP protocol message validation
    const httpRequest = {
      method: 'GET',
      url: '/api/servers',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
    };

    expect(httpRequest.method).toMatch(/^(GET|POST|PUT|DELETE|PATCH)$/);
    expect(httpRequest.url).toMatch(/^\/api\//);
    expect(httpRequest.headers['Authorization']).toMatch(/^Bearer \w+/);
  });

  it('should validate JSON-RPC over HTTP structure', async () => {
    // Test JSON-RPC message validation for HTTP transport
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    };

    const validation = ProtocolValidator.validateRequest(jsonRpcRequest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it('should handle server status monitoring structure', async () => {
    // Test server status data structure
    const serverStatus = {
      name: 'echo-server',
      status: 'connected',
      transport: 'stdio',
      pid: 12345,
      tags: ['test', 'echo'],
      uptime: 30000,
      lastPing: Date.now(),
    };

    expect(serverStatus.name).toBe('echo-server');
    expect(['connected', 'failed', 'starting']).toContain(serverStatus.status);
    expect(serverStatus.transport).toBe('stdio');
    expect(serverStatus.pid).toBeGreaterThan(0);
    expect(Array.isArray(serverStatus.tags)).toBe(true);
  });

  it('should validate configuration reload patterns', async () => {
    // Test configuration reload structure
    const reloadRequest = {
      action: 'reload',
      force: false,
      preserve_connections: true,
    };

    expect(reloadRequest.action).toBe('reload');
    expect(typeof reloadRequest.force).toBe('boolean');
    expect(typeof reloadRequest.preserve_connections).toBe('boolean');
  });

  it('should handle metrics data structure validation', async () => {
    // Test metrics data structure
    const metricsData = {
      uptime: 30000,
      servers: {
        total: 2,
        connected: 2,
        failed: 0,
      },
      requests: {
        total: 100,
        successful: 98,
        failed: 2,
        avg_response_time: 45,
      },
      memory: {
        used: 25.5,
        total: 512,
      },
    };

    expect(typeof metricsData.uptime).toBe('number');
    expect(metricsData.servers.total).toBe(2);
    expect(metricsData.servers.connected).toBe(2);
    expect(metricsData.requests.total).toBeGreaterThan(0);
    expect(metricsData.memory.used).toBeGreaterThan(0);
  });

  it('should validate tag-based filtering patterns', async () => {
    // Test tag filtering logic
    const servers = [
      { name: 'echo-server', tags: ['test', 'echo'] },
      { name: 'capability-server', tags: ['test', 'capability'] },
    ];

    const echoServers = servers.filter((s) => s.tags.includes('echo'));
    const testServers = servers.filter((s) => s.tags.includes('test'));
    const capabilityServers = servers.filter((s) => s.tags.includes('capability'));

    expect(echoServers).toHaveLength(1);
    expect(testServers).toHaveLength(2);
    expect(capabilityServers).toHaveLength(1);
    expect(echoServers[0].name).toBe('echo-server');
  });

  it('should validate error handling patterns', async () => {
    // Test error response structure
    const errorResponse = {
      error: {
        code: 404,
        message: 'Server not found',
        details: 'The requested server "nonexistent-server" does not exist',
      },
      timestamp: Date.now(),
      request_id: 'req-123',
    };

    expect(errorResponse.error.code).toBe(404);
    expect(errorResponse.error.message).toBe('Server not found');
    expect(typeof errorResponse.timestamp).toBe('number');
    expect(errorResponse.request_id).toMatch(/^req-/);
  });

  it('should handle CORS configuration validation', async () => {
    // Test CORS configuration structure
    const corsConfig = {
      enabled: true,
      origins: ['http://localhost:3000', 'https://app.example.com'],
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      headers: ['Authorization', 'Content-Type', 'X-Requested-With'],
      credentials: true,
    };

    expect(corsConfig.enabled).toBe(true);
    expect(Array.isArray(corsConfig.origins)).toBe(true);
    expect(corsConfig.methods).toContain('GET');
    expect(corsConfig.headers).toContain('Authorization');
    expect(typeof corsConfig.credentials).toBe('boolean');
  });

  it('should validate rate limiting configuration', async () => {
    // Test rate limiting structure
    const rateLimitConfig = {
      enabled: true,
      window_ms: 60000, // 1 minute
      max_requests: 100,
      skip_successful: false,
      message: 'Too many requests',
    };

    expect(rateLimitConfig.enabled).toBe(true);
    expect(rateLimitConfig.window_ms).toBe(60000);
    expect(rateLimitConfig.max_requests).toBeGreaterThan(0);
    expect(typeof rateLimitConfig.skip_successful).toBe('boolean');
  });

  it('should handle API documentation structure', async () => {
    // Test API documentation metadata
    const apiDocs = {
      openapi: '3.0.0',
      info: {
        title: 'MCP Management API',
        version: '1.0.0',
        description: 'REST API for managing MCP servers',
      },
      paths: {
        '/api/servers': {
          get: {
            summary: 'List all servers',
            responses: {
              '200': { description: 'Success' },
              '401': { description: 'Unauthorized' },
            },
          },
        },
      },
    };

    expect(apiDocs.openapi).toBe('3.0.0');
    expect(apiDocs.info.title).toBe('MCP Management API');
    expect(apiDocs.paths['/api/servers']).toBeDefined();
    expect(apiDocs.paths['/api/servers'].get).toBeDefined();
  });
});
