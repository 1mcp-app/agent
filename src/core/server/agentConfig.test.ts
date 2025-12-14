import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentConfigManager } from './agentConfig.js';

// Mock constants
vi.mock('@src/constants.js', () => ({
  HOST: 'localhost',
  PORT: 3050,
  AUTH_CONFIG: {
    SERVER: {
      DEFAULT_ENABLED: false,
      SESSION: {
        TTL_MINUTES: 1440,
      },
      AUTH_CODE: {
        TTL_MS: 60000,
      },
      TOKEN: {
        TTL_MS: 86400000,
      },
    },
  },
  RATE_LIMIT_CONFIG: {
    OAUTH: {
      WINDOW_MS: 900000,
      MAX: 100,
    },
  },
}));

describe('AgentConfigManager', () => {
  beforeEach(() => {
    // Reset singleton instance before each test
    // @ts-expect-error - Accessing private property for testing
    AgentConfigManager.instance = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance when called multiple times', () => {
      const instance1 = AgentConfigManager.getInstance();
      const instance2 = AgentConfigManager.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should maintain configuration state across getInstance calls', () => {
      const instance1 = AgentConfigManager.getInstance();
      instance1.updateConfig({ host: 'test.example.com' });

      const instance2 = AgentConfigManager.getInstance();
      expect(instance2.getConfig().host).toBe('test.example.com');
    });
  });

  describe('Default Configuration', () => {
    it('should initialize with correct default values', () => {
      const configManager = AgentConfigManager.getInstance();
      const config = configManager.getConfig();

      expect(config).toEqual({
        host: 'localhost',
        port: 3050,
        trustProxy: 'loopback',
        auth: {
          enabled: false,
          sessionTtlMinutes: 1440,
          oauthCodeTtlMs: 60000,
          oauthTokenTtlMs: 86400000,
        },
        rateLimit: {
          windowMs: 900000,
          max: 100,
        },
        features: {
          auth: false,
          scopeValidation: false,
          enhancedSecurity: false,
          configReload: true,
          envSubstitution: true,
          sessionPersistence: true,
          clientNotifications: true,
          internalTools: false,
          internalToolsList: [],
        },
        health: {
          detailLevel: 'minimal',
        },
        asyncLoading: {
          enabled: false,
          initialLoadTimeoutMs: 30000,
          waitForMinimumServers: 0,
          batchNotifications: true,
          batchDelayMs: 1000,
          notifyOnServerReady: true,
        },
        configReload: {
          debounceMs: 500,
        },
        sessionPersistence: {
          persistRequests: 100,
          persistIntervalMinutes: 5,
          backgroundFlushSeconds: 60,
        },
      });
    });

    it('should have trustProxy default to loopback', () => {
      const configManager = AgentConfigManager.getInstance();
      expect(configManager.get('trustProxy')).toBe('loopback');
    });
  });

  describe('Configuration Updates', () => {
    let configManager: AgentConfigManager;

    beforeEach(() => {
      configManager = AgentConfigManager.getInstance();
    });

    it('should update basic configuration fields', () => {
      configManager.updateConfig({
        host: 'example.com',
        port: 8080,
        externalUrl: 'https://api.example.com',
        trustProxy: true,
      });

      const config = configManager.getConfig();
      expect(config.host).toBe('example.com');
      expect(config.port).toBe(8080);
      expect(config.externalUrl).toBe('https://api.example.com');
      expect(config.trustProxy).toBe(true);
    });

    it('should update auth configuration partially', () => {
      configManager.updateConfig({
        auth: {
          enabled: true,
          sessionTtlMinutes: 720,
        } as any,
      });

      const config = configManager.getConfig();
      expect(config.auth.enabled).toBe(true);
      expect(config.auth.sessionTtlMinutes).toBe(720);
      // Should preserve other auth fields
      expect(config.auth.oauthCodeTtlMs).toBe(60000);
      expect(config.auth.oauthTokenTtlMs).toBe(86400000);
    });

    it('should update rate limit configuration partially', () => {
      configManager.updateConfig({
        rateLimit: {
          windowMs: 300000,
          max: 50,
        },
      });

      const config = configManager.getConfig();
      expect(config.rateLimit.windowMs).toBe(300000);
      expect(config.rateLimit.max).toBe(50);
    });

    it('should update features configuration partially', () => {
      configManager.updateConfig({
        features: {
          auth: true,
          enhancedSecurity: true,
        } as any,
      });

      const config = configManager.getConfig();
      expect(config.features.auth).toBe(true);
      expect(config.features.enhancedSecurity).toBe(true);
      // Should preserve other feature fields
      expect(config.features.scopeValidation).toBe(false);
    });

    it('should handle multiple simultaneous updates', () => {
      configManager.updateConfig({
        host: 'multi-test.com',
        trustProxy: '192.168.1.0/24',
        auth: {
          enabled: true,
          sessionTtlMinutes: 480,
        } as any,
        features: {
          enhancedSecurity: true,
        } as any,
      });

      const config = configManager.getConfig();
      expect(config.host).toBe('multi-test.com');
      expect(config.trustProxy).toBe('192.168.1.0/24');
      expect(config.auth.enabled).toBe(true);
      expect(config.auth.sessionTtlMinutes).toBe(480);
      expect(config.features.enhancedSecurity).toBe(true);
    });
  });

  describe('Generic Getter Method', () => {
    let configManager: AgentConfigManager;

    beforeEach(() => {
      configManager = AgentConfigManager.getInstance();
    });

    it('should provide type-safe access to top-level properties', () => {
      expect(configManager.get('host')).toBe('localhost');
      expect(configManager.get('port')).toBe(3050);
      expect(configManager.get('trustProxy')).toBe('loopback');
    });

    it('should provide type-safe access to nested properties', () => {
      expect(configManager.get('auth').enabled).toBe(false);
      expect(configManager.get('auth').sessionTtlMinutes).toBe(1440);
      expect(configManager.get('rateLimit').windowMs).toBe(900000);
      expect(configManager.get('rateLimit').max).toBe(100);
      expect(configManager.get('features').auth).toBe(false);
      expect(configManager.get('features').scopeValidation).toBe(false);
      expect(configManager.get('health').detailLevel).toBe('minimal');
      expect(configManager.get('asyncLoading').enabled).toBe(false);
    });

    it('should return updated values after configuration changes', () => {
      configManager.updateConfig({
        host: 'updated.com',
        auth: { sessionTtlMinutes: 720 } as any,
        features: { auth: true } as any,
      });

      expect(configManager.get('host')).toBe('updated.com');
      expect(configManager.get('auth').sessionTtlMinutes).toBe(720);
      expect(configManager.get('features').auth).toBe(true);
    });

    it('should maintain type safety with TypeScript', () => {
      // These should compile without type errors
      const host: string = configManager.get('host');
      const port: number = configManager.get('port');
      const authEnabled: boolean = configManager.get('features').auth;
      const detailLevel: 'full' | 'basic' | 'minimal' = configManager.get('health').detailLevel;

      expect(typeof host).toBe('string');
      expect(typeof port).toBe('number');
      expect(typeof authEnabled).toBe('boolean');
      expect(typeof detailLevel).toBe('string');
    });
  });

  describe('Convenience Methods (High Usage)', () => {
    let configManager: AgentConfigManager;

    beforeEach(() => {
      configManager = AgentConfigManager.getInstance();
    });

    it('should return deep copy of configuration in getConfig', () => {
      const config = configManager.getConfig();
      config.host = 'modified-host';

      const freshConfig = configManager.getConfig();
      expect(freshConfig.host).toBe('localhost'); // Should not be modified
    });

    it('should return correct trust proxy value', () => {
      expect(configManager.get('trustProxy')).toBe('loopback');

      configManager.updateConfig({ trustProxy: true });
      expect(configManager.get('trustProxy')).toBe(true);

      configManager.updateConfig({ trustProxy: '127.0.0.1' });
      expect(configManager.get('trustProxy')).toBe('127.0.0.1');

      configManager.updateConfig({ trustProxy: false });
      expect(configManager.get('trustProxy')).toBe(false);
    });

    it('should return correct auth status', () => {
      expect(configManager.get('features').auth).toBe(false);

      configManager.updateConfig({
        features: { auth: true } as any,
      });
      expect(configManager.get('features').auth).toBe(true);
    });

    it('should return correct scope validation status', () => {
      expect(configManager.get('features').scopeValidation).toBe(false);

      configManager.updateConfig({
        features: { scopeValidation: true } as any,
      });
      expect(configManager.get('features').scopeValidation).toBe(true);
    });

    it('should return correct enhanced security status', () => {
      expect(configManager.get('features').enhancedSecurity).toBe(false);

      configManager.updateConfig({
        features: { enhancedSecurity: true } as any,
      });
      expect(configManager.get('features').enhancedSecurity).toBe(true);
    });

    it('should return correct external URL', () => {
      expect(configManager.get('externalUrl')).toBeUndefined();

      configManager.updateConfig({
        externalUrl: 'https://external.example.com',
      });
      expect(configManager.get('externalUrl')).toBe('https://external.example.com');
    });

    it('should return correct server URL - using external URL when set', () => {
      expect(configManager.getUrl()).toBe('http://localhost:3050');

      configManager.updateConfig({
        externalUrl: 'https://external.example.com',
      });
      expect(configManager.getUrl()).toBe('https://external.example.com');
    });

    it('should return correct server URL - fallback to host:port', () => {
      configManager.updateConfig({
        host: 'custom.host.com',
        port: 9000,
      });
      expect(configManager.getUrl()).toBe('http://custom.host.com:9000');
    });

    it('should return correct health detail level', () => {
      expect(configManager.get('health').detailLevel).toBe('minimal');

      configManager.updateConfig({
        health: { detailLevel: 'full' },
      });
      expect(configManager.get('health').detailLevel).toBe('full');
    });

    it('should return correct async loading status', () => {
      expect(configManager.get('asyncLoading').enabled).toBe(false);

      configManager.updateConfig({
        asyncLoading: { enabled: true } as any,
      });
      expect(configManager.get('asyncLoading').enabled).toBe(true);
    });

    it('should return correct config reload status', () => {
      expect(configManager.get('features').configReload).toBe(true);

      configManager.updateConfig({
        features: { configReload: false } as any,
      });
      expect(configManager.get('features').configReload).toBe(false);
    });

    it('should return correct client notifications status', () => {
      expect(configManager.get('features').clientNotifications).toBe(true);

      configManager.updateConfig({
        features: { clientNotifications: false } as any,
      });
      expect(configManager.get('features').clientNotifications).toBe(false);
    });
  });

  describe('Trust Proxy Value Types', () => {
    let configManager: AgentConfigManager;

    beforeEach(() => {
      configManager = AgentConfigManager.getInstance();
    });

    it('should handle boolean trust proxy values', () => {
      configManager.updateConfig({ trustProxy: true });
      expect(configManager.get('trustProxy')).toBe(true);

      configManager.updateConfig({ trustProxy: false });
      expect(configManager.get('trustProxy')).toBe(false);
    });

    it('should handle string preset trust proxy values', () => {
      const presets = ['loopback', 'linklocal', 'uniquelocal'];

      presets.forEach((preset) => {
        configManager.updateConfig({ trustProxy: preset });
        expect(configManager.get('trustProxy')).toBe(preset);
      });
    });

    it('should handle IP address trust proxy values', () => {
      const ipAddresses = ['127.0.0.1', '192.168.1.1', '::1'];

      ipAddresses.forEach((ip) => {
        configManager.updateConfig({ trustProxy: ip });
        expect(configManager.get('trustProxy')).toBe(ip);
      });
    });

    it('should handle CIDR range trust proxy values', () => {
      const cidrs = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];

      cidrs.forEach((cidr) => {
        configManager.updateConfig({ trustProxy: cidr });
        expect(configManager.get('trustProxy')).toBe(cidr);
      });
    });
  });

  describe('Configuration State Persistence', () => {
    it('should maintain configuration state across multiple method calls', () => {
      const configManager = AgentConfigManager.getInstance();

      configManager.updateConfig({
        host: 'persistent.com',
        trustProxy: 'linklocal',
        features: { auth: true } as any,
      });

      // Multiple getter calls should return consistent results
      expect(configManager.get('trustProxy')).toBe('linklocal');
      expect(configManager.get('features').auth).toBe(true);
      expect(configManager.getConfig().host).toBe('persistent.com');

      // State should persist after additional updates
      configManager.updateConfig({ port: 4000 });
      expect(configManager.get('trustProxy')).toBe('linklocal');
      expect(configManager.get('features').auth).toBe(true);
      expect(configManager.getConfig().host).toBe('persistent.com');
      expect(configManager.getConfig().port).toBe(4000);
    });
  });
});
