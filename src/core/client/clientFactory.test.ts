import { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { ClientFactory } from '@src/core/client/clientFactory.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
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

describe('ClientFactory', () => {
  let clientFactory: ClientFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    clientFactory = new ClientFactory();

    // Return new mock instances for each call
    (Client as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      connect: vi.fn(),
      getServerVersion: vi.fn(),
      close: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createClient', () => {
    it('should create a new Client instance', () => {
      const client = clientFactory.createClient();

      expect(client).toBeDefined();
      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          version: expect.any(String),
        }),
        expect.objectContaining({
          capabilities: expect.any(Object),
          jsonSchemaValidator: expect.any(Object),
        }),
      );
    });

    it('should create different client instances on each call', () => {
      const client1 = clientFactory.createClient();
      const client2 = clientFactory.createClient();

      expect(client1).not.toBe(client2);
      expect(Client).toHaveBeenCalledTimes(2);
    });
  });

  describe('createClientInstance', () => {
    it('should create a new Client instance without capabilities', () => {
      const client = clientFactory.createClientInstance();

      expect(client).toBeDefined();
      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(String),
          version: expect.any(String),
        }),
        undefined,
      );
    });

    it('should create different instances on each call', () => {
      const client1 = clientFactory.createClientInstance();
      const client2 = clientFactory.createClientInstance();

      expect(client1).not.toBe(client2);
      expect(Client).toHaveBeenCalledTimes(2);
    });
  });

  describe('createPooledClientInstance', () => {
    it('should create a pooled client instance with proper configuration', () => {
      const client = clientFactory.createPooledClientInstance();

      expect(client).toBeDefined();
      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '1mcp-client',
          version: '1.0.0',
        }),
        expect.objectContaining({
          capabilities: {},
        }),
      );
    });

    it('should create different pooled instances on each call', () => {
      const client1 = clientFactory.createPooledClientInstance();
      const client2 = clientFactory.createPooledClientInstance();

      expect(client1).not.toBe(client2);
      expect(Client).toHaveBeenCalledTimes(2);
    });
  });

  describe('client configuration', () => {
    it('should configure debounced notification methods', () => {
      clientFactory.createClient();

      expect(Client).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          debouncedNotificationMethods: expect.any(Array),
        }),
      );

      const call = (Client as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const debouncedMethods = call[1].debouncedNotificationMethods;

      expect(debouncedMethods).toContain('notifications/tools/list_changed');
      expect(debouncedMethods).toContain('notifications/resources/list_changed');
      expect(debouncedMethods).toContain('notifications/prompts/list_changed');
    });
  });
});
