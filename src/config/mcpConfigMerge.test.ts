import { GlobalTransportConfig, MCPServerParams } from '@src/core/types/transport.js';

import { describe, expect, it } from 'vitest';

import { getUnknownGlobalConfigKeys, mergeGlobalAndServerConfig, mergeGlobalWithServers } from './mcpConfigMerge.js';

describe('mcpConfigMerge', () => {
  it('merges env objects with server values taking precedence', () => {
    const globalConfig: GlobalTransportConfig = {
      env: { SHARED: 'from-global', KEEP: 'global-only' },
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
      env: { SHARED: 'from-server' },
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.env).toEqual({
      SHARED: 'from-server',
      KEEP: 'global-only',
    });
  });

  it('uses global primitive values when server values are missing', () => {
    const globalConfig: GlobalTransportConfig = {
      timeout: 1000,
      connectionTimeout: 2000,
      requestTimeout: 3000,
      inheritParentEnv: true,
      envFilter: ['PATH', 'NODE_*'],
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.timeout).toBe(1000);
    expect(merged.connectionTimeout).toBe(2000);
    expect(merged.requestTimeout).toBe(3000);
    expect(merged.inheritParentEnv).toBe(true);
    expect(merged.envFilter).toEqual(['PATH', 'NODE_*']);
  });

  it('inherits global restart settings for stdio while preserving explicit server values', () => {
    const globalConfig: GlobalTransportConfig = {
      restartOnExit: true,
      maxRestarts: 5,
      restartDelay: 1000,
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
      restartOnExit: false,
      maxRestarts: 0,
      restartDelay: 0,
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.restartOnExit).toBe(false);
    expect(merged.maxRestarts).toBe(0);
    expect(merged.restartDelay).toBe(0);
  });

  it('leaves an omitted maxRestarts value for the runtime supervision policy to resolve', () => {
    const globalConfig: GlobalTransportConfig = { restartOnExit: true };
    const serverConfig: MCPServerParams = { type: 'stdio', command: 'node' };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.restartOnExit).toBe(true);
    expect(merged.maxRestarts).toBeUndefined();
  });

  it.each(['http', 'sse', 'streamableHttp'] as const)('ignores global restart settings for %s transports', (type) => {
    const globalConfig = {
      restartOnExit: true,
      maxRestarts: 5,
      restartDelay: 1000,
    } as GlobalTransportConfig;
    const serverConfig: MCPServerParams = {
      type,
      url: 'https://example.com/mcp',
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.restartOnExit).toBeUndefined();
    expect(merged.maxRestarts).toBeUndefined();
    expect(merged.restartDelay).toBeUndefined();
  });

  it('merges global and server envFilter values with stable deduplication', () => {
    const globalConfig: GlobalTransportConfig = {
      envFilter: ['UV_*', 'https_proxy', 'HTTP_PROXY', 'no_proxy', 'PATH'],
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'bunx',
      envFilter: ['CONTEXT7_API_KEY', 'PATH', 'UV_*'],
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.envFilter).toEqual(['UV_*', 'https_proxy', 'HTTP_PROXY', 'no_proxy', 'PATH', 'CONTEXT7_API_KEY']);
  });

  it('replaces oauth and headers with server-specific values', () => {
    const globalConfig: GlobalTransportConfig = {
      oauth: { clientId: 'global-client' },
      headers: { Authorization: 'Bearer global-token' },
    };
    const serverConfig: MCPServerParams = {
      type: 'http',
      url: 'https://example.com/mcp',
      oauth: { clientId: 'server-client' },
      headers: { Authorization: 'Bearer server-token' },
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.oauth).toEqual({ clientId: 'server-client' });
    expect(merged.headers).toEqual({ Authorization: 'Bearer server-token' });
  });

  it('ignores global headers for stdio transports', () => {
    const globalConfig: GlobalTransportConfig = {
      headers: { Authorization: 'Bearer global-token' },
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.headers).toBeUndefined();
  });

  it('ignores global inheritParentEnv for http transports', () => {
    const globalConfig: GlobalTransportConfig = {
      inheritParentEnv: true,
      envFilter: ['PATH'],
    };
    const serverConfig: MCPServerParams = {
      type: 'http',
      url: 'https://example.com/mcp',
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.inheritParentEnv).toBeUndefined();
    expect(merged.envFilter).toBeUndefined();
  });

  it('keeps server envFilter without global envFilter for explicit http transports', () => {
    const globalConfig: GlobalTransportConfig = {
      envFilter: ['PATH'],
    };
    const serverConfig: MCPServerParams = {
      type: 'http',
      url: 'https://example.com/mcp',
      envFilter: ['SERVER_ONLY'],
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.envFilter).toEqual(['SERVER_ONLY']);
  });

  it('merges global config into all servers', () => {
    const globalConfig: GlobalTransportConfig = {
      timeout: 5000,
    };
    const servers: Record<string, MCPServerParams> = {
      stdio: { type: 'stdio', command: 'node' },
      http: { type: 'http', url: 'https://example.com/mcp' },
    };

    const merged = mergeGlobalWithServers(globalConfig, servers);

    expect(merged.stdio.timeout).toBe(5000);
    expect(merged.http.timeout).toBe(5000);
  });

  it('returns unknown global keys for warning output', () => {
    const unknown = getUnknownGlobalConfigKeys({ env: { A: '1' }, command: 'node', disabled: true });

    expect(unknown.sort()).toEqual(['command', 'disabled']);
  });

  it('server primitive overrides global primitive', () => {
    const globalConfig: GlobalTransportConfig = { timeout: 9999 };
    const serverConfig: MCPServerParams = { type: 'stdio', command: 'node', timeout: 500 };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.timeout).toBe(500);
  });

  it('handles undefined globalConfig gracefully', () => {
    const serverConfig: MCPServerParams = { type: 'stdio', command: 'node', timeout: 1000 };

    const merged = mergeGlobalAndServerConfig(undefined, serverConfig);

    expect(merged).toEqual(serverConfig);
  });

  it('ignores global inheritParentEnv for sse transports', () => {
    const globalConfig: GlobalTransportConfig = { inheritParentEnv: true };
    const serverConfig: MCPServerParams = { type: 'sse', url: 'https://example.com/mcp' };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.inheritParentEnv).toBeUndefined();
  });

  it('ignores global inheritParentEnv for streamableHttp transports', () => {
    const globalConfig: GlobalTransportConfig = { inheritParentEnv: true };
    const serverConfig: MCPServerParams = { type: 'streamableHttp', url: 'https://example.com/mcp' };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.inheritParentEnv).toBeUndefined();
  });

  it('keeps server env object when global env is an array', () => {
    const globalConfig: GlobalTransportConfig = {
      env: ['GLOBAL_VAR=value'] as unknown as Record<string, string>,
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
      env: { SERVER_VAR: 'server-value' },
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.env).toEqual({ SERVER_VAR: 'server-value' });
  });

  it('keeps the server env array when both global and server env use array format', () => {
    const globalConfig: GlobalTransportConfig = {
      env: ['GLOBAL_VAR=value'] as unknown as Record<string, string>,
    };
    const serverConfig: MCPServerParams = {
      type: 'stdio',
      command: 'node',
      env: ['SERVER_VAR=server-value'] as unknown as Record<string, string>,
    };

    const merged = mergeGlobalAndServerConfig(globalConfig, serverConfig);

    expect(merged.env).toEqual(['SERVER_VAR=server-value']);
  });
});
