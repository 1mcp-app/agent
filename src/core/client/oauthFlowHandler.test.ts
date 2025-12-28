import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@src/constants.js';
import { MCP_CLIENT_CAPABILITIES } from '@src/constants.js';
import { ClientStatus, OutboundConnection } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { OAuthFlowHandler } from './oauthFlowHandler.js';
import { OAuthRequiredError } from './types.js';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@src/core/validation/CustomJsonSchemaValidator.js', () => ({
  CustomJsonSchemaValidator: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockReturnValue({ valid: true }),
  })),
}));

vi.mock('@src/constants.js', () => ({
  MCP_SERVER_NAME: '1mcp-test',
  MCP_SERVER_VERSION: '1.0.0',
  MCP_CLIENT_CAPABILITIES: {
    tools: {},
    resources: {},
  },
}));

describe('OAuthFlowHandler', () => {
  let oauthFlowHandler: OAuthFlowHandler;
  let mockClient: Partial<Client>;
  let mockTransport: StreamableHTTPClientTransport;

  beforeEach(() => {
    vi.clearAllMocks();

    oauthFlowHandler = new OAuthFlowHandler();

    mockClient = {
      connect: vi.fn(),
      getServerCapabilities: vi.fn(),
      getInstructions: vi.fn(),
    };

    mockTransport = {
      _url: new URL('https://example.com/mcp'),
      oauthProvider: {
        getAuthorizationUrl: vi.fn().mockReturnValue('https://example.com/oauth/authorize'),
        token: 'test-token',
      },
      finishAuth: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as StreamableHTTPClientTransport;
    Object.setPrototypeOf(mockTransport, StreamableHTTPClientTransport.prototype);

    (Client as unknown as MockInstance).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('extractAuthorizationUrl', () => {
    it('should extract authorization URL from transport', () => {
      (mockTransport as any).oauthProvider = {
        getAuthorizationUrl: vi.fn().mockReturnValue('https://example.com/oauth'),
        token: 'test-token',
      };

      const url = oauthFlowHandler.extractAuthorizationUrl(mockTransport as any);

      expect(url).toBe('https://example.com/oauth');
      expect((mockTransport as any).oauthProvider.getAuthorizationUrl).toHaveBeenCalled();
    });

    it('should return undefined when oauthProvider is missing', () => {
      const transportWithoutOAuth = {} as any;

      const url = oauthFlowHandler.extractAuthorizationUrl(transportWithoutOAuth);

      expect(url).toBeUndefined();
    });

    it('should return undefined when getAuthorizationUrl is not available', () => {
      (mockTransport as any).oauthProvider = {
        token: 'test-token',
      };

      const url = oauthFlowHandler.extractAuthorizationUrl(mockTransport as any);

      expect(url).toBeUndefined();
    });

    it('should handle errors gracefully', () => {
      (mockTransport as any).oauthProvider = {
        getAuthorizationUrl: vi.fn().mockImplementation(() => {
          throw new Error('Failed to get URL');
        }),
        token: 'test-token',
      };

      const url = oauthFlowHandler.extractAuthorizationUrl(mockTransport as any);

      expect(url).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Could not extract authorization URL'));
    });
  });

  describe('handleOAuthRequired', () => {
    it('should create awaiting OAuth connection info', () => {
      const mockClientForOAuth = {} as Client;
      const error = new OAuthRequiredError('test-server', mockClientForOAuth);

      const connectionInfo = oauthFlowHandler.handleOAuthRequired(
        'test-server',
        mockTransport as any,
        mockClient as Client,
        error,
      );

      expect(connectionInfo.name).toBe('test-server');
      expect(connectionInfo.transport).toBe(mockTransport);
      expect(connectionInfo.client).toBe(mockClientForOAuth);
      expect(connectionInfo.status).toBe(ClientStatus.AwaitingOAuth);
      expect(connectionInfo.authorizationUrl).toBe('https://example.com/oauth/authorize');
      expect(connectionInfo.oauthStartTime).toBeInstanceOf(Date);
    });

    it('should include authorization URL in connection info', () => {
      const mockClientForOAuth = {} as Client;
      const error = new OAuthRequiredError('test-server', mockClientForOAuth);

      const connectionInfo = oauthFlowHandler.handleOAuthRequired(
        'test-server',
        mockTransport as any,
        mockClient as Client,
        error,
      );

      expect(connectionInfo.authorizationUrl).toBe('https://example.com/oauth/authorize');
    });
  });

  describe('completeOAuthAndReconnect', () => {
    const existingConnection: OutboundConnection = {
      name: 'test-server',
      transport: mockTransport as any,
      client: {} as Client,
      status: ClientStatus.AwaitingOAuth,
      instructions: 'test instructions',
    };

    it('should complete OAuth and reconnect successfully', async () => {
      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({
        tools: {},
        resources: {},
      });

      const result = await oauthFlowHandler.completeOAuthAndReconnect(
        'test-server',
        mockTransport as any,
        mockTransport as any,
        'auth-code-123',
        existingConnection,
      );

      expect(mockTransport.finishAuth).toHaveBeenCalledWith('auth-code-123');
      expect(mockTransport.close).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockClient.getServerCapabilities).toHaveBeenCalled();

      expect(result.name).toBe('test-server');
      expect(result.status).toBe(ClientStatus.Connected);
      expect(result.transport).toBe(mockTransport);
      expect(result.client).toBe(mockClient);
      expect(result.capabilities).toEqual({ tools: {}, resources: {} });
      expect(result.instructions).toBe('test instructions');
      expect(result.lastError).toBeUndefined();
    });

    it('should handle SSE transport', async () => {
      const mockSseTransport = {
        _url: new URL('https://example.com/sse'),
        oauthProvider: {
          getAuthorizationUrl: vi.fn().mockReturnValue('https://example.com/oauth/authorize'),
          token: 'test-token',
        },
        finishAuth: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      Object.setPrototypeOf(mockSseTransport, SSEClientTransport.prototype);

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      const result = await oauthFlowHandler.completeOAuthAndReconnect(
        'sse-server',
        mockSseTransport as any,
        mockSseTransport as any,
        'auth-code-456',
        existingConnection,
      );

      expect(mockSseTransport.finishAuth).toHaveBeenCalledWith('auth-code-456');
      expect(mockSseTransport.close).toHaveBeenCalled();
      expect(result.status).toBe(ClientStatus.Connected);
    });

    it('should throw error for unsupported transport type', async () => {
      const stdioTransport = {
        name: 'stdio',
        start: vi.fn(),
        send: vi.fn(),
        close: vi.fn(),
      };

      await expect(
        oauthFlowHandler.completeOAuthAndReconnect(
          'stdio-server',
          stdioTransport as any,
          stdioTransport as any,
          'auth-code',
          existingConnection,
        ),
      ).rejects.toThrow('does not support OAuth');
    });

    it('should handle reconnection errors', async () => {
      const error = new Error('Connection failed');
      (mockClient.connect as unknown as MockInstance).mockRejectedValue(error);

      await expect(
        oauthFlowHandler.completeOAuthAndReconnect(
          'failing-server',
          mockTransport as any,
          mockTransport as any,
          'auth-code',
          existingConnection,
        ),
      ).rejects.toThrow('Connection failed');

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('OAuth reconnection failed'), error);
    });

    it('should preserve existing instructions', async () => {
      const connectionWithInstructions: OutboundConnection = {
        ...existingConnection,
        instructions: 'custom instructions',
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      const result = await oauthFlowHandler.completeOAuthAndReconnect(
        'test-server',
        mockTransport as any,
        mockTransport as any,
        'auth-code',
        connectionWithInstructions,
      );

      expect(result.instructions).toBe('custom instructions');
    });

    it('should clear lastError on successful reconnection', async () => {
      const connectionWithError: OutboundConnection = {
        ...existingConnection,
        lastError: new Error('Previous error'),
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      const result = await oauthFlowHandler.completeOAuthAndReconnect(
        'test-server',
        mockTransport as any,
        mockTransport as any,
        'auth-code',
        connectionWithError,
      );

      expect(result.lastError).toBeUndefined();
    });
  });

  describe('client creation for OAuth', () => {
    it('should create client with proper configuration', async () => {
      const existingConnection: OutboundConnection = {
        name: 'test-server',
        transport: mockTransport as any,
        client: {} as Client,
        status: ClientStatus.AwaitingOAuth,
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      await oauthFlowHandler.completeOAuthAndReconnect(
        'test-server',
        mockTransport as any,
        mockTransport as any,
        'auth-code',
        existingConnection,
      );

      expect(Client).toHaveBeenCalledWith(
        {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        expect.objectContaining({
          capabilities: MCP_CLIENT_CAPABILITIES,
          jsonSchemaValidator: expect.any(Object),
          debouncedNotificationMethods: expect.any(Array),
        }),
      );
    });

    it('should configure debounced notification methods', async () => {
      const existingConnection: OutboundConnection = {
        name: 'test-server',
        transport: mockTransport as any,
        client: {} as Client,
        status: ClientStatus.AwaitingOAuth,
      };

      (mockClient.connect as unknown as MockInstance).mockResolvedValue(undefined);
      (mockClient.getServerCapabilities as unknown as MockInstance).mockReturnValue({});

      await oauthFlowHandler.completeOAuthAndReconnect(
        'test-server',
        mockTransport as any,
        mockTransport as any,
        'auth-code',
        existingConnection,
      );

      const call = (Client as unknown as MockInstance).mock.calls[0];
      const debouncedMethods = call[1].debouncedNotificationMethods;

      expect(debouncedMethods).toContain('notifications/tools/list_changed');
      expect(debouncedMethods).toContain('notifications/resources/list_changed');
      expect(debouncedMethods).toContain('notifications/prompts/list_changed');
    });
  });
});
