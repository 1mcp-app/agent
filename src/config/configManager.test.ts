import fs from 'fs';
import path from 'path';
import { ConfigManager, ConfigChangeEvent } from './configManager.js';
import { DEFAULT_CONFIG } from '../constants.js';
import { vi, describe, it, expect, beforeEach, MockInstance } from 'vitest';

// Test data
const testConfig = {
  mcpServers: {
    server1: { url: 'http://test1.com' },
    server2: { url: 'http://test2.com' },
  },
};

// Helper function to create an event emitter spy
const createEventEmitterSpy = (instance: ConfigManager) => {
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
      watch: vi.fn(() => ({ close: vi.fn() })),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
});

// Mock constants
vi.mock('../constants.js', () => ({
  __esModule: true,
  DEFAULT_CONFIG: { mcpServers: {} },
  getGlobalConfigPath: vi.fn(),
  getGlobalConfigDir: vi.fn().mockReturnValue('/test'),
}));

describe('ConfigManager', () => {
  const testConfigPath = '/test/config.json';

  beforeEach(() => {
    // Reset singleton instance
    (ConfigManager as any).instance = undefined;
    // Default mock implementations
    (fs.existsSync as unknown as MockInstance).mockReturnValue(true);
    (fs.readFileSync as unknown as MockInstance).mockReturnValue(JSON.stringify({ mcpServers: {} }));
  });

  describe('getInstance', () => {
    it('should create singleton instance', () => {
      const instance1 = ConfigManager.getInstance(testConfigPath);
      const instance2 = ConfigManager.getInstance(testConfigPath);
      expect(instance1).toBe(instance2);
    });

    it('should use provided config path', () => {
      const instance = ConfigManager.getInstance(testConfigPath);
      expect((instance as any).configFilePath).toBe(testConfigPath);
    });
  });

  describe('ensureConfigExists', () => {
    it('should create config directory and file if they do not exist', () => {
      (fs.existsSync as unknown as MockInstance)
        .mockReturnValueOnce(false) // Directory doesn't exist
        .mockReturnValueOnce(false); // File doesn't exist

      ConfigManager.getInstance(testConfigPath);

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(testConfigPath), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(testConfigPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    });
  });

  describe('config watching', () => {
    it('should start and stop watching config file', () => {
      const instance = ConfigManager.getInstance(testConfigPath);

      instance.startWatching();
      expect(fs.watch).toHaveBeenCalledWith(testConfigPath, expect.any(Function));

      instance.stopWatching();
      expect(instance['configWatcher']).toBeNull();
    });

    it('should reload config on file change', () => {
      const instance = ConfigManager.getInstance(testConfigPath);
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

      // Simulate file change
      watchCallback('change', path.basename(testConfigPath));

      expect(emitSpy).toHaveBeenCalledWith(ConfigChangeEvent.TRANSPORT_CONFIG_CHANGED, testConfig.mcpServers);
    });
  });

  describe('getTransportConfig', () => {
    it('should return copy of transport config', () => {
      (fs.readFileSync as unknown as MockInstance).mockReturnValueOnce(JSON.stringify(testConfig));

      const instance = ConfigManager.getInstance(testConfigPath);
      const config = instance.getTransportConfig();

      expect(config).toEqual(testConfig.mcpServers);
      expect(config).not.toBe(instance['transportConfig']); // Should be a copy
    });
  });
});
