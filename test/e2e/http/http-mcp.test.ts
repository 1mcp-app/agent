import { ConfigBuilder, ProtocolValidator, TestProcessManager } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('HTTP Transport MCP Protocol E2E', () => {
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

  it('should configure HTTP MCP transport', async () => {
    const httpPort = 3000 + Math.floor(Math.random() * 1000);
    const config = configBuilder
      .enableHttpTransport(httpPort)
      .addHttpServer('mcp-api', 'http://localhost:8080/mcp', ['mcp', 'api'])
      .build();

    expect(config.transport?.http?.port).toBe(httpPort);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].transport).toBe('http');
    expect(config.servers[0].endpoint).toBe('http://localhost:8080/mcp');
  });

  it('should validate MCP over HTTP protocol patterns', async () => {
    const mcpRequests = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'test' } } },
      { jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} },
      { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'file://test.txt' } },
    ];

    mcpRequests.forEach((request) => {
      const validation = ProtocolValidator.validateRequest(request);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  it('should handle HTTP endpoint configuration', async () => {
    const config = configBuilder
      .enableHttpTransport(3001)
      .addHttpServer('api1', 'https://api1.example.com/mcp', ['prod', 'api1'])
      .addHttpServer('api2', 'https://api2.example.com/mcp', ['prod', 'api2'])
      .build();

    expect(config.servers).toHaveLength(2);
    expect(config.servers.every((s) => s.transport === 'http')).toBe(true);
    expect(config.servers.every((s) => s.tags?.includes('prod'))).toBe(true);
  });
});
