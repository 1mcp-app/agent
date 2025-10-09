import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PresetNotificationService, ClientConnection } from './presetNotificationService.js';
import logger from '@src/logger/logger.js';

// Mock logger
vi.mock('@src/logger/logger.js');

describe('PresetNotificationService', () => {
  let service: PresetNotificationService;
  let mockClient1: ClientConnection;
  let mockClient2: ClientConnection;
  let mockClient3: ClientConnection;

  beforeEach(() => {
    vi.clearAllMocks();

    // Get fresh instance for each test
    (PresetNotificationService as any).instance = null;
    service = PresetNotificationService.getInstance();

    // Create mock clients
    mockClient1 = {
      id: 'client-1',
      sendNotification: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };

    mockClient2 = {
      id: 'client-2',
      sendNotification: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };

    mockClient3 = {
      id: 'client-3',
      sendNotification: vi.fn().mockResolvedValue(true),
      isConnected: vi.fn().mockReturnValue(false), // Disconnected client
    };
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = PresetNotificationService.getInstance();
      const instance2 = PresetNotificationService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('trackClient', () => {
    it('should track client without preset', () => {
      service.trackClient(mockClient1);

      const stats = service.getStats();
      expect(stats.totalClients).toBe(1);
      expect(stats.presetCount).toBe(0);
      expect(stats.clientsByPreset).toEqual({});
    });

    it('should track client with preset', () => {
      service.trackClient(mockClient1, 'development');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(1);
      expect(stats.presetCount).toBe(1);
      expect(stats.clientsByPreset).toEqual({ development: 1 });
      expect(mockClient1.presetName).toBe('development');
    });

    it('should track multiple clients for same preset', () => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'development');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.presetCount).toBe(1);
      expect(stats.clientsByPreset).toEqual({ development: 2 });
    });

    it('should track clients for different presets', () => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'production');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.presetCount).toBe(2);
      expect(stats.clientsByPreset).toEqual({
        development: 1,
        production: 1,
      });
    });

    it('should emit client_tracked event', () => {
      const eventHandler = vi.fn();
      service.on('client_tracked', eventHandler);

      service.trackClient(mockClient1, 'development');

      expect(eventHandler).toHaveBeenCalledWith({
        client: mockClient1,
        presetName: 'development',
      });
    });
  });

  describe('untrackClient', () => {
    beforeEach(() => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'development');
      service.trackClient(mockClient3, 'production');
    });

    it('should untrack client and update stats', () => {
      service.untrackClient('client-1');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.clientsByPreset).toEqual({
        development: 1,
        production: 1,
      });
    });

    it('should remove empty preset groups', () => {
      service.untrackClient('client-3');

      const stats = service.getStats();
      expect(stats.presetCount).toBe(1);
      expect(stats.clientsByPreset).toEqual({ development: 2 });
    });

    it('should handle untracking non-existent client gracefully', () => {
      service.untrackClient('non-existent');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(3);
    });

    it('should emit client_untracked event', () => {
      const eventHandler = vi.fn();
      service.on('client_untracked', eventHandler);

      service.untrackClient('client-1');

      expect(eventHandler).toHaveBeenCalledWith({
        clientId: 'client-1',
        presetName: 'development',
      });
    });
  });

  describe('updateClientPreset', () => {
    beforeEach(() => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'production');
    });

    it('should update client preset', () => {
      service.updateClientPreset('client-1', 'staging');

      expect(mockClient1.presetName).toBe('staging');
      const stats = service.getStats();
      expect(stats.clientsByPreset).toEqual({
        production: 1,
        staging: 1,
      });
    });

    it('should remove client from preset when set to undefined', () => {
      service.updateClientPreset('client-1', undefined);

      expect(mockClient1.presetName).toBeUndefined();
      const stats = service.getStats();
      expect(stats.clientsByPreset).toEqual({
        production: 1,
      });
    });

    it('should handle updating non-existent client', () => {
      service.updateClientPreset('non-existent', 'new-preset');

      expect(logger.warn).toHaveBeenCalledWith('Attempted to update preset for unknown client', {
        clientId: 'non-existent',
      });
    });

    it('should emit client_preset_updated event', () => {
      const eventHandler = vi.fn();
      service.on('client_preset_updated', eventHandler);

      service.updateClientPreset('client-1', 'staging');

      expect(eventHandler).toHaveBeenCalledWith({
        clientId: 'client-1',
        oldPresetName: 'development',
        newPresetName: 'staging',
      });
    });
  });

  describe('notifyPresetChange', () => {
    beforeEach(() => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'development');
      service.trackClient(mockClient3, 'production');
    });

    it('should send notifications to all clients of preset', async () => {
      await service.notifyPresetChange('development');

      // Should send 3 types of notifications to each client
      expect(mockClient1.sendNotification).toHaveBeenCalledTimes(3);
      expect(mockClient1.sendNotification).toHaveBeenCalledWith('notifications/tools/listChanged');
      expect(mockClient1.sendNotification).toHaveBeenCalledWith('notifications/resources/listChanged');
      expect(mockClient1.sendNotification).toHaveBeenCalledWith('notifications/prompts/listChanged');

      expect(mockClient2.sendNotification).toHaveBeenCalledTimes(3);
      expect(mockClient3.sendNotification).not.toHaveBeenCalled();
    });

    it('should skip disconnected clients', async () => {
      service.trackClient(mockClient3, 'development');

      await service.notifyPresetChange('development');

      expect(mockClient1.sendNotification).toHaveBeenCalledTimes(3);
      expect(mockClient2.sendNotification).toHaveBeenCalledTimes(3);
      expect(mockClient3.sendNotification).not.toHaveBeenCalled();
    });

    it('should handle notification errors gracefully', async () => {
      (mockClient1.sendNotification as any).mockRejectedValue(new Error('Connection error'));

      await expect(service.notifyPresetChange('development')).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send preset change notification to client',
        expect.objectContaining({
          clientId: 'client-1',
          presetName: 'development',
        }),
      );
    });

    it('should untrack clients with connection errors', async () => {
      const connectionError = new Error('Connection closed');
      (mockClient1.sendNotification as any).mockRejectedValue(connectionError);

      await service.notifyPresetChange('development');

      const stats = service.getStats();
      expect(stats.totalClients).toBe(2); // client-1 should be removed
      expect(stats.clientsByPreset.development).toBe(1);
    });

    it('should handle empty preset gracefully', async () => {
      await service.notifyPresetChange('nonexistent');

      expect(logger.debug).toHaveBeenCalledWith('No clients to notify for preset change', {
        presetName: 'nonexistent',
      });
    });

    it('should emit preset_notifications_sent event', async () => {
      const eventHandler = vi.fn();
      service.on('preset_notifications_sent', eventHandler);

      await service.notifyPresetChange('development');

      expect(eventHandler).toHaveBeenCalledWith({
        presetName: 'development',
        clientCount: 2,
      });
    });
  });

  describe('cleanup', () => {
    beforeEach(() => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'production');
      service.trackClient(mockClient3, 'development'); // Disconnected
    });

    it('should remove disconnected clients', async () => {
      const removedCount = await service.cleanup();

      expect(removedCount).toBe(1);
      const stats = service.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.clientsByPreset.development).toBe(1);
    });

    it('should log cleanup results', async () => {
      await service.cleanup();

      expect(logger.info).toHaveBeenCalledWith('Cleaned up disconnected clients', { removedCount: 1 });
    });

    it('should return 0 if no cleanup needed', async () => {
      (mockClient3.isConnected as any).mockReturnValue(true);

      const removedCount = await service.cleanup();

      expect(removedCount).toBe(0);
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Cleaned up'), expect.anything());
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      service.trackClient(mockClient1, 'development');
      service.trackClient(mockClient2, 'development');
      service.trackClient(mockClient3, 'production');
    });

    describe('getClientsForPreset', () => {
      it('should return clients for existing preset', () => {
        const clients = service.getClientsForPreset('development');
        expect(clients).toHaveLength(2);
        expect(clients.map((c) => c.id)).toEqual(['client-1', 'client-2']);
      });

      it('should return empty array for non-existent preset', () => {
        const clients = service.getClientsForPreset('nonexistent');
        expect(clients).toEqual([]);
      });
    });

    describe('hasClientsForPreset', () => {
      it('should return true for preset with clients', () => {
        expect(service.hasClientsForPreset('development')).toBe(true);
      });

      it('should return false for preset without clients', () => {
        expect(service.hasClientsForPreset('nonexistent')).toBe(false);
      });
    });

    describe('getTrackedPresets', () => {
      it('should return all tracked preset names', () => {
        const presets = service.getTrackedPresets();
        expect(presets.sort()).toEqual(['development', 'production']);
      });

      it('should return empty array when no presets tracked', () => {
        service.untrackClient('client-1');
        service.untrackClient('client-2');
        service.untrackClient('client-3');

        const presets = service.getTrackedPresets();
        expect(presets).toEqual([]);
      });
    });

    describe('getStats', () => {
      it('should return accurate statistics', () => {
        const stats = service.getStats();
        expect(stats).toEqual({
          totalClients: 3,
          presetCount: 2,
          clientsByPreset: {
            development: 2,
            production: 1,
          },
        });
      });
    });
  });
});
