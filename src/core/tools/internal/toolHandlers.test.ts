import { FlagManager } from '@src/core/flags/flagManager.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import the main handlers we're testing from the individual modules
import { cleanupDiscoveryHandlers, handleMcpInfo, handleMcpSearch } from './discoveryHandlers.js';
import {
  cleanupInstallationHandlers,
  handleMcpInstall,
  handleMcpUninstall,
  handleMcpUpdate,
} from './installationHandlers.js';
import {
  cleanupManagementHandlers,
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpReload,
  handleMcpStatus,
} from './managementHandlers.js';
import { cleanupInternalToolHandlers } from './toolHandlers.js';

// Mock FlagManager
vi.mock('@src/core/flags/flagManager.js', () => ({
  FlagManager: {
    getInstance: vi.fn(() => ({
      isToolEnabled: vi.fn(() => true),
    })),
  },
}));

// Mock logger
vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  debugIf: vi.fn(),
}));

// Mock cleanup functions for testing
vi.mock('./discoveryHandlers.js', async () => {
  const actual = await vi.importActual('./discoveryHandlers.js');
  return {
    ...actual,
    cleanupDiscoveryHandlers: vi.fn(),
  };
});

vi.mock('./installationHandlers.js', async () => {
  const actual = await vi.importActual('./installationHandlers.js');
  return {
    ...actual,
    cleanupInstallationHandlers: vi.fn(),
  };
});

vi.mock('./managementHandlers.js', async () => {
  const actual = await vi.importActual('./managementHandlers.js');
  return {
    ...actual,
    cleanupManagementHandlers: vi.fn(),
  };
});

describe('toolHandlers', () => {
  let mockFlagManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFlagManager = {
      isToolEnabled: vi.fn(() => true),
    };
    (FlagManager.getInstance as any).mockReturnValue(mockFlagManager);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Handler Integration', () => {
    it('should have all required handlers available', () => {
      // Test that all handlers are properly exported
      expect(typeof handleMcpSearch).toBe('function');
      expect(typeof handleMcpInfo).toBe('function');
      expect(typeof handleMcpInstall).toBe('function');
      expect(typeof handleMcpUninstall).toBe('function');
      expect(typeof handleMcpUpdate).toBe('function');
      expect(typeof handleMcpEnable).toBe('function');
      expect(typeof handleMcpDisable).toBe('function');
      expect(typeof handleMcpList).toBe('function');
      expect(typeof handleMcpStatus).toBe('function');
      expect(typeof handleMcpReload).toBe('function');
      expect(typeof cleanupInternalToolHandlers).toBe('function');
    });
  });

  describe('cleanupInternalToolHandlers', () => {
    it('should call cleanup for search handler', async () => {
      await cleanupInternalToolHandlers();
      expect(cleanupDiscoveryHandlers).toHaveBeenCalled();
    });

    it('should call cleanup for installation handler', async () => {
      await cleanupInternalToolHandlers();
      expect(cleanupInstallationHandlers).toHaveBeenCalled();
    });

    it('should call cleanup for management handler', async () => {
      await cleanupInternalToolHandlers();
      expect(cleanupManagementHandlers).toHaveBeenCalled();
    });

    it('should cleanup without errors', async () => {
      expect(async () => await cleanupInternalToolHandlers()).not.toThrow();
    });
  });
});
