import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { createTransports } from './transportFactory.js';
import { MCPServerParams } from '../core/types/index.js';
import { SDKOAuthClientProvider } from '../auth/sdkOAuthClientProvider.js';
import logger from '../logger/logger.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({
    type: 'stdio',
    close: vi.fn(),
  })),
  getDefaultEnvironment: vi.fn().mockReturnValue({
    HOME: '/home/user',
    PATH: '/usr/bin',
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn().mockImplementation(() => ({
    type: 'sse',
    close: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({
    type: 'http',
    close: vi.fn(),
  })),
}));

vi.mock('../auth/sdkOAuthClientProvider.js', () => ({
  SDKOAuthClientProvider: vi.fn().mockImplementation(() => ({
    name: 'mock-oauth-provider',
    authenticate: vi.fn(),
  })),
}));

vi.mock('../core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: vi.fn().mockReturnValue({
      getConfig: vi.fn().mockReturnValue({
        host: 'localhost',
        port: 3000,
      }),
      getUrl: vi.fn().mockReturnValue('http://localhost:3000'),
    }),
  },
}));

vi.mock('../logger/logger.js', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../core/types/index.js', async () => {
  const actual = await vi.importActual('../core/types/index.js');
  return {
    ...actual,
    transportConfigSchema: {
      parse: vi.fn(),
      _type: {} as any,
    },
  };
});

// Import the mocked types
import { transportConfigSchema } from '../core/types/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

