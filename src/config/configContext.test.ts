import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import ConfigContext from './configContext.js';
import { getConfigPath } from '@src/constants.js';

describe('ConfigContext', () => {
  let configContext: ConfigContext;

  beforeEach(() => {
    configContext = ConfigContext.getInstance();
    configContext.reset(); // Ensure clean state for each test
  });

  afterEach(() => {
    configContext.reset(); // Clean up after each test
  });

  describe('Singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigContext.getInstance();
      const instance2 = ConfigContext.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('setConfigPath', () => {
    it('should set config path correctly', () => {
      const testPath = '/test/config.json';
      configContext.setConfigPath(testPath);
      expect(configContext.getResolvedConfigPath()).toBe(testPath);
    });

    it('should handle undefined config path', () => {
      configContext.setConfigPath(undefined);
      // Should fall back to default config path
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should override previously set config directory', () => {
      configContext.setConfigDir('/test/dir');
      configContext.setConfigPath('/override/config.json');
      expect(configContext.getResolvedConfigPath()).toBe('/override/config.json');
    });
  });

  describe('setConfigDir', () => {
    it('should set config directory correctly', () => {
      const testDir = '/test/dir';
      configContext.setConfigDir(testDir);
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath(testDir));
    });

    it('should handle undefined config directory', () => {
      configContext.setConfigDir(undefined);
      // Should fall back to default config path
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should override previously set config path', () => {
      configContext.setConfigPath('/override/config.json');
      configContext.setConfigDir('/test/dir');
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath('/test/dir'));
    });
  });

  describe('getResolvedConfigPath', () => {
    it('should return config path when set', () => {
      const testPath = '/test/config.json';
      configContext.setConfigPath(testPath);
      expect(configContext.getResolvedConfigPath()).toBe(testPath);
    });

    it('should return config path from directory when directory is set', () => {
      const testDir = '/test/dir';
      configContext.setConfigDir(testDir);
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath(testDir));
    });

    it('should return default config path when nothing is set', () => {
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should prioritize config path over config directory', () => {
      const testPath = '/test/config.json';
      const testDir = '/test/dir';

      configContext.setConfigDir(testDir);
      configContext.setConfigPath(testPath);

      expect(configContext.getResolvedConfigPath()).toBe(testPath);
    });
  });

  describe('reset', () => {
    it('should clear all configuration', () => {
      configContext.setConfigPath('/test/config.json');
      configContext.setConfigDir('/test/dir');

      configContext.reset();

      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should work when nothing was set', () => {
      configContext.reset();
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });
  });

  describe('edge cases', () => {
    it('should handle empty string config path', () => {
      configContext.setConfigPath('');
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should handle empty string config directory', () => {
      configContext.setConfigDir('');
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should handle multiple resets', () => {
      configContext.setConfigPath('/test/config.json');
      configContext.reset();
      configContext.reset();
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath());
    });

    it('should handle alternating between path and directory', () => {
      const testPath = '/test/config.json';
      const testDir = '/test/dir';

      configContext.setConfigPath(testPath);
      expect(configContext.getResolvedConfigPath()).toBe(testPath);

      configContext.setConfigDir(testDir);
      expect(configContext.getResolvedConfigPath()).toBe(getConfigPath(testDir));

      configContext.setConfigPath(testPath);
      expect(configContext.getResolvedConfigPath()).toBe(testPath);
    });
  });
});
