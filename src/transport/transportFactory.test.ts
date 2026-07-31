// sort-imports-ignore
import './transportFactory.testSetup.js';

import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import { MCPServerParams } from '@src/core/types/index.js';
// Import the mocked types
import { transportConfigSchema } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { createTransports } from './transportFactory.js';
import { ManagedStdioStderr } from './managedStdioStderr.js';

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

    it.each([
      [undefined, 'pipe'],
      ['pipe', 'pipe'],
      ['overlapped', 'overlapped'],
    ] as const)('should manage stdio stderr when configured as %s', (stderr, expectedMode) => {
      const config: Record<string, MCPServerParams> = {
        'stdio-server': {
          type: 'stdio',
          command: 'node',
          ...(stderr ? { stderr } : {}),
        },
      };

      (transportConfigSchema.parse as any).mockReturnValueOnce(config['stdio-server']);

      createTransports(config);

      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({ stderr: expectedMode }));
    });

    it('should close managed stderr with a standard stdio transport', async () => {
      const closeSpy = vi.spyOn(ManagedStdioStderr.prototype, 'close');
      const config: Record<string, MCPServerParams> = {
        'stdio-server': {
          type: 'stdio',
          command: 'node',
        },
      };

      (transportConfigSchema.parse as any).mockReturnValueOnce(config['stdio-server']);

      const transports = createTransports(config);
      await transports['stdio-server'].close();

      expect(closeSpy).toHaveBeenCalledOnce();
      closeSpy.mockRestore();
    });

    it.each(['inherit', 'ignore', 2] as const)('should preserve explicit stdio stderr target %s', (stderr) => {
      const config: Record<string, MCPServerParams> = {
        'stdio-server': {
          type: 'stdio',
          command: 'node',
          stderr,
        },
      };

      (transportConfigSchema.parse as any).mockReturnValueOnce(config['stdio-server']);

      createTransports(config);

      expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({ stderr }));
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
      expect(debugIf).toHaveBeenCalledWith('Skipping disabled transport: disabled-server');
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
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith(
        'sse-server',
        {
          autoRegister: true,
          redirectUrl: 'http://localhost:3000/oauth/callback/sse-server',
          clientId: 'test-client-id',
        },
        undefined,
      );
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith(
        'http-server',
        {
          autoRegister: true,
          redirectUrl: 'http://localhost:3000/oauth/callback/http-server',
        },
        undefined,
      );

      expect(transports['sse-server'].oauthProvider).toBeDefined();
      expect(transports['http-server'].oauthProvider).toBeDefined();
    });

    it('should substitute HTTP transport URL, headers, and OAuth values from process environment', () => {
      process.env.HTTP_MCP_URL = 'http://localhost:3010/mcp';
      process.env.HTTP_AUTH_TOKEN = 'secret-token';
      process.env.HTTP_CLIENT_ID = 'client-id-from-env';

      const config: Record<string, MCPServerParams> = {
        'http-env-server': {
          type: 'http',
          url: '$HTTP_MCP_URL',
          headers: {
            Authorization: 'Bearer ${HTTP_AUTH_TOKEN}',
          },
          oauth: {
            clientId: '$HTTP_CLIENT_ID',
          },
        },
      };

      (transportConfigSchema.parse as any).mockReturnValueOnce(config['http-env-server']);

      createTransports(config);

      expect(SDKOAuthClientProvider).toHaveBeenCalledWith(
        'http-env-server',
        expect.objectContaining({
          clientId: 'client-id-from-env',
        }),
        undefined,
      );
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
          path: ['command'],
          message: 'Required',
        },
      ]);
      (mockTransportConfigSchema.parse as any).mockImplementation(() => {
        throw zodError;
      });

      expect(() => createTransports(config)).toThrow();
      expect(logger.error).toHaveBeenCalledWith('Invalid transport configuration for invalid-server:', zodError.issues);
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
      expect(SDKOAuthClientProvider).toHaveBeenCalledWith(
        'streamable-http',
        {
          autoRegister: true,
          redirectUrl: 'http://localhost:3000/oauth/callback/streamable-http',
        },
        undefined,
      );
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

      expect(debugIf).toHaveBeenCalledWith('Created transport: test-server');
    });

    it('should attach runtime-owned supervision with custom maxRestarts and restartDelay', () => {
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
      expect(transports['restartable-server'].stdioSupervision?.policy).toEqual({
        restartOnExit: true,
        maxRestarts: 5,
        restartDelay: 2000,
      });
      expect(logger.info).toHaveBeenCalledWith('Enabling runtime-owned stdio supervision for: restartable-server');
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
      expect(transports['restartable-server-default'].stdioSupervision?.policy).toEqual({
        restartOnExit: true,
        maxRestarts: 3,
        restartDelay: undefined,
      });
    });

    it('leaves an omitted maxRestarts for the runtime policy to default to five', () => {
      const config: Record<string, MCPServerParams> = {
        'unlimited-restarts': {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          restartOnExit: true,
          restartDelay: 500,
          // maxRestarts not specified; the runtime supervisor resolves the default.
        },
      };

      const mockTransportConfigSchema = transportConfigSchema;
      (mockTransportConfigSchema.parse as any).mockReturnValueOnce(config['unlimited-restarts']);

      const transports = createTransports(config);

      expect(Object.keys(transports)).toEqual(['unlimited-restarts']);
      expect(transports['unlimited-restarts'].stdioSupervision?.policy.maxRestarts).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith('Enabling runtime-owned stdio supervision for: unlimited-restarts');
    });
  });
});
