import fs from 'fs';
import path from 'path';

import { DEFAULT_CONFIG } from '@src/constants.js';

import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ConfigChangeEvent, McpConfigManager } from './mcpConfigManager.js';

// Test data
const testConfig = {
  mcpServers: {
    server1: { url: 'http://test1.com' },
    server2: { url: 'http://test2.com' },
  },
};

// Helper function to create an event emitter spy
const createEventEmitterSpy = (instance: McpConfigManager) => {
  return vi.spyOn(instance, 'emit');
};

// Mock modules
vi.mock('fs', async () => {
  return {
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(() => ({ mtime: new Date() })),
      watch: vi.fn(() => ({ close: vi.fn() })),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(() => ({ mtime: new Date() })),
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

// Mock constants
vi.mock('@src/constants.js', () => ({
  __esModule: true,
  DEFAULT_CONFIG: { mcpServers: {} },
  getGlobalConfigPath: vi.fn(),
  getGlobalConfigDir: vi.fn().mockReturnValue('/test'),
}));

describe('McpConfigManager', () => {
  const testConfigPath = '/test/config.json';

  beforeEach(() => {
    // Reset singleton instance
    (McpConfigManager as any).instance = undefined;
    // Default mock implementations
    (fs.existsSync as unknown as MockInstance).mockReturnValue(true);
    (fs.readFileSync as unknown as MockInstance).mockReturnValue(JSON.stringify({ mcpServers: {} }));
    (fs.statSync as unknown as MockInstance).mockReturnValue({ mtime: new Date() });
  });

  describe('getInstance', () => {
    it('should create singleton instance', () => {
      const instance1 = McpConfigManager.getInstance(testConfigPath);
      const instance2 = McpConfigManager.getInstance(testConfigPath);
      expect(instance1).toBe(instance2);
    });

    it('should use provided config path', () => {
      const instance = McpConfigManager.getInstance(testConfigPath);
      expect((instance as any).configFilePath).toBe(testConfigPath);
    });
  });

  describe('ensureConfigExists', () => {
    it('should create config directory and file if they do not exist', () => {
      (fs.existsSync as unknown as MockInstance)
        .mockReturnValueOnce(false) // Directory doesn't exist
        .mockReturnValueOnce(false); // File doesn't exist

      McpConfigManager.getInstance(testConfigPath);

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(testConfigPath), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(testConfigPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    });
  });

  describe('config watching', () => {
    it('should start and stop watching config directory', () => {
      const instance = McpConfigManager.getInstance(testConfigPath);

      instance.startWatching();
      expect(fs.watch).toHaveBeenCalledWith(path.dirname(testConfigPath), expect.any(Function));

      instance.stopWatching();
      expect(instance['configWatcher']).toBeNull();
    });

    it('should reload config on file change', () => {
      // Use fake timers to control debouncing
      vi.useFakeTimers();

      // Mock file modification time change to simulate file being modified
      const originalTime = new Date('2023-01-01T00:00:00Z');
      const newTime = new Date('2023-01-01T00:00:01Z'); // 1 second later

      // Set up the statSync mock sequence
      (fs.statSync as unknown as MockInstance)
        .mockReturnValueOnce({ mtime: originalTime }) // Constructor call to loadConfig
        .mockReturnValueOnce({ mtime: newTime }); // checkFileModified call during watch callback

      const instance = McpConfigManager.getInstance(testConfigPath);
      const mockWatcher = { close: vi.fn() };
      let watchCallback: Function = () => {};

      (fs.watch as unknown as MockInstance).mockImplementation((path, callback) => {
        watchCallback = callback;
        return mockWatcher;
      });

      instance.startWatching();

      // Setup spy for event emission
      const emitSpy = createEventEmitterSpy(instance);

      // Mock new config data
      (fs.readFileSync as unknown as MockInstance).mockReturnValueOnce(JSON.stringify(testConfig));

      // Simulate directory change for our config file
      watchCallback('change', path.basename(testConfigPath));

      // Fast-forward timers to trigger debounced reload
      vi.advanceTimersByTime(500);

      expect(emitSpy).toHaveBeenCalledWith(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED, testConfig.mcpServers);

      // Restore real timers
      vi.useRealTimers();
    });
  });

  describe('getTransportConfig', () => {
    it('should return copy of transport config', () => {
      (fs.readFileSync as unknown as MockInstance).mockReturnValueOnce(JSON.stringify(testConfig));

      const instance = McpConfigManager.getInstance(testConfigPath);
      const config = instance.getTransportConfig();

      expect(config).toEqual(testConfig.mcpServers);
      expect(config).not.toBe(instance['transportConfig']); // Should be a copy
    });
  });
});