describe('TransportFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createTransports', () => {
    it('should create transports from valid configuration', () => {
      const config: Record<string, MCPServerParams> = {
        'stdio-server': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          timeout: 5000,
          tags: ['test'],
        },
        'sse-server': {
          type: 'sse',
          url: 'http://localhost:3001/sse',
          timeout: 10000,
          tags: ['web'],
        },
        'http-server': {
          type: 'http',
          url: 'http://localhost:3002/mcp',
          timeout: 15000,
          tags: ['api'],
        },
      };

      (transportConfigSchema.parse as any)
        .mockReturnValueOnce(config['stdio-server'])
        .mockReturnValueOnce(config['sse-server'])
        .mockReturnValueOnce(config['http-server']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['stdio-server', 'sse-server', 'http-server']);
      expect(transports['stdio-server'].timeout).toBe(5000);
      expect(transports['stdio-server'].tags).toEqual(['test']);
      expect(transports['sse-server'].timeout).toBe(10000);
      expect(transports['sse-server'].tags).toEqual(['web']);
      expect(transports['http-server'].timeout).toBe(15000);
      expect(transports['http-server'].tags).toEqual(['api']);
    });

    it('should skip disabled transports', () => {
      const config: Record<string, MCPServerParams> = {
        'enabled-server': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
        'disabled-server': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          disabled: true,
        },
      };

      (transportConfigSchema.parse as any).mockReturnValueOnce(config['enabled-server']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['enabled-server']);
      expect(logger.debug).toHaveBeenCalledWith('Skipping disabled transport: disabled-server');
    });

    it('should infer transport type when missing', () => {
      const config: Record<string, MCPServerParams> = {
        'stdio-inferred': {
          command: 'node',
          args: ['server.js'],
        },
        'sse-inferred': {
          url: 'http://localhost:3001/sse',
        },
        'http-inferred': {
          url: 'http://localhost:3002/mcp',
        },
      };

      (transportConfigSchema.parse as any)
        .mockReturnValueOnce({ ...config['stdio-inferred'], type: 'stdio' })
        .mockReturnValueOnce({ ...config['sse-inferred'], type: 'sse' })
        .mockReturnValueOnce({ ...config['http-inferred'], type: 'http' });

      createTransports(config);

      expect(logger.warn).toHaveBeenCalledWith('Transport type is missing for stdio-inferred, inferring type...');
      expect(logger.warn).toHaveBeenCalledWith('Transport type is missing for sse-inferred, inferring type...');
      expect(logger.warn).toHaveBeenCalledWith('Transport type is missing for http-inferred, inferring type...');

      expect(logger.info).toHaveBeenCalledWith('Inferred transport type for stdio-inferred as stdio');
      expect(logger.info).toHaveBeenCalledWith('Inferred transport type for sse-inferred as sse');
      expect(logger.info).toHaveBeenCalledWith('Inferred transport type for http-inferred as http/streamableHttp');
    });

    it('should create OAuth providers for HTTP-based transports', () => {
      const config: Record<string, MCPServerParams> = {
        'sse-server': {
          type: 'sse',
          url: 'http://localhost:3001/sse',
          oauth: {
            clientId: 'test-client-id',
          },
        },
        'http-server': {
          type: 'http',
          url: 'http://localhost:3002/mcp',
        },
      };

      (transportConfigSchema.parse as any)
        .mockReturnValueOnce(config['sse-server'])
        .mockReturnValueOnce(config['http-server']);

      const transports = createTransports(config);

      expect(SDKOAuthClientProvider).toHaveBeenCalledTimes(2);
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith('sse-server', {
        autoRegister: true,
        redirectUrl: 'http://localhost:3000/oauth/callback/sse-server',
        clientId: 'test-client-id',
      });
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith('http-server', {
        autoRegister: true,
        redirectUrl: 'http://localhost:3000/oauth/callback/http-server',
      });

      expect(transports['sse-server'].oauthProvider).toBeDefined();
      expect(transports['http-server'].oauthProvider).toBeDefined();
    });

    it('should handle validation errors', () => {
      const config: Record<string, MCPServerParams> = {
        'invalid-server': {
          type: 'stdio',
          // Missing required command
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      const zodError = new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['command'],
          message: 'Required',
        },
      ]);
      (mockTransportConfigSchema.parse as any).mockImplementation(() => {
        throw zodError;
      });

      expect(() => createTransports(config)).toThrow();
      expect(logger.error).toHaveBeenCalledWith('Invalid transport configuration for invalid-server:', zodError.errors);
    });

    it('should handle general errors', () => {
      const config: Record<string, MCPServerParams> = {
        'error-server': {
          type: 'stdio',
          command: 'node',
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      const error = new Error('General error');
      (mockTransportConfigSchema.parse as any).mockImplementation(() => {
        throw error;
      });

      expect(() => createTransports(config)).toThrow();
      expect(logger.error).toHaveBeenCalledWith('Error creating transport error-server:', error);
    });

    it('should throw error for missing URL in SSE transport', () => {
      const config: Record<string, MCPServerParams> = {
        'sse-no-url': {
          type: 'sse',
          // Missing URL
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['sse-no-url']);

      expect(() => createTransports(config)).toThrow('URL is required for SSE transport: sse-no-url');
    });

    it('should throw error for missing URL in HTTP transport', () => {
      const config: Record<string, MCPServerParams> = {
        'http-no-url': {
          type: 'http',
          // Missing URL
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['http-no-url']);

      expect(() => createTransports(config)).toThrow('URL is required for HTTP transport: http-no-url');
    });

    it('should throw error for missing command in stdio transport', () => {
      const config: Record<string, MCPServerParams> = {
        'stdio-no-command': {
          type: 'stdio',
          // Missing command
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['stdio-no-command']);

      expect(() => createTransports(config)).toThrow('Command is required for stdio transport: stdio-no-command');
    });

    it('should throw error for invalid transport type', () => {
      const config: Record<string, MCPServerParams> = {
        'invalid-type': {
          type: 'invalid' as any,
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['invalid-type']);

      expect(() => createTransports(config)).toThrow('Invalid transport type: invalid');
    });

    it('should handle streamableHttp type as alias for http', () => {
      const config: Record<string, MCPServerParams> = {
        'streamable-http': {
          type: 'streamableHttp',
          url: 'http://localhost:3002/mcp',
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['streamable-http']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['streamable-http']);
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith('streamable-http', {
        autoRegister: true,
        redirectUrl: 'http://localhost:3000/oauth/callback/streamable-http',
      });
    });

    it('should set custom headers for HTTP-based transports', () => {
      const config: Record<string, MCPServerParams> = {
        'sse-with-headers': {
          type: 'sse',
          url: 'http://localhost:3001/sse',
          headers: {
            'Custom-Header': 'test-value',
            Authorization: 'Bearer token',
          },
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['sse-with-headers']);

      createTransports(config);

      expect(SSEClientTransport).toHaveBeenCalledWith(
        new URL('http://localhost:3001/sse'),
        expect.objectContaining({
          requestInit: {
            headers: {
              'Custom-Header': 'test-value',
              Authorization: 'Bearer token',
            },
          },
          authProvider: expect.any(Object),
        }),
      );
    });

    it('should log transport creation success', () => {
      const config: Record<string, MCPServerParams> = {
        'test-server': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['test-server']);

      createTransports(config);

      expect(logger.debug).toHaveBeenCalledWith('Created transport: test-server');
    });

    it('should create restartable transport with custom maxRestarts and restartDelay', () => {
      const config: Record<string, MCPServerParams> = {
        'restartable-server': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          restartOnExit: true,
          maxRestarts: 5,
          restartDelay: 2000,
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['restartable-server']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['restartable-server']);
      expect(logger.info).toHaveBeenCalledWith('Creating restartable stdio transport for: restartable-server');
    });

    it('should use default restartDelay when not specified', () => {
      const config: Record<string, MCPServerParams> = {
        'restartable-server-default': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          restartOnExit: true,
          maxRestarts: 3,
          // restartDelay not specified, should use default of 1000ms
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['restartable-server-default']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['restartable-server-default']);
      expect(logger.info).toHaveBeenCalledWith('Creating restartable stdio transport for: restartable-server-default');
    });

    it('should use unlimited restarts when maxRestarts not specified', () => {
      const config: Record<string, MCPServerParams> = {
        'unlimited-restarts': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          restartOnExit: true,
          restartDelay: 500,
          // maxRestarts not specified, should be undefined (unlimited)
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['unlimited-restarts']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['unlimited-restarts']);
      expect(logger.info).toHaveBeenCalledWith('Creating restartable stdio transport for: unlimited-restarts');
    });
  });
});
