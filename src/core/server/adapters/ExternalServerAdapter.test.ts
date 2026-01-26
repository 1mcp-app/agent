import { ClientStatus, OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { ExternalServerAdapter } from './ExternalServerAdapter.js';
import { ServerStatus } from './types.js';

describe('ExternalServerAdapter', () => {
  let outboundConns: OutboundConnections;
  let serverConfig: MCPServerParams;

  const createMockConnection = (name: string, status: ClientStatus = ClientStatus.Connected): OutboundConnection => ({
    name,
    transport: {} as any,
    client: {} as any,
    status,
  });

  beforeEach(() => {
    outboundConns = new Map();
    serverConfig = {
      command: 'node',
      args: ['server.js'],
    };
  });

  describe('constructor', () => {
    it('should create adapter with correct properties', () => {
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      expect(adapter.name).toBe('test-server');
      expect(adapter.config).toBe(serverConfig);
      expect(adapter.type).toBe('external');
    });
  });

  describe('resolveConnection', () => {
    it('should resolve connection by server name', () => {
      const conn = createMockConnection('test-server');
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const result = adapter.resolveConnection();

      expect(result).toBe(conn);
    });

    it('should return undefined if connection not found', () => {
      const adapter = new ExternalServerAdapter('nonexistent', serverConfig, outboundConns);

      const result = adapter.resolveConnection();

      expect(result).toBeUndefined();
    });

    it('should ignore context for external servers', () => {
      const conn = createMockConnection('test-server');
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      // Context should be ignored for external servers
      const result = adapter.resolveConnection({ sessionId: 'any-session' });

      expect(result).toBe(conn);
    });
  });

  describe('getStatus', () => {
    it('should return Connected status for connected server', () => {
      const conn = createMockConnection('test-server', ClientStatus.Connected);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.Connected);
    });

    it('should return Disconnected status for disconnected server', () => {
      const conn = createMockConnection('test-server', ClientStatus.Disconnected);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.Disconnected);
    });

    it('should return Error status for error state', () => {
      const conn = createMockConnection('test-server', ClientStatus.Error);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.Error);
    });

    it('should return AwaitingOAuth status for OAuth state', () => {
      const conn = createMockConnection('test-server', ClientStatus.AwaitingOAuth);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.AwaitingOAuth);
    });

    it('should return Disconnected if connection not found', () => {
      const adapter = new ExternalServerAdapter('nonexistent', serverConfig, outboundConns);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.Disconnected);
    });
  });

  describe('isAvailable', () => {
    it('should return true for connected server', () => {
      const conn = createMockConnection('test-server', ClientStatus.Connected);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const available = adapter.isAvailable();

      expect(available).toBe(true);
    });

    it('should return false for disconnected server', () => {
      const conn = createMockConnection('test-server', ClientStatus.Disconnected);
      outboundConns.set('test-server', conn);
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const available = adapter.isAvailable();

      expect(available).toBe(false);
    });

    it('should return false if connection not found', () => {
      const adapter = new ExternalServerAdapter('nonexistent', serverConfig, outboundConns);

      const available = adapter.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('getConnectionKey', () => {
    it('should return server name as connection key', () => {
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const key = adapter.getConnectionKey();

      expect(key).toBe('test-server');
    });

    it('should ignore context for external servers', () => {
      const adapter = new ExternalServerAdapter('test-server', serverConfig, outboundConns);

      const key = adapter.getConnectionKey({ sessionId: 'any-session' });

      expect(key).toBe('test-server');
    });
  });
});
