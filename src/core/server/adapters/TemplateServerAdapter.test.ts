import type { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { ClientStatus, OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { TemplateServerAdapter } from './TemplateServerAdapter.js';
import { ServerStatus } from './types.js';

describe('TemplateServerAdapter', () => {
  let outboundConns: OutboundConnections;
  let serverConfig: MCPServerParams;
  let mockTemplateManager: TemplateServerManager;

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
      template: {
        shareable: true,
      },
    };

    // Mock TemplateServerManager
    mockTemplateManager = {
      getRenderedHashForSession: (sessionId: string, templateName: string) => {
        if (sessionId === 'session1' && templateName === 'template1') {
          return 'hash1';
        }
        if (sessionId === 'session2' && templateName === 'template1') {
          return 'hash2';
        }
        return undefined;
      },
    } as any;
  });

  describe('constructor', () => {
    it('should create adapter with correct properties', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      expect(adapter.name).toBe('template1');
      expect(adapter.config).toBe(serverConfig);
      expect(adapter.type).toBe('template');
    });
  });

  describe('resolveConnection', () => {
    it('should resolve per-client template server (session key)', () => {
      const conn = createMockConnection('template1');
      outboundConns.set('template1:session1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result = adapter.resolveConnection({ sessionId: 'session1' });

      expect(result).toBe(conn);
    });

    it('should resolve shareable template server (hash key)', () => {
      const conn = createMockConnection('template1');
      outboundConns.set('template1:hash1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result = adapter.resolveConnection({ sessionId: 'session1' });

      expect(result).toBe(conn);
    });

    it('should prioritize session key over hash key', () => {
      const sessionConn = createMockConnection('template1-session');
      const hashConn = createMockConnection('template1-hash');
      outboundConns.set('template1:session1', sessionConn);
      outboundConns.set('template1:hash1', hashConn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result = adapter.resolveConnection({ sessionId: 'session1' });

      expect(result).toBe(sessionConn);
    });

    it('should return undefined without sessionId', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result = adapter.resolveConnection();

      expect(result).toBeUndefined();
    });

    it('should return undefined if no connection found', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result = adapter.resolveConnection({ sessionId: 'unknown-session' });

      expect(result).toBeUndefined();
    });

    it('should handle different sessions with different hashes', () => {
      const conn1 = createMockConnection('template1-hash1');
      const conn2 = createMockConnection('template1-hash2');
      outboundConns.set('template1:hash1', conn1);
      outboundConns.set('template1:hash2', conn2);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const result1 = adapter.resolveConnection({ sessionId: 'session1' });
      const result2 = adapter.resolveConnection({ sessionId: 'session2' });

      expect(result1).toBe(conn1);
      expect(result2).toBe(conn2);
    });
  });

  describe('getStatus', () => {
    it('should return Connected status for connected template server', () => {
      const conn = createMockConnection('template1', ClientStatus.Connected);
      outboundConns.set('template1:session1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const status = adapter.getStatus({ sessionId: 'session1' });

      expect(status).toBe(ServerStatus.Connected);
    });

    it('should return Disconnected status for disconnected template server', () => {
      const conn = createMockConnection('template1', ClientStatus.Disconnected);
      outboundConns.set('template1:session1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const status = adapter.getStatus({ sessionId: 'session1' });

      expect(status).toBe(ServerStatus.Disconnected);
    });

    it('should return Disconnected if connection not found', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const status = adapter.getStatus({ sessionId: 'unknown-session' });

      expect(status).toBe(ServerStatus.Disconnected);
    });

    it('should return Disconnected without sessionId', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const status = adapter.getStatus();

      expect(status).toBe(ServerStatus.Disconnected);
    });
  });

  describe('isAvailable', () => {
    it('should return true for connected template server', () => {
      const conn = createMockConnection('template1', ClientStatus.Connected);
      outboundConns.set('template1:session1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const available = adapter.isAvailable({ sessionId: 'session1' });

      expect(available).toBe(true);
    });

    it('should return false for disconnected template server', () => {
      const conn = createMockConnection('template1', ClientStatus.Disconnected);
      outboundConns.set('template1:session1', conn);
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const available = adapter.isAvailable({ sessionId: 'session1' });

      expect(available).toBe(false);
    });

    it('should return false without sessionId', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const available = adapter.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe('getConnectionKey', () => {
    it('should return session key for per-client server', () => {
      outboundConns.set('template1:session1', createMockConnection('template1'));
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const key = adapter.getConnectionKey({ sessionId: 'session1' });

      expect(key).toBe('template1:session1');
    });

    it('should return hash key for shareable server', () => {
      outboundConns.set('template1:hash1', createMockConnection('template1'));
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const key = adapter.getConnectionKey({ sessionId: 'session1' });

      expect(key).toBe('template1:hash1');
    });

    it('should prioritize session key over hash key', () => {
      outboundConns.set('template1:session1', createMockConnection('template1'));
      outboundConns.set('template1:hash1', createMockConnection('template1'));
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const key = adapter.getConnectionKey({ sessionId: 'session1' });

      expect(key).toBe('template1:session1');
    });

    it('should return undefined without sessionId', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const key = adapter.getConnectionKey();

      expect(key).toBeUndefined();
    });

    it('should return undefined if no connection found', () => {
      const adapter = new TemplateServerAdapter('template1', serverConfig, outboundConns, mockTemplateManager);

      const key = adapter.getConnectionKey({ sessionId: 'unknown-session' });

      expect(key).toBeUndefined();
    });
  });
});
