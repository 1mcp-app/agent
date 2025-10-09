import { ConfigBuilder, ProtocolValidator } from '@test/e2e/utils/index.js';

import { describe, expect, it } from 'vitest';

describe('Minimal E2E Demo', () => {
  it('should validate E2E infrastructure basics', () => {
    // Test configuration builder
    const config = ConfigBuilder.create()
      .enableStdioTransport()
      .enableHttpTransport(3000)
      .addStdioServer('test-server', 'node', ['--version'], ['test'])
      .build();

    expect(config.servers).toHaveLength(1);
    expect(config.transport?.stdio).toBe(true);
    expect(config.transport?.http?.port).toBe(3000);

    // Test protocol validator
    const validRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
    };

    const validation = ProtocolValidator.validateRequest(validRequest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Test invalid request
    const invalidRequest = {
      id: 1,
      method: 'ping',
      // Missing jsonrpc
    };

    const invalidValidation = ProtocolValidator.validateRequest(invalidRequest);
    expect(invalidValidation.valid).toBe(false);
    expect(invalidValidation.errors.length).toBeGreaterThan(0);
  });

  it('should demonstrate config file operations', () => {
    const configBuilder = new ConfigBuilder();

    const config = configBuilder.enableStdioTransport().addStdioServer('echo', 'echo', ['hello'], ['test']).build();

    expect(config.servers[0].name).toBe('echo');
    expect(config.servers[0].command).toBe('echo');
    expect(config.servers[0].args).toEqual(['hello']);
    expect(config.servers[0].tags).toContain('test');

    // Test file operations
    const configPath = configBuilder.writeToFile();
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    // Cleanup
    configBuilder.cleanup();
  });

  it('should validate MCP protocol patterns', () => {
    // Test standard MCP methods
    const mcpMethods = ['ping', 'tools/list', 'tools/call', 'resources/list', 'resources/read'];

    mcpMethods.forEach((method) => {
      const validation = ProtocolValidator.validateMcpMethod(method);
      expect(validation.valid).toBe(true);
    });

    // Test custom method (should have warning)
    const customValidation = ProtocolValidator.validateMcpMethod('custom/method');
    expect(customValidation.valid).toBe(true);
    expect(customValidation.warnings.length).toBeGreaterThan(0);

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
  });
});
