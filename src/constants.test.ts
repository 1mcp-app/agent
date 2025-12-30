import os from 'os';

import { getConfigDir, getConfigPath, getGlobalConfigDir, getGlobalConfigPath } from '@src/constants.js';
import { DEFAULT_MAX_CONCURRENT_LOADS } from '@src/constants/mcp.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('constants', () => {
  let originalEnv: typeof process.env;
  let originalPlatform: string;

  beforeEach(() => {
    originalEnv = { ...process.env };
    originalPlatform = process.platform;
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      writable: true,
    });
  });

  describe('getGlobalConfigDir', () => {
    it('should return config directory for macOS', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/Users/testuser/.config/1mcp');
      vi.restoreAllMocks();
    });

    it('should return config directory for Linux', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/home/testuser/.config/1mcp');
      vi.restoreAllMocks();
    });

    it('should return config directory for Windows', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\testuser');
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('C:\\Users\\testuser/AppData/Roaming/1mcp');
      vi.restoreAllMocks();
    });

    it('should use os.homedir() for home directory detection', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/home/testuser/.config/1mcp');
      expect(os.homedir).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('should handle different platforms correctly', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\testuser');
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('C:\\Users\\testuser/AppData/Roaming/1mcp');
      vi.restoreAllMocks();
    });

    it('should throw error when os.homedir() fails', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Unable to determine home directory');
      });

      expect(() => getGlobalConfigDir()).toThrow('Unable to determine home directory');
      vi.restoreAllMocks();
    });

    it('should handle os.homedir() returning empty string', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/.config/1mcp');
      vi.restoreAllMocks();
    });

    it('should work with any valid home directory path', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/custom/home/path');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/custom/home/path/.config/1mcp');
      vi.restoreAllMocks();
    });
  });

  describe('getGlobalConfigPath', () => {
    it('should return config file path for macOS', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('/Users/testuser/.config/1mcp/mcp.json');
      vi.restoreAllMocks();
    });

    it('should return config file path for Linux', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('/home/testuser/.config/1mcp/mcp.json');
      vi.restoreAllMocks();
    });

    it('should return config file path for Windows', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\testuser');
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('C:\\Users\\testuser/AppData/Roaming/1mcp/mcp.json');
      vi.restoreAllMocks();
    });

    it('should use getGlobalConfigDir internally', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/custom/config/path');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('/custom/config/path/.config/1mcp/mcp.json');
      vi.restoreAllMocks();
    });

    it('should handle path with spaces', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/test user');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('/Users/test user/.config/1mcp/mcp.json');
      vi.restoreAllMocks();
    });

    it('should handle path with special characters', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/test-user_123');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getGlobalConfigPath();
      expect(result).toBe('/Users/test-user_123/.config/1mcp/mcp.json');
      vi.restoreAllMocks();
    });
  });

  describe('platform detection', () => {
    it('should handle unknown platform as non-Unix', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'unknown',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/home/testuser/AppData/Roaming/1mcp');
      vi.restoreAllMocks();
    });

    it('should handle freebsd as Unix-like', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/home/testuser/AppData/Roaming/1mcp');
      vi.restoreAllMocks();
    });

    it('should handle openbsd as Unix-like', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/home/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'openbsd',
        writable: true,
      });

      const result = getGlobalConfigDir();
      expect(result).toBe('/home/testuser/AppData/Roaming/1mcp');
      vi.restoreAllMocks();
    });
  });

  describe('error handling', () => {
    it('should throw descriptive error message', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Unable to determine home directory');
      });

      expect(() => getGlobalConfigDir()).toThrow('Unable to determine home directory');
      vi.restoreAllMocks();
    });

    it('should propagate error from getGlobalConfigDir to getGlobalConfigPath', () => {
      vi.spyOn(os, 'homedir').mockImplementation(() => {
        throw new Error('Unable to determine home directory');
      });

      expect(() => getGlobalConfigPath()).toThrow('Unable to determine home directory');
      vi.restoreAllMocks();
    });
  });

  describe('path construction', () => {
    it('should use correct path separators', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const configDir = getGlobalConfigDir();
      const configPath = getGlobalConfigPath();

      expect(configDir).toContain('/');
      expect(configPath).toContain('/');
      expect(configPath).toContain('.config');
      expect(configPath).toContain('1mcp');
      expect(configPath).toContain('mcp.json');
      vi.restoreAllMocks();
    });

    it('should maintain consistent directory structure', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const configDir = getGlobalConfigDir();
      const configPath = getGlobalConfigPath();

      expect(configPath.startsWith(configDir)).toBe(true);
      expect(configPath.endsWith('/mcp.json')).toBe(true);
      vi.restoreAllMocks();
    });
  });

  describe('getConfigDir', () => {
    it('should return configDirOption when provided', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getConfigDir('/custom/config/dir');
      expect(result).toBe('/custom/config/dir');
      // os.homedir should not be called when configDirOption is provided
      expect(os.homedir).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('should return global config dir when no option provided', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getConfigDir();
      expect(result).toBe('/Users/testuser/.config/1mcp');
      expect(os.homedir).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('should return global config dir when undefined option provided', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getConfigDir(undefined);
      expect(result).toBe('/Users/testuser/.config/1mcp');
      expect(os.homedir).toHaveBeenCalled();
      vi.restoreAllMocks();
    });

    it('should handle empty string as fallback to global config dir', () => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });

      const result = getConfigDir('');
      expect(result).toBe('/Users/testuser/.config/1mcp');
      vi.restoreAllMocks();
    });

    it('should handle relative paths as config dir option', () => {
      const result = getConfigDir('./config');
      expect(result).toBe('./config');
    });

    it('should handle absolute paths as config dir option', () => {
      const result = getConfigDir('/absolute/path/to/config');
      expect(result).toBe('/absolute/path/to/config');
    });
  });

  describe('getConfigPath', () => {
    beforeEach(() => {
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/testuser');
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        writable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return config file path in custom config directory', () => {
      const result = getConfigPath('/custom/config/dir');
      expect(result).toBe('/custom/config/dir/mcp.json');
    });

    it('should return global config file path when no config dir provided', () => {
      const result = getConfigPath();
      expect(result).toBe('/Users/testuser/.config/1mcp/mcp.json');
      expect(os.homedir).toHaveBeenCalled();
    });

    it('should handle relative paths as config directory', () => {
      const result = getConfigPath('./config');
      expect(result).toBe('./config/mcp.json');
    });

    it('should handle empty string as config directory', () => {
      const result = getConfigPath('');
      expect(result).toBe('/Users/testuser/.config/1mcp/mcp.json');
    });

    it('should handle undefined config directory', () => {
      const result = getConfigPath(undefined);
      expect(result).toBe('/Users/testuser/.config/1mcp/mcp.json');
    });
  });

  describe('MCP constants', () => {
    it('should export DEFAULT_MAX_CONCURRENT_LOADS constant', () => {
      expect(DEFAULT_MAX_CONCURRENT_LOADS).toBeDefined();
      expect(typeof DEFAULT_MAX_CONCURRENT_LOADS).toBe('number');
    });

    it('should have DEFAULT_MAX_CONCURRENT_LOADS set to 5', () => {
      expect(DEFAULT_MAX_CONCURRENT_LOADS).toBe(5);
    });

    it('should be a positive integer', () => {
      expect(DEFAULT_MAX_CONCURRENT_LOADS).toBeGreaterThan(0);
      expect(Number.isInteger(DEFAULT_MAX_CONCURRENT_LOADS)).toBe(true);
    });
  });
});
