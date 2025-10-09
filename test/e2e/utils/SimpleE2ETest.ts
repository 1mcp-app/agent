import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigBuilder } from './ConfigBuilder.js';

/**
 * Simplified E2E test approach that focuses on testing the MCP servers
 * in isolation rather than the full ServerManager
 */
describe('Simple E2E Test Example', () => {
  let configBuilder: ConfigBuilder;
  let configPath: string;

  beforeEach(async () => {
    configBuilder = new ConfigBuilder();

    // Create test configuration
    const fixturesPath = join(__dirname, '../fixtures');
    configPath = configBuilder
      .enableStdioTransport()
      .addStdioServer('echo-server', 'node', [join(fixturesPath, 'echo-server.js')], ['test', 'echo'])
      .writeToFile();
  });

  afterEach(async () => {
    configBuilder.cleanup();
  });

  it('should demonstrate basic E2E test structure', async () => {
    // Verify configuration was created properly
    expect(configPath).toBeDefined();
    expect(configPath.endsWith('.json')).toBe(true);

    // Verify configuration content
    const config = configBuilder.build();
    expect(config.transport?.stdio).toBe(true);
    expect(config.servers).toHaveLength(1);
    expect(config.servers[0].name).toBe('echo-server');
    expect(config.servers[0].transport).toBe('stdio');
    expect(config.servers[0].command).toBe('node');
    expect(config.servers[0].tags).toEqual(['test', 'echo']);
  });

  it('should validate configuration schema', async () => {
    const config = configBuilder.build();

    // Validate required fields
    expect(config).toHaveProperty('servers');
    expect(config).toHaveProperty('transport');
    expect(Array.isArray(config.servers)).toBe(true);

    // Validate server configuration
    const server = config.servers[0];
    expect(server).toHaveProperty('name');
    expect(server).toHaveProperty('transport');
    expect(server).toHaveProperty('command');
    expect(server).toHaveProperty('args');
    expect(server).toHaveProperty('tags');

    expect(typeof server.name).toBe('string');
    expect(typeof server.transport).toBe('string');
    expect(typeof server.command).toBe('string');
    expect(Array.isArray(server.args)).toBe(true);
    expect(Array.isArray(server.tags)).toBe(true);
  });

  it('should support multiple server configurations', async () => {
    const fixturesPath = join(__dirname, '../fixtures');

    // Add multiple servers to the configuration
    configBuilder
      .addStdioServer('capability-server', 'node', [join(fixturesPath, 'capability-server.js')], ['test', 'capability'])
      .addStdioServer(
        'slow-server',
        'node',
        [join(fixturesPath, 'slow-server.js'), '--defaultDelay=100'],
        ['test', 'slow'],
      );

    const config = configBuilder.build();

    expect(config.servers).toHaveLength(3);

    const serverNames = config.servers.map((s) => s.name);
    expect(serverNames).toContain('echo-server');
    expect(serverNames).toContain('capability-server');
    expect(serverNames).toContain('slow-server');

    // Verify all servers have test tag
    config.servers.forEach((server) => {
      expect(server.tags).toContain('test');
    });
  });
});
