import type { MCPServerParams } from '@src/core/types/index.js';

import { vi } from 'vitest';

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(function () {
    return {
      type: 'stdio',
      start: vi.fn(),
      close: vi.fn(),
      pid: null,
    };
  }),
  getDefaultEnvironment: vi.fn().mockReturnValue({
    HOME: '/home/user',
    PATH: '/usr/bin',
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(function () {
    return {
      type: 'sse',
      close: vi.fn(),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function () {
    return {
      type: 'http',
      close: vi.fn(),
    };
  }),
}));

vi.mock('../auth/sdkOAuthClientProvider.js', () => ({
  SDKOAuthClientProvider: vi.fn().mockImplementation(function () {
    return {
      name: 'mock-oauth-provider',
      authenticate: vi.fn(),
    };
  }),
}));

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn().mockImplementation((key: string) => {
        if (key === 'externalUrl') return 'http://localhost:3000';
        if (key === 'host') return 'localhost';
        if (key === 'port') return 3000;
        if (key === 'auth') return { sessionStoragePath: undefined };
        if (key === 'features') return { envSubstitution: true };
        return undefined;
      }),
      getConfig: vi.fn().mockReturnValue({
        host: 'localhost',
        port: 3000,
      }),
      getUrl: vi.fn().mockReturnValue('http://localhost:3000'),
      getSessionStoragePath: vi.fn().mockReturnValue(undefined),
      isEnvSubstitutionEnabled: vi.fn().mockReturnValue(true),
    }),
  },
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
  debugIf: vi.fn(),
}));

vi.mock('@src/core/types/index.js', async () => {
  const actual = await vi.importActual('@src/core/types/index.js');
  return {
    ...actual,
    transportConfigSchema: {
      parse: vi.fn(),
      _type: {} as MCPServerParams,
    },
  };
});
