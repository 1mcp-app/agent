import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Integration tests for trust proxy configuration.
 *
 * These tests verify that the AgentConfigManager properly handles
 * trust proxy configuration for various deployment scenarios.
 */
describe('HTTP Trust Proxy Configuration Integration', () => {
  let configManager: AgentConfigManager;

  beforeEach(() => {
    // Reset singleton instance
    // @ts-expect-error - Accessing private property for testing
    AgentConfigManager.instance = undefined;

    configManager = AgentConfigManager.getInstance();
  });

  describe('Trust Proxy Configuration Management', () => {
    it('should have default loopback trust proxy configuration', () => {
      expect(configManager.get('trustProxy')).toBe('loopback');

      const config = configManager.getConfig();
      expect(config.trustProxy).toBe('loopback');
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
      const cidrs = ['192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12', '2001:db8::/32'];

      cidrs.forEach((cidr) => {
        configManager.updateConfig({ trustProxy: cidr });
        expect(configManager.get('trustProxy')).toBe(cidr);
      });
    });
  });

  describe('Configuration Persistence', () => {
    it('should maintain trust proxy configuration across updates', () => {
      // Set initial configuration
      configManager.updateConfig({
        trustProxy: 'linklocal',
        host: 'test.com',
        port: 4000,
      });

      expect(configManager.get('trustProxy')).toBe('linklocal');
      expect(configManager.getConfig().host).toBe('test.com');
      expect(configManager.getConfig().port).toBe(4000);

      // Update other configuration, trust proxy should persist
      configManager.updateConfig({ port: 5000 });
      expect(configManager.get('trustProxy')).toBe('linklocal');
      expect(configManager.getConfig().port).toBe(5000);
    });

    it('should handle configuration updates with nested objects', () => {
      configManager.updateConfig({
        trustProxy: '192.168.1.0/24',
        auth: {
          enabled: true,
          sessionTtlMinutes: 720,
        } as any,
      });

      expect(configManager.get('trustProxy')).toBe('192.168.1.0/24');
      expect(configManager.getConfig().auth.enabled).toBe(true);
      expect(configManager.getConfig().auth.sessionTtlMinutes).toBe(720);

      // Other auth properties should be preserved
      expect(configManager.getConfig().auth.oauthCodeTtlMs).toBeDefined();
      expect(configManager.getConfig().auth.oauthTokenTtlMs).toBeDefined();
    });
  });

  describe('Configuration Scenarios', () => {
    it('should handle local development scenario', () => {
      // Default configuration should be suitable for local development
      expect(configManager.get('trustProxy')).toBe('loopback');

      const config = configManager.getConfig();
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(3050);
      expect(config.trustProxy).toBe('loopback');
    });

    it('should handle reverse proxy scenario', () => {
      configManager.updateConfig({
        trustProxy: '192.168.1.100',
        externalUrl: 'https://api.example.com',
        host: '0.0.0.0',
        port: 3050,
      });

      expect(configManager.get('trustProxy')).toBe('192.168.1.100');
      expect(configManager.get('externalUrl')).toBe('https://api.example.com');
      expect(
        configManager.get('externalUrl') || `http://${configManager.get('host')}:${configManager.get('port')}`,
      ).toBe('https://api.example.com');
    });

    it('should handle CDN scenario', () => {
      configManager.updateConfig({
        trustProxy: true,
        externalUrl: 'https://cdn.example.com',
        features: {
          enhancedSecurity: true,
        } as any,
      });

      expect(configManager.get('trustProxy')).toBe(true);
      expect(configManager.get('externalUrl')).toBe('https://cdn.example.com');
      expect(configManager.get('features').enhancedSecurity).toBe(true);
    });

    it('should handle Docker container scenario', () => {
      configManager.updateConfig({
        trustProxy: 'uniquelocal',
        host: '0.0.0.0',
        port: 3050,
      });

      expect(configManager.get('trustProxy')).toBe('uniquelocal');
      expect(configManager.getConfig().host).toBe('0.0.0.0');
      expect(
        configManager.get('externalUrl') || `http://${configManager.get('host')}:${configManager.get('port')}`,
      ).toBe('http://0.0.0.0:3050');
    });
  });

  describe('Edge Cases and Validation', () => {
    it('should handle boolean false trust proxy configuration', () => {
      configManager.updateConfig({ trustProxy: false });
      expect(configManager.get('trustProxy')).toBe(false);
      expect(typeof configManager.get('trustProxy')).toBe('boolean');
    });

    it('should handle empty string trust proxy configuration', () => {
      configManager.updateConfig({ trustProxy: '' });
      expect(configManager.get('trustProxy')).toBe('');
    });

    it('should maintain type consistency', () => {
      // Test boolean
      configManager.updateConfig({ trustProxy: true });
      expect(typeof configManager.get('trustProxy')).toBe('boolean');

      // Test string
      configManager.updateConfig({ trustProxy: 'loopback' });
      expect(typeof configManager.get('trustProxy')).toBe('string');

      // Test IP address
      configManager.updateConfig({ trustProxy: '127.0.0.1' });
      expect(typeof configManager.get('trustProxy')).toBe('string');
    });

    it('should handle rapid configuration changes', () => {
      const values = [true, false, 'loopback', '192.168.1.1', '10.0.0.0/8', 'linklocal'];

      values.forEach((value) => {
        configManager.updateConfig({ trustProxy: value });
        expect(configManager.get('trustProxy')).toBe(value);
      });
    });
  });
});
