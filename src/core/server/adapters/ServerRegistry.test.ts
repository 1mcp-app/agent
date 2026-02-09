import type { TemplateServerManager } from '@src/core/server/templateServerManager.js';
import { ClientStatus, OutboundConnection, OutboundConnections } from '@src/core/types/client.js';
import { MCPServerParams } from '@src/core/types/index.js';

import { beforeEach, describe, expect, it } from 'vitest';

import { ExternalServerAdapter } from './ExternalServerAdapter.js';
import { ServerRegistry } from './ServerRegistry.js';
import { TemplateServerAdapter } from './TemplateServerAdapter.js';
import { ServerType } from './types.js';

describe('ServerRegistry', () => {
  let outboundConns: OutboundConnections;
  let mockTemplateManager: TemplateServerManager;
  let registry: ServerRegistry;

  const createMockConnection = (name: string, status: ClientStatus = ClientStatus.Connected): OutboundConnection => ({
    name,
    transport: {} as any,
    client: {} as any,
    status,
  });

  const createServerConfig = (): MCPServerParams => ({
    command: 'node',
    args: ['server.js'],
  });

  beforeEach(() => {
    outboundConns = new Map();
    mockTemplateManager = {
      getRenderedHashForSession: (sessionId: string, templateName: string) => {
        if (sessionId === 'session1' && templateName === 'template1') {
          return 'hash1';
        }
        return undefined;
      },
    } as any;
    registry = new ServerRegistry(outboundConns, mockTemplateManager);
  });

  describe('registerExternal', () => {
    it('should register external server adapter', () => {
      const config = createServerConfig();
      registry.registerExternal('external1', config);

      expect(registry.has('external1')).toBe(true);
      const adapter = registry.get('external1');
      expect(adapter).toBeInstanceOf(ExternalServerAdapter);
      expect(adapter?.name).toBe('external1');
      expect(adapter?.type).toBe(ServerType.External);
    });

    it('should allow multiple external servers', () => {
      registry.registerExternal('external1', createServerConfig());
      registry.registerExternal('external2', createServerConfig());

      expect(registry.size()).toBe(2);
      expect(registry.has('external1')).toBe(true);
      expect(registry.has('external2')).toBe(true);
    });
  });

  describe('registerTemplate', () => {
    it('should register template server adapter', () => {
      const config = createServerConfig();
      registry.registerTemplate('template1', config);

      expect(registry.has('template1')).toBe(true);
      const adapter = registry.get('template1');
      expect(adapter).toBeInstanceOf(TemplateServerAdapter);
      expect(adapter?.name).toBe('template1');
      expect(adapter?.type).toBe(ServerType.Template);
    });

    it('should throw error if template manager not provided', () => {
      const registryWithoutManager = new ServerRegistry(outboundConns);

      expect(() => {
        registryWithoutManager.registerTemplate('template1', createServerConfig());
      }).toThrow('TemplateServerManager is required');
    });
  });

  describe('register', () => {
    it('should register adapter directly', () => {
      const adapter = new ExternalServerAdapter('custom', createServerConfig(), outboundConns);
      registry.register(adapter);

      expect(registry.has('custom')).toBe(true);
      expect(registry.get('custom')).toBe(adapter);
    });
  });

  describe('get and has', () => {
    it('should return undefined for unregistered server', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
      expect(registry.has('nonexistent')).toBe(false);
    });

    it('should retrieve registered adapter', () => {
      registry.registerExternal('server1', createServerConfig());

      const adapter = registry.get('server1');
      expect(adapter).toBeDefined();
      expect(adapter?.name).toBe('server1');
    });
  });

  describe('resolveConnection', () => {
    it('should resolve external server connection', () => {
      const conn = createMockConnection('external1');
      outboundConns.set('external1', conn);
      registry.registerExternal('external1', createServerConfig());

      const result = registry.resolveConnection('external1');

      expect(result).toBe(conn);
    });

    it('should resolve template server connection with session', () => {
      const conn = createMockConnection('template1');
      outboundConns.set('template1:hash1', conn);
      registry.registerTemplate('template1', createServerConfig());

      const result = registry.resolveConnection('template1', { sessionId: 'session1' });

      expect(result).toBe(conn);
    });

    it('should return undefined for unregistered server', () => {
      const result = registry.resolveConnection('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('getServerNames', () => {
    it('should return empty array when no servers registered', () => {
      expect(registry.getServerNames()).toEqual([]);
    });

    it('should return all registered server names', () => {
      registry.registerExternal('external1', createServerConfig());
      registry.registerExternal('external2', createServerConfig());
      registry.registerTemplate('template1', createServerConfig());

      const names = registry.getServerNames();
      expect(names).toHaveLength(3);
      expect(names).toContain('external1');
      expect(names).toContain('external2');
      expect(names).toContain('template1');
    });
  });

  describe('getAdaptersByType', () => {
    beforeEach(() => {
      registry.registerExternal('external1', createServerConfig());
      registry.registerExternal('external2', createServerConfig());
      registry.registerTemplate('template1', createServerConfig());
      registry.registerTemplate('template2', createServerConfig());
    });

    it('should return external adapters', () => {
      const externals = registry.getAdaptersByType(ServerType.External);

      expect(externals).toHaveLength(2);
      expect(externals.every((a) => a.type === ServerType.External)).toBe(true);
    });

    it('should return template adapters', () => {
      const templates = registry.getAdaptersByType(ServerType.Template);

      expect(templates).toHaveLength(2);
      expect(templates.every((a) => a.type === ServerType.Template)).toBe(true);
    });

    it('should return empty array for internal type', () => {
      const internals = registry.getAdaptersByType(ServerType.Internal);

      expect(internals).toHaveLength(0);
    });
  });

  describe('unregister', () => {
    it('should remove registered server', () => {
      registry.registerExternal('server1', createServerConfig());
      expect(registry.has('server1')).toBe(true);

      const removed = registry.unregister('server1');

      expect(removed).toBe(true);
      expect(registry.has('server1')).toBe(false);
    });

    it('should return false for unregistered server', () => {
      const removed = registry.unregister('nonexistent');

      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all adapters', () => {
      registry.registerExternal('external1', createServerConfig());
      registry.registerTemplate('template1', createServerConfig());
      expect(registry.size()).toBe(2);

      registry.clear();

      expect(registry.size()).toBe(0);
      expect(registry.has('external1')).toBe(false);
      expect(registry.has('template1')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return 0 for empty registry', () => {
      expect(registry.size()).toBe(0);
    });

    it('should return correct count of registered servers', () => {
      registry.registerExternal('external1', createServerConfig());
      expect(registry.size()).toBe(1);

      registry.registerTemplate('template1', createServerConfig());
      expect(registry.size()).toBe(2);

      registry.unregister('external1');
      expect(registry.size()).toBe(1);
    });
  });
});
