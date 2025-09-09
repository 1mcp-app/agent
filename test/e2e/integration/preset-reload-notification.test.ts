import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { PresetManager } from '../../../src/utils/presetManager.js';
import { PresetNotificationService } from '../../../src/utils/presetNotificationService.js';
import { McpConfigManager } from '../../../src/config/mcpConfigManager.js';

// Mock dependencies
vi.mock('../../../src/config/mcpConfigManager.js', () => ({
  McpConfigManager: {
    getInstance: vi.fn(),
  },
}));

describe('Preset Reload Notification Integration', () => {
  let tempConfigDir: string;
  let presetsFilePath: string;
  let mockMcpConfig: any;
  let notificationService: PresetNotificationService;
  let presetManager: PresetManager;
  let notificationSpy: any;

  beforeEach(async () => {
    // Create temporary config directory
    tempConfigDir = join(tmpdir(), `preset-test-${randomBytes(4).toString('hex')}`);
    await fs.mkdir(tempConfigDir, { recursive: true });
    presetsFilePath = join(tempConfigDir, 'presets.json');

    // Reset singletons
    PresetManager.resetInstance();
    (PresetNotificationService as any).instance = null;

    // Mock MCP config manager
    mockMcpConfig = {
      getTransportConfig: vi.fn().mockReturnValue({
        'web-server': {
          command: 'node',
          args: ['web-server.js'],
          tags: ['web', 'frontend'],
        },
        'api-server': {
          command: 'node',
          args: ['api-server.js'],
          tags: ['api', 'backend'],
        },
        'db-server': {
          command: 'node',
          args: ['db-server.js'],
          tags: ['database', 'backend'],
        },
      }),
    };
    (McpConfigManager.getInstance as any).mockReturnValue(mockMcpConfig);

    // Initialize services
    notificationService = PresetNotificationService.getInstance();
    presetManager = PresetManager.getInstance(tempConfigDir);
    await presetManager.initialize();

    // Setup notification spy
    notificationSpy = vi.fn();
    notificationService.on('preset_notifications_sent', notificationSpy);

    // Connect preset manager to notification service
    presetManager.onPresetChange(async (presetName: string) => {
      await notificationService.notifyPresetChange(presetName);
    });
  });

  afterEach(async () => {
    // Cleanup
    if (presetManager) {
      await presetManager.cleanup();
    }
    try {
      await fs.rm(tempConfigDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should detect server list changes and notify clients (file watcher test)', async () => {
    // 1. Create initial preset
    await presetManager.savePreset('development', {
      description: 'Development servers',
      strategy: 'or',
      tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }] },
    });

    // 2. Register mock clients
    const clientNotifications: Array<{ method: string; params?: any }> = [];

    const mockClient1 = {
      id: 'client-1',
      presetName: 'development',
      sendNotification: vi.fn(async (method: string, params?: any) => {
        clientNotifications.push({ method, params });
      }),
      isConnected: () => true,
    };

    const mockClient2 = {
      id: 'client-2',
      presetName: 'development',
      sendNotification: vi.fn(async (method: string, params?: any) => {
        clientNotifications.push({ method, params });
      }),
      isConnected: () => true,
    };

    notificationService.trackClient(mockClient1, 'development');
    notificationService.trackClient(mockClient2, 'development');

    // 3. Verify initial preset results
    const initialResult = await presetManager.testPreset('development');
    expect(initialResult.servers.sort()).toEqual(['api-server', 'web-server']);

    // Clear initial notifications from preset creation
    clientNotifications.length = 0;

    // 4. Modify preset file directly (simulating external modification)
    const newPresetData = {
      version: '1.0.0',
      presets: {
        development: {
          name: 'development',
          description: 'Development servers with database',
          strategy: 'or',
          tagQuery: { $or: [{ tag: 'web' }, { tag: 'api' }, { tag: 'database' }] },
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
      },
    };

    await fs.writeFile(presetsFilePath, JSON.stringify(newPresetData, null, 2));

    // 5. Wait for file watcher to detect changes and process them
    let attempts = 0;
    const maxAttempts = 20; // 2 seconds max wait

    while (clientNotifications.length === 0 && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    // 6. Verify preset was reloaded with new server list
    const updatedResult = await presetManager.testPreset('development');
    expect(updatedResult.servers.sort()).toEqual(['api-server', 'db-server', 'web-server']);

    // 7. Verify clients were notified
    expect(clientNotifications.length).toBeGreaterThan(0);

    // Check that listChanged notifications were sent
    const notificationMethods = clientNotifications.map((n) => n.method);
    expect(notificationMethods).toContain('notifications/tools/listChanged');
    expect(notificationMethods).toContain('notifications/resources/listChanged');
    expect(notificationMethods).toContain('notifications/prompts/listChanged');

    // Verify both clients received notifications
    expect(mockClient1.sendNotification).toHaveBeenCalled();
    expect(mockClient2.sendNotification).toHaveBeenCalled();

    // 8. Verify notification service event was emitted
    expect(notificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        presetName: 'development',
        clientCount: 2,
      }),
    );
  });

  it('should not notify clients when server list does not change', async () => {
    // 1. Create initial preset
    await presetManager.savePreset('production', {
      description: 'Production servers',
      strategy: 'and',
      tagQuery: { $and: [{ tag: 'backend' }] },
    });

    // 2. Register mock client
    const clientNotifications: Array<{ method: string; params?: any }> = [];

    const mockClient = {
      id: 'client-prod',
      presetName: 'production',
      sendNotification: vi.fn(async (method: string, params?: any) => {
        clientNotifications.push({ method, params });
      }),
      isConnected: () => true,
    };

    notificationService.trackClient(mockClient, 'production');

    // 3. Modify preset file with same server list (only change description)
    const modifiedPresetData = {
      version: '1.0.0',
      presets: {
        production: {
          name: 'production',
          description: 'Production servers - updated description',
          strategy: 'and',
          tagQuery: { $and: [{ tag: 'backend' }] },
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
      },
    };

    await fs.writeFile(presetsFilePath, JSON.stringify(modifiedPresetData, null, 2));

    // 4. Wait for file watcher to detect changes
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 5. Verify no notifications were sent since server list didn't change
    expect(clientNotifications).toHaveLength(0);
    expect(mockClient.sendNotification).not.toHaveBeenCalled();
  });

  it('should handle preset deletion gracefully', async () => {
    // 1. Create preset and register client
    await presetManager.savePreset('staging', {
      description: 'Staging servers',
      strategy: 'or',
      tagQuery: { tag: 'web' },
    });

    const mockClient = {
      id: 'client-staging',
      presetName: 'staging',
      sendNotification: vi.fn(),
      isConnected: () => true,
    };

    notificationService.trackClient(mockClient, 'staging');

    // 2. Delete preset by writing empty preset file
    const emptyPresetData = {
      version: '1.0.0',
      presets: {},
    };

    await fs.writeFile(presetsFilePath, JSON.stringify(emptyPresetData, null, 2));

    // 3. Wait for file watcher to detect changes
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Verify preset no longer exists
    expect(presetManager.hasPreset('staging')).toBe(false);

    // 5. Note: We don't notify clients for deleted presets as they'll handle
    // the error gracefully when they try to use the preset
    expect(mockClient.sendNotification).not.toHaveBeenCalled();
  });

  it.skip('should handle multiple presets changing simultaneously', async () => {
    // 1. Create multiple presets
    await presetManager.savePreset('preset1', {
      description: 'First preset',
      strategy: 'or',
      tagQuery: { tag: 'web' },
    });

    await presetManager.savePreset('preset2', {
      description: 'Second preset',
      strategy: 'or',
      tagQuery: { tag: 'api' },
    });

    // 2. Register clients for different presets
    const client1Notifications: any[] = [];
    const client2Notifications: any[] = [];

    const mockClient1 = {
      id: 'client-1',
      presetName: 'preset1',
      sendNotification: vi.fn(async (method: string, params?: any) => {
        client1Notifications.push({ method, params });
      }),
      isConnected: () => true,
    };

    const mockClient2 = {
      id: 'client-2',
      presetName: 'preset2',
      sendNotification: vi.fn(async (method: string, params?: any) => {
        client2Notifications.push({ method, params });
      }),
      isConnected: () => true,
    };

    notificationService.trackClient(mockClient1, 'preset1');
    notificationService.trackClient(mockClient2, 'preset2');

    // 3. Modify both presets to change their server lists
    const updatedPresetsData = {
      version: '1.0.0',
      presets: {
        preset1: {
          name: 'preset1',
          description: 'First preset - updated',
          strategy: 'or',
          tagQuery: { $or: [{ tag: 'web' }, { tag: 'database' }] }, // Added database
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
        preset2: {
          name: 'preset2',
          description: 'Second preset - updated',
          strategy: 'or',
          tagQuery: { $or: [{ tag: 'api' }, { tag: 'database' }] }, // Added database to change server list
          created: new Date().toISOString(),
          lastModified: new Date().toISOString(),
        },
      },
    };

    await fs.writeFile(presetsFilePath, JSON.stringify(updatedPresetsData, null, 2));

    // 4. Call reload directly to test the logic
    await (presetManager as any).reloadAndNotifyChanges();

    // 5. Verify both clients received notifications
    expect(client1Notifications.length).toBeGreaterThan(0);
    expect(client2Notifications.length).toBeGreaterThan(0);

    expect(mockClient1.sendNotification).toHaveBeenCalled();
    expect(mockClient2.sendNotification).toHaveBeenCalled();
  });
});
