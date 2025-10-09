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
      });
    });

    it('should have trustProxy default to loopback', () => {
      const configManager = AgentConfigManager.getInstance();
      expect(configManager.getTrustProxy()).toBe('loopback');
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

  describe('Getter Methods', () => {
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
      expect(configManager.getTrustProxy()).toBe('loopback');

      configManager.updateConfig({ trustProxy: true });
      expect(configManager.getTrustProxy()).toBe(true);

      configManager.updateConfig({ trustProxy: '127.0.0.1' });
      expect(configManager.getTrustProxy()).toBe('127.0.0.1');

      configManager.updateConfig({ trustProxy: false });
      expect(configManager.getTrustProxy()).toBe(false);
    });

    it('should return correct auth status', () => {
      expect(configManager.isAuthEnabled()).toBe(false);

      configManager.updateConfig({
        features: { auth: true } as any,
      });
      expect(configManager.isAuthEnabled()).toBe(true);
    });

    it('should return correct session TTL', () => {
      expect(configManager.getSessionTtlMinutes()).toBe(1440);

      configManager.updateConfig({
        auth: { sessionTtlMinutes: 720 } as any,
      });
      expect(configManager.getSessionTtlMinutes()).toBe(720);
    });

    it('should return correct session storage path', () => {
      expect(configManager.getSessionStoragePath()).toBeUndefined();

      configManager.updateConfig({
        auth: { sessionStoragePath: '/custom/path' } as any,
      });
      expect(configManager.getSessionStoragePath()).toBe('/custom/path');
    });

    it('should return correct OAuth code TTL', () => {
      expect(configManager.getOAuthCodeTtlMs()).toBe(60000);

      configManager.updateConfig({
        auth: { oauthCodeTtlMs: 30000 } as any,
      });
      expect(configManager.getOAuthCodeTtlMs()).toBe(30000);
    });

    it('should return correct OAuth token TTL', () => {
      expect(configManager.getOAuthTokenTtlMs()).toBe(86400000);

      configManager.updateConfig({
        auth: { oauthTokenTtlMs: 43200000 } as any,
      });
      expect(configManager.getOAuthTokenTtlMs()).toBe(43200000);
    });

    it('should return correct rate limit window', () => {
      expect(configManager.getRateLimitWindowMs()).toBe(900000);

      configManager.updateConfig({
        rateLimit: { windowMs: 600000 } as any,
      });
      expect(configManager.getRateLimitWindowMs()).toBe(600000);
    });

    it('should return correct rate limit max', () => {
      expect(configManager.getRateLimitMax()).toBe(100);

      configManager.updateConfig({
        rateLimit: { max: 200 } as any,
      });
      expect(configManager.getRateLimitMax()).toBe(200);
    });

    it('should return correct scope validation status', () => {
      expect(configManager.isScopeValidationEnabled()).toBe(false);

      configManager.updateConfig({
        features: { scopeValidation: true } as any,
      });
      expect(configManager.isScopeValidationEnabled()).toBe(true);
    });

    it('should return correct enhanced security status', () => {
      expect(configManager.isEnhancedSecurityEnabled()).toBe(false);

      configManager.updateConfig({
        features: { enhancedSecurity: true } as any,
      });
      expect(configManager.isEnhancedSecurityEnabled()).toBe(true);
    });

    it('should return correct external URL', () => {
      expect(configManager.getExternalUrl()).toBeUndefined();

      configManager.updateConfig({
        externalUrl: 'https://external.example.com',
      });
      expect(configManager.getExternalUrl()).toBe('https://external.example.com');
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
  });

  describe('Trust Proxy Value Types', () => {
    let configManager: AgentConfigManager;

    beforeEach(() => {
      configManager = AgentConfigManager.getInstance();
    });

    it('should handle boolean trust proxy values', () => {
      configManager.updateConfig({ trustProxy: true });
      expect(configManager.getTrustProxy()).toBe(true);

      configManager.updateConfig({ trustProxy: false });
      expect(configManager.getTrustProxy()).toBe(false);
    });

    it('should handle string preset trust proxy values', () => {
      const presets = ['loopback', 'linklocal', 'uniquelocal'];

      presets.forEach((preset) => {
        configManager.updateConfig({ trustProxy: preset });
        expect(configManager.getTrustProxy()).toBe(preset);
      });
    });

    it('should handle IP address trust proxy values', () => {
      const ipAddresses = ['127.0.0.1', '192.168.1.1', '::1'];

      ipAddresses.forEach((ip) => {
        configManager.updateConfig({ trustProxy: ip });
        expect(configManager.getTrustProxy()).toBe(ip);
      });
    });

    it('should handle CIDR range trust proxy values', () => {
      const cidrs = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'];

      cidrs.forEach((cidr) => {
        configManager.updateConfig({ trustProxy: cidr });
        expect(configManager.getTrustProxy()).toBe(cidr);
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
      expect(configManager.getTrustProxy()).toBe('linklocal');
      expect(configManager.isAuthEnabled()).toBe(true);
      expect(configManager.getConfig().host).toBe('persistent.com');

      // State should persist after additional updates
      configManager.updateConfig({ port: 4000 });
      expect(configManager.getTrustProxy()).toBe('linklocal');
      expect(configManager.isAuthEnabled()).toBe(true);
      expect(configManager.getConfig().host).toBe('persistent.com');
      expect(configManager.getConfig().port).toBe(4000);
    });
  });
});
