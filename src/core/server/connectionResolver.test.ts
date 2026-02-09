import { ClientStatus, OutboundConnection, OutboundConnections } from '@src/core/types/client.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { ConnectionResolver, createConnectionResolver, TemplateHashProvider } from './connectionResolver.js';

describe('ConnectionResolver', () => {
  let outboundConns: OutboundConnections;
  let mockTemplateHashProvider: TemplateHashProvider;

  // Helper to create a mock OutboundConnection
  const createMockConnection = (name: string): OutboundConnection => ({
    name,
    transport: {} as any,
    client: {} as any,
    status: ClientStatus.Connected,
  });

  beforeEach(() => {
    outboundConns = new Map();

    // Mock TemplateHashProvider
    mockTemplateHashProvider = {
      getRenderedHashForSession: (sessionId: string, templateName: string) => {
        // Mock data: session1 uses hash1 for template1
        if (sessionId === 'session1' && templateName === 'template1') {
          return 'hash1';
        }
        if (sessionId === 'session2' && templateName === 'template1') {
          return 'hash2';
        }
        return undefined;
      },
      getAllRenderedHashesForSession: (sessionId: string) => {
        // Mock data: session1 has mappings
        if (sessionId === 'session1') {
          return new Map([
            ['template1', 'hash1'],
            ['template2', 'hash2'],
          ]);
        }
        if (sessionId === 'session2') {
          return new Map([['template1', 'hash2']]);
        }
        return undefined;
      },
    };
  });

  describe('resolve', () => {
    it('should resolve static server by name (no colon)', () => {
      outboundConns.set('static-server', createMockConnection('static-server'));
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.resolve('static-server');

      expect(result).toBeDefined();
      expect(result?.name).toBe('static-server');
    });

    it('should resolve per-client template server (name:sessionId)', () => {
      outboundConns.set('template:session1', createMockConnection('template'));
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.resolve('template', 'session1');

      expect(result).toBeDefined();
      expect(result?.name).toBe('template');
    });

    it('should resolve shareable template server (name:renderedHash)', () => {
      // Setup: template1:hash1 in connections, session1 maps to hash1
      outboundConns.set('template1:hash1', createMockConnection('template1'));
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const result = resolver.resolve('template1', 'session1');

      expect(result).toBeDefined();
      expect(result?.name).toBe('template1');
    });

    it('should prioritize per-client over shareable (session key first)', () => {
      // Both keys exist, session key should be tried first
      outboundConns.set('template1:session1', createMockConnection('template1-session'));
      outboundConns.set('template1:hash1', createMockConnection('template1-hash'));
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const result = resolver.resolve('template1', 'session1');

      // Should get the session-specific one
      expect(result).toBeDefined();
      expect(result?.name).toBe('template1-session');
    });

    it('should fall back to static server if session keys not found', () => {
      outboundConns.set('server', createMockConnection('server'));
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      // Try with session that doesn't have mappings
      const result = resolver.resolve('server', 'unknown-session');

      expect(result).toBeDefined();
      expect(result?.name).toBe('server');
    });

    it('should return undefined if no connection found', () => {
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.resolve('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should handle missing sessionId gracefully', () => {
      outboundConns.set('server', createMockConnection('server'));
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.resolve('server', undefined);

      expect(result).toBeDefined();
      expect(result?.name).toBe('server');
    });

    it('should handle missing templateHashProvider gracefully', () => {
      outboundConns.set('server', createMockConnection('server'));
      const resolver = new ConnectionResolver(outboundConns); // No provider

      const result = resolver.resolve('server', 'session1');

      // Should fall back to direct name lookup
      expect(result).toBeDefined();
      expect(result?.name).toBe('server');
    });
  });

  describe('filterForSession', () => {
    beforeEach(() => {
      // Setup mixed connections
      outboundConns.set('static1', createMockConnection('static1'));
      outboundConns.set('static2', createMockConnection('static2'));
      outboundConns.set('template1:session1', createMockConnection('template1'));
      outboundConns.set('template1:hash1', createMockConnection('template1'));
      outboundConns.set('template2:hash2', createMockConnection('template2'));
      outboundConns.set('template3:session2', createMockConnection('template3'));
    });

    it('should include all static servers (no session filtering)', () => {
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession('session1');

      expect(filtered.has('static1')).toBe(true);
      expect(filtered.has('static2')).toBe(true);
    });

    it('should include per-client template servers matching sessionId', () => {
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession('session1');

      expect(filtered.has('template1:session1')).toBe(true);
      expect(filtered.has('template3:session2')).toBe(false); // Different session
    });

    it('should include shareable template servers used by session', () => {
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession('session1');

      // session1 maps template1->hash1 and template2->hash2
      expect(filtered.has('template1:hash1')).toBe(true);
      expect(filtered.has('template2:hash2')).toBe(true);
    });

    it('should exclude shareable template servers not used by session', () => {
      // Add another hash-based connection not used by session1
      outboundConns.set('template4:hash4', createMockConnection('template4'));
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession('session1');

      expect(filtered.has('template4:hash4')).toBe(false);
    });

    it('should handle undefined sessionId (include only static)', () => {
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession(undefined);

      expect(filtered.has('static1')).toBe(true);
      expect(filtered.has('static2')).toBe(true);
      expect(filtered.has('template1:session1')).toBe(false);
      expect(filtered.has('template1:hash1')).toBe(false);
    });

    it('should handle missing templateHashProvider (no shareable matching)', () => {
      const resolver = new ConnectionResolver(outboundConns); // No provider

      const filtered = resolver.filterForSession('session1');

      // Should include static and exact session matches, but no hash-based
      expect(filtered.has('static1')).toBe(true);
      expect(filtered.has('template1:session1')).toBe(true);
      expect(filtered.has('template1:hash1')).toBe(false); // Can't match without provider
    });

    it('should return correct count of filtered connections', () => {
      const resolver = new ConnectionResolver(outboundConns, mockTemplateHashProvider);

      const filtered = resolver.filterForSession('session1');

      // Should have: static1, static2, template1:session1, template1:hash1, template2:hash2
      expect(filtered.size).toBe(5);
    });
  });

  describe('createConnectionResolver factory', () => {
    it('should create ConnectionResolver with provider', () => {
      const resolver = createConnectionResolver(outboundConns, mockTemplateHashProvider);

      expect(resolver).toBeInstanceOf(ConnectionResolver);
    });

    it('should create ConnectionResolver without provider', () => {
      const resolver = createConnectionResolver(outboundConns);

      expect(resolver).toBeInstanceOf(ConnectionResolver);
    });

    it('should create functional resolver', () => {
      outboundConns.set('test', createMockConnection('test'));
      const resolver = createConnectionResolver(outboundConns);

      const result = resolver.resolve('test');

      expect(result).toBeDefined();
      expect(result?.name).toBe('test');
    });
  });

  describe('findByServerName', () => {
    it('should find static server by direct name lookup', () => {
      outboundConns.set('static-server', createMockConnection('static-server'));
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.findByServerName('static-server');

      expect(result).toBeDefined();
      expect(result?.key).toBe('static-server');
      expect(result?.connection.name).toBe('static-server');
    });

    it('should find template server by connection.name match', () => {
      // Template server stored with hash-suffixed key but connection.name is clean
      const conn = createMockConnection('template-server');
      outboundConns.set('template-server:abc123', conn);
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.findByServerName('template-server');

      expect(result).toBeDefined();
      expect(result?.key).toBe('template-server:abc123');
      expect(result?.connection.name).toBe('template-server');
    });

    it('should find template server by key prefix match', () => {
      // Template server where connection.name might not match
      const conn = createMockConnection('different-name');
      outboundConns.set('template-server:session123', conn);
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.findByServerName('template-server');

      expect(result).toBeDefined();
      expect(result?.key).toBe('template-server:session123');
    });

    it('should return undefined if server not found', () => {
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.findByServerName('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should prioritize direct name lookup over pattern matching', () => {
      // Both direct key and hash-suffixed key exist
      const directConn = createMockConnection('server-direct');
      const hashConn = createMockConnection('server');
      outboundConns.set('server', directConn);
      outboundConns.set('server:hash123', hashConn);
      const resolver = new ConnectionResolver(outboundConns);

      const result = resolver.findByServerName('server');

      expect(result).toBeDefined();
      expect(result?.key).toBe('server');
      expect(result?.connection.name).toBe('server-direct');
    });

    it('should work without templateHashProvider', () => {
      outboundConns.set('server:hash', createMockConnection('server'));
      const resolver = new ConnectionResolver(outboundConns); // No provider

      const result = resolver.findByServerName('server');

      expect(result).toBeDefined();
      expect(result?.key).toBe('server:hash');
    });
  });

  describe('filterForSession key validation', () => {
    it('should handle keys with empty segments gracefully', () => {
      const outboundConns = new Map([
        [':emptyname', createMockConnection('empty')],
        ['emptyvalue:', createMockConnection('empty')],
        ['::doublecolon', createMockConnection('double')],
      ]) as OutboundConnections;

      const resolver = new ConnectionResolver(outboundConns);

      // Should not throw
      expect(() => resolver.filterForSession('session1')).not.toThrow();

      const filtered = resolver.filterForSession('session1');
      // All malformed keys should be skipped
      expect(filtered.size).toBe(0);
    });

    it('should validate split result has exactly 2 parts', () => {
      const outboundConns = new Map([
        ['valid:key', createMockConnection('valid')],
        ['invalid', createMockConnection('invalid')],
        ['template1:session1', createMockConnection('template1')],
      ]) as OutboundConnections;

      const resolver = new ConnectionResolver(outboundConns);

      // Should not throw
      expect(() => resolver.filterForSession('session1')).not.toThrow();

      const filtered = resolver.filterForSession('session1');
      // Static server without colon should be included
      expect(filtered.has('invalid')).toBe(true);
      // Template server matching sessionId should be included
      expect(filtered.has('template1:session1')).toBe(true);
      // Template server not matching sessionId should be excluded
      expect(filtered.has('valid:key')).toBe(false);
    });
  });
});
