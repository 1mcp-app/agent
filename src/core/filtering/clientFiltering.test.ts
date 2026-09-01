import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnections } from '@src/core/types/index.js';

import { describe, expect, it } from 'vitest';

import {
  byCapabilities,
  byTags,
  filterClients,
  filterClientsByCapabilities,
  filterClientsByTags,
} from './clientFiltering.js';

describe('Client Filtering Utils', () => {
  const mockClients: OutboundConnections = new Map();
  mockClients.set(
    'client1',
    createMockOutboundConnection({
      name: 'client1',
      capabilities: {
        resources: {},
        tools: {},
      },
      tags: ['tag1', 'tag2'],
      status: ClientStatus.Connected,
    }),
  );
  mockClients.set(
    'client2',
    createMockOutboundConnection({
      name: 'client2',
      capabilities: {
        resources: {},
      },
      tags: ['tag1'],
      status: ClientStatus.Connected,
    }),
  );
  mockClients.set(
    'client3',
    createMockOutboundConnection({
      name: 'client3',
      capabilities: {
        tools: {},
      },
      tags: ['tag3'],
      status: ClientStatus.Connected,
    }),
  );
  mockClients.set(
    'clientNoCapabilities',
    createMockOutboundConnection({
      name: 'clientNoCapabilities',
      tags: ['tag1'],
      status: ClientStatus.Connected,
    }),
  );
  mockClients.set(
    'clientNoTags',
    createMockOutboundConnection({
      name: 'clientNoTags',
      capabilities: {
        resources: {},
      },
      tags: [],
      status: ClientStatus.Connected,
    }),
  );

  describe('filterClientsByCapabilities', () => {
    it('should filter clients by single capability', () => {
      const filtered = filterClientsByCapabilities(mockClients, { resources: {} });
      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2', 'clientNoTags']);
    });

    it('should filter clients by multiple capabilities', () => {
      const filtered = filterClientsByCapabilities(mockClients, { resources: {}, tools: {} });
      expect(Array.from(filtered.keys())).toEqual(['client1']);
    });

    it('should handle clients with no capabilities', () => {
      const filtered = filterClientsByCapabilities(mockClients, { resources: {} });
      expect(filtered.has('clientNoCapabilities')).toBe(false);
    });

    it('should return empty object when no matches found', () => {
      const filtered = filterClientsByCapabilities(mockClients, { nonexistent: {} } as ServerCapabilities);
      expect(Array.from(filtered.keys())).toHaveLength(0);
    });
  });

  describe('filterClientsByTags', () => {
    it('should return all clients when no tags provided', () => {
      const filtered = filterClientsByTags(mockClients, undefined);
      expect(Array.from(filtered.keys())).toEqual(Array.from(mockClients.keys()));
    });

    it('should filter clients by single tag', () => {
      const filtered = filterClientsByTags(mockClients, ['tag1']);
      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2', 'clientNoCapabilities']);
    });

    it('should filter clients by multiple tags (any match)', () => {
      const filtered = filterClientsByTags(mockClients, ['tag1', 'tag2']);
      // Should include clients that have ANY of the specified tags
      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2', 'clientNoCapabilities']);
    });

    it('should handle clients with no tags', () => {
      const filtered = filterClientsByTags(mockClients, ['tag1']);
      expect(filtered.has('clientNoTags')).toBe(false);
    });

    it('should return empty object when no matches found', () => {
      const filtered = filterClientsByTags(mockClients, ['nonexistent']);
      expect(Array.from(filtered.keys())).toHaveLength(0);
    });
  });

  describe('filterClients (composed filters)', () => {
    it('should chain multiple filters together', () => {
      const filtered = filterClients(byCapabilities({ resources: {} }), byTags(['tag1']))(mockClients);

      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2']);
    });

    it('should handle empty filters array', () => {
      const filtered = filterClients()(mockClients);
      expect(Array.from(filtered.keys())).toEqual(Array.from(mockClients.keys()));
    });

    it('should handle no matching results', () => {
      const filtered = filterClients(byCapabilities({ resources: {} }), byTags(['tag3']))(mockClients);

      // Only client3 has tag3, but it doesn't have resources capability
      expect(Array.from(filtered.keys())).toHaveLength(0);
    });
  });

  describe('byCapabilities', () => {
    it('should create a filter function for capabilities', () => {
      const filter = byCapabilities({ resources: {} });
      const filtered = filter(mockClients);
      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2', 'clientNoTags']);
    });

    it('should handle undefined capabilities safely', () => {
      const filter = byCapabilities({ resources: {} });
      const testClients = new Map(mockClients);
      testClients.set(
        'unsafeClient',
        createMockOutboundConnection({
          name: 'unsafeClient',
          status: ClientStatus.Connected,
        }),
      );
      const filtered = filter(testClients);
      expect(filtered.has('unsafeClient')).toBe(false);
    });
  });

  describe('byTags', () => {
    it('should create a filter function for tags', () => {
      const filter = byTags(['tag1']);
      const filtered = filter(mockClients);
      expect(Array.from(filtered.keys())).toEqual(['client1', 'client2', 'clientNoCapabilities']);
    });

    it('should handle undefined tags array', () => {
      const filter = byTags(undefined);
      const filtered = filter(mockClients);
      expect(Array.from(filtered.keys())).toEqual(Array.from(mockClients.keys()));
    });

    it('should handle empty tags array', () => {
      const filter = byTags([]);
      const filtered = filter(mockClients);
      expect(Array.from(filtered.keys())).toEqual(Array.from(mockClients.keys()));
    });
  });

  describe('filterClients bug reproduction - zero length results', () => {
    it('should find clients with tools capability matching any server tag', () => {
      // Reproduces the bug: filterClients(byCapabilities({ tools: {} }), byTags(serverInfo.tags))(clients)
      // was returning zero length because tag filtering required ALL tags instead of ANY tag
      const serverInfoTags = ['tag1']; // Example server tags
      const filteredClients = filterClients(byCapabilities({ tools: {} }), byTags(serverInfoTags))(mockClients);

      // Should find client1 (has tools capability AND tag1)
      expect(Array.from(filteredClients.keys())).toEqual(['client1']);
      expect(filteredClients.size).toBeGreaterThan(0);
    });

    it('should handle edge case with empty clients map', () => {
      const emptyClients = new Map();
      const filteredClients = filterClients(byCapabilities({ tools: {} }), byTags(['tag1']))(emptyClients);

      expect(Array.from(filteredClients.keys())).toEqual([]);
      expect(filteredClients.size).toBe(0);
    });

    it('should handle edge case with no matching tags', () => {
      const filteredClients = filterClients(byCapabilities({ tools: {} }), byTags(['nonexistent-tag']))(mockClients);

      expect(Array.from(filteredClients.keys())).toEqual([]);
      expect(filteredClients.size).toBe(0);
    });

    it('should handle edge case with no tools capability', () => {
      const clientsWithoutTools = new Map();
      clientsWithoutTools.set(
        'client1',
        createMockOutboundConnection({
          name: 'client1',
          capabilities: {
            resources: {},
            // No tools capability
          },
          tags: ['tag1'],
          status: ClientStatus.Connected,
        }),
      );

      const filteredClients = filterClients(byCapabilities({ tools: {} }), byTags(['tag1']))(clientsWithoutTools);

      expect(Array.from(filteredClients.keys())).toEqual([]);
      expect(filteredClients.size).toBe(0);
    });
  });
});
