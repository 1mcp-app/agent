import { beforeEach, describe, expect, it } from 'vitest';

import { ClientTemplateTracker } from './clientTemplateTracker.js';

describe('ClientTemplateTracker', () => {
  let tracker: ClientTemplateTracker;

  beforeEach(() => {
    tracker = new ClientTemplateTracker();
  });

  describe('addClientTemplate', () => {
    it('should add client-template relationship', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');

      const clientTemplates = tracker.getClientTemplates('client1');
      expect(clientTemplates).toHaveLength(1);
      expect(clientTemplates[0]).toEqual({
        templateName: 'template1',
        instanceId: 'instance1',
      });

      expect(tracker.getClientCount('template1', 'instance1')).toBe(1);
      expect(tracker.hasClients('template1', 'instance1')).toBe(true);
    });

    it('should handle multiple clients for same template instance', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template1', 'instance1');

      expect(tracker.getClientCount('template1', 'instance1')).toBe(2);
      expect(tracker.hasClients('template1', 'instance1')).toBe(true);

      const client1Templates = tracker.getClientTemplates('client1');
      const client2Templates = tracker.getClientTemplates('client2');
      expect(client1Templates).toHaveLength(1);
      expect(client2Templates).toHaveLength(1);
    });

    it('should handle multiple template instances for same client', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client1', 'template2', 'instance2');

      const clientTemplates = tracker.getClientTemplates('client1');
      expect(clientTemplates).toHaveLength(2);
      expect(clientTemplates).toEqual([
        { templateName: 'template1', instanceId: 'instance1' },
        { templateName: 'template2', instanceId: 'instance2' },
      ]);
    });

    it('should handle shareable and perClient options', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1', {
        shareable: true,
        perClient: false,
      });

      const clientTemplates = tracker.getClientTemplates('client1');
      expect(clientTemplates).toHaveLength(1);
    });

    it('should not duplicate relationships', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client1', 'template1', 'instance1'); // Duplicate

      const clientTemplates = tracker.getClientTemplates('client1');
      expect(clientTemplates).toHaveLength(1);
      expect(tracker.getClientCount('template1', 'instance1')).toBe(1);
    });
  });

  describe('removeClient', () => {
    it('should remove client and return instances to cleanup', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client1', 'template2', 'instance2');

      const instancesToCleanup = tracker.removeClient('client1');

      expect(instancesToCleanup).toHaveLength(2);
      expect(instancesToCleanup).toContain('template1:instance1');
      expect(instancesToCleanup).toContain('template2:instance2');

      expect(tracker.getClientTemplates('client1')).toHaveLength(0);
      expect(tracker.getClientCount('template1', 'instance1')).toBe(0);
      expect(tracker.hasClients('template1', 'instance1')).toBe(false);
    });

    it('should handle removing non-existent client', () => {
      const instancesToCleanup = tracker.removeClient('non-existent');

      expect(instancesToCleanup).toHaveLength(0);
    });

    it('should handle shared instances correctly', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template1', 'instance1');

      const instancesToCleanup = tracker.removeClient('client1');

      expect(instancesToCleanup).toHaveLength(0); // Instance still has client2
      expect(tracker.getClientCount('template1', 'instance1')).toBe(1);
      expect(tracker.hasClients('template1', 'instance1')).toBe(true);

      // Remove second client
      const instancesToCleanup2 = tracker.removeClient('client2');
      expect(instancesToCleanup2).toHaveLength(1);
      expect(instancesToCleanup2[0]).toBe('template1:instance1');
    });
  });

  describe('removeClientFromInstance', () => {
    beforeEach(() => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client1', 'template2', 'instance2');
      tracker.addClientTemplate('client2', 'template1', 'instance1');
    });

    it('should remove client from specific instance', () => {
      const shouldCleanup = tracker.removeClientFromInstance('client1', 'template1', 'instance1');

      expect(shouldCleanup).toBe(false); // client2 still uses the instance
      expect(tracker.getClientCount('template1', 'instance1')).toBe(1);

      const client1Templates = tracker.getClientTemplates('client1');
      expect(client1Templates).toHaveLength(1);
      expect(client1Templates[0].templateName).toBe('template2');
    });

    it('should return true when instance should be cleaned up', () => {
      const shouldCleanup = tracker.removeClientFromInstance('client2', 'template1', 'instance1');

      expect(shouldCleanup).toBe(false); // client1 still uses the instance
      expect(tracker.getClientCount('template1', 'instance1')).toBe(1);

      // Now remove the last client
      const shouldCleanup2 = tracker.removeClientFromInstance('client1', 'template1', 'instance1');
      expect(shouldCleanup2).toBe(true); // No more clients for this instance
      expect(tracker.getClientCount('template1', 'instance1')).toBe(0);
    });

    it('should handle non-existent relationship', () => {
      const shouldCleanup = tracker.removeClientFromInstance('client3', 'template3', 'instance3');

      expect(shouldCleanup).toBe(false);
    });
  });

  describe('getTemplateInstances', () => {
    it('should return all instances for a template', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template1', 'instance2');
      tracker.addClientTemplate('client3', 'template2', 'instance3');

      const template1Instances = tracker.getTemplateInstances('template1');
      expect(template1Instances).toHaveLength(2);
      expect(template1Instances).toContain('instance1');
      expect(template1Instances).toContain('instance2');

      const template2Instances = tracker.getTemplateInstances('template2');
      expect(template2Instances).toHaveLength(1);
      expect(template2Instances[0]).toBe('instance3');
    });

    it('should return empty array for non-existent template', () => {
      const instances = tracker.getTemplateInstances('non-existent');
      expect(instances).toHaveLength(0);
    });
  });

  describe('getIdleInstances', () => {
    beforeEach(() => {
      // Add some relationships
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template2', 'instance2');
    });

    it('should identify idle instances', () => {
      // Remove all clients
      tracker.removeClient('client1');
      tracker.removeClient('client2');

      const idleInstances = tracker.getIdleInstances(0); // No timeout

      expect(idleInstances).toHaveLength(2);
      expect(idleInstances[0]).toEqual({
        templateName: 'template1',
        instanceId: 'instance1',
        idleTime: expect.any(Number),
      });
      expect(idleInstances[1]).toEqual({
        templateName: 'template2',
        instanceId: 'instance2',
        idleTime: expect.any(Number),
      });
    });

    it('should respect timeout', () => {
      tracker.removeClient('client1');
      tracker.removeClient('client2');

      const idleInstances = tracker.getIdleInstances(10000); // 10 seconds timeout
      expect(idleInstances).toHaveLength(0); // Should be empty as instances are just created
    });

    it('should not return instances with clients', () => {
      const idleInstances = tracker.getIdleInstances(0); // No timeout
      expect(idleInstances).toHaveLength(0);
    });
  });

  describe('cleanupInstance', () => {
    it('should clean up instance completely', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template1', 'instance1');

      tracker.cleanupInstance('template1', 'instance1');

      expect(tracker.getClientCount('template1', 'instance1')).toBe(0);
      expect(tracker.getClientTemplates('client1')).toHaveLength(0);
      expect(tracker.getClientTemplates('client2')).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should provide comprehensive statistics', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template1', 'instance1');
      tracker.addClientTemplate('client3', 'template2', 'instance2');

      const stats = tracker.getStats();

      expect(stats.totalInstances).toBe(2);
      expect(stats.totalClients).toBe(3);
      expect(stats.totalRelationships).toBe(3);
      expect(stats.idleInstances).toBe(0);
      expect(stats.averageClientsPerInstance).toBe(1.5);
    });

    it('should handle empty tracker', () => {
      const stats = tracker.getStats();

      expect(stats.totalInstances).toBe(0);
      expect(stats.totalClients).toBe(0);
      expect(stats.totalRelationships).toBe(0);
      expect(stats.idleInstances).toBe(0);
      expect(stats.averageClientsPerInstance).toBe(0);
    });
  });

  describe('getDetailedInfo', () => {
    it('should provide detailed debugging information', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1', {
        shareable: true,
        perClient: false,
      });

      const info = tracker.getDetailedInfo();

      expect(info.instances).toHaveLength(1);
      expect(info.instances[0]).toEqual({
        templateName: 'template1',
        instanceId: 'instance1',
        clientCount: 1,
        referenceCount: 1,
        shareable: true,
        perClient: false,
        createdAt: expect.any(Date),
        lastAccessed: expect.any(Date),
      });

      expect(info.clients).toHaveLength(1);
      expect(info.clients[0]).toEqual({
        clientId: 'client1',
        templateCount: 1,
        templates: [
          {
            templateName: 'template1',
            instanceId: 'instance1',
            connectedAt: expect.any(Date),
          },
        ],
      });
    });
  });

  describe('clear', () => {
    it('should clear all tracking data', () => {
      tracker.addClientTemplate('client1', 'template1', 'instance1');
      tracker.addClientTemplate('client2', 'template2', 'instance2');

      tracker.clear();

      expect(tracker.getStats().totalInstances).toBe(0);
      expect(tracker.getStats().totalClients).toBe(0);
      expect(tracker.getClientTemplates('client1')).toHaveLength(0);
      expect(tracker.getClientCount('template1', 'instance1')).toBe(0);
    });
  });
});
