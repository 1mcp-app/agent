import { describe, expect, it } from 'vitest';

import {
  McpDisableToolSchema,
  McpEnableToolSchema,
  McpInfoToolSchema,
  McpInstallToolSchema,
  McpListToolSchema,
  McpRegistryInfoSchema,
  McpRegistryListSchema,
  McpRegistryStatusSchema,
  McpReloadToolSchema,
  McpSearchToolSchema,
  McpStatusToolSchema,
  McpUninstallToolSchema,
  McpUpdateToolSchema,
} from './toolSchemas.js';

describe('toolSchemas', () => {
  describe('McpSearchToolSchema', () => {
    it('should validate valid search args', () => {
      const validArgs = {
        query: 'test',
        status: 'active',
        type: 'npm',
        transport: 'stdio',
        limit: 20,
        cursor: 'abc123',
        format: 'table',
      };

      const result = McpSearchToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.query).toBe('test');
        expect(result.data.status).toBe('active');
        expect(result.data.limit).toBe(20);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {};

      const result = McpSearchToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('active');
        expect(result.data.limit).toBe(20);
        expect(result.data.format).toBe('table');
      }
    });

    it('should reject invalid status', () => {
      const invalidArgs = {
        status: 'invalid',
      };

      const result = McpSearchToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid type', () => {
      const invalidArgs = {
        type: 'invalid',
      };

      const result = McpSearchToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid transport', () => {
      const invalidArgs = {
        transport: 'invalid',
      };

      const result = McpSearchToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid format', () => {
      const invalidArgs = {
        format: 'invalid',
      };

      const result = McpSearchToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpInstallToolSchema', () => {
    it('should validate valid install args', () => {
      const validArgs = {
        name: 'test-server',
        package: 'npm:test-server',
        version: '1.0.0',
        command: 'node',
        args: ['server.js'],
        url: 'http://localhost:3000',
        transport: 'stdio',
        tags: ['test', 'dev'],
        enabled: true,
        autoRestart: true,
      };

      const result = McpInstallToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.transport).toBe('stdio');
        expect(result.data.enabled).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpInstallToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transport).toBe('stdio');
        expect(result.data.enabled).toBe(true);
        expect(result.data.autoRestart).toBe(false);
      }
    });

    it('should require name field', () => {
      const invalidArgs = {};

      const result = McpInstallToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid transport', () => {
      const invalidArgs = {
        name: 'test-server',
        transport: 'invalid',
      };

      const result = McpInstallToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpUninstallToolSchema', () => {
    it('should validate valid uninstall args', () => {
      const validArgs = {
        name: 'test-server',
        preserveConfig: true,
        force: true,
      };

      const result = McpUninstallToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.preserveConfig).toBe(true);
        expect(result.data.force).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpUninstallToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preserveConfig).toBe(false);
        expect(result.data.force).toBe(false);
      }
    });

    it('should require name field', () => {
      const invalidArgs = {};

      const result = McpUninstallToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpUpdateToolSchema', () => {
    it('should validate valid update args', () => {
      const validArgs = {
        name: 'test-server',
        version: '2.0.0',
        package: 'npm:new-package',
        autoRestart: true,
        backup: true,
      };

      const result = McpUpdateToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.version).toBe('2.0.0');
        expect(result.data.autoRestart).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpUpdateToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.autoRestart).toBe(true);
        expect(result.data.backup).toBe(true);
      }
    });

    it('should require name field', () => {
      const invalidArgs = {};

      const result = McpUpdateToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpEnableToolSchema', () => {
    it('should validate valid enable args', () => {
      const validArgs = {
        name: 'test-server',
        restart: true,
      };

      const result = McpEnableToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.restart).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpEnableToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.restart).toBe(false);
      }
    });

    it('should require name field', () => {
      const invalidArgs = {};

      const result = McpEnableToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpDisableToolSchema', () => {
    it('should validate valid disable args', () => {
      const validArgs = {
        name: 'test-server',
        graceful: true,
      };

      const result = McpDisableToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.graceful).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpDisableToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.graceful).toBe(true);
      }
    });

    it('should require name field', () => {
      const invalidArgs = {};

      const result = McpDisableToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpListToolSchema', () => {
    it('should validate valid list args', () => {
      const validArgs = {
        status: 'enabled',
        transport: 'stdio',
        tags: ['test', 'dev'],
        format: 'json',
        verbose: true,
      };

      const result = McpListToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('enabled');
        expect(result.data.transport).toBe('stdio');
        expect(result.data.verbose).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {};

      const result = McpListToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('all');
        expect(result.data.format).toBe('table');
        expect(result.data.verbose).toBe(false);
      }
    });

    it('should reject invalid status', () => {
      const invalidArgs = {
        status: 'invalid',
      };

      const result = McpListToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid transport', () => {
      const invalidArgs = {
        transport: 'invalid',
      };

      const result = McpListToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should reject invalid format', () => {
      const invalidArgs = {
        format: 'invalid',
      };

      const result = McpListToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });
  });

  describe('McpStatusToolSchema', () => {
    it('should validate valid status args', () => {
      const validArgs = {
        name: 'test-server',
        details: true,
        health: true,
      };

      const result = McpStatusToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.details).toBe(true);
        expect(result.data.health).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {};

      const result = McpStatusToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.details).toBe(false);
        expect(result.data.health).toBe(true);
      }
    });

    it('should allow omitting name field', () => {
      const argsWithoutName = {
        details: true,
      };

      const result = McpStatusToolSchema.safeParse(argsWithoutName);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBeUndefined();
      }
    });
  });

  describe('McpReloadToolSchema', () => {
    it('should validate valid reload args', () => {
      const validArgs = {
        target: 'server',
        name: 'test-server',
        graceful: true,
        timeout: 30000,
      };

      const result = McpReloadToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.target).toBe('server');
        expect(result.data.name).toBe('test-server');
        expect(result.data.graceful).toBe(true);
        expect(result.data.timeout).toBe(30000);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {};

      const result = McpReloadToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.target).toBe('config');
        expect(result.data.graceful).toBe(true);
        expect(result.data.timeout).toBe(30000);
      }
    });

    it('should reject invalid target', () => {
      const invalidArgs = {
        target: 'invalid',
      };

      const result = McpReloadToolSchema.safeParse(invalidArgs);
      expect(result.success).toBe(false);
    });

    it('should allow all valid targets', () => {
      const targets = ['server', 'config', 'all'];

      targets.forEach((target) => {
        const args = { target };
        const result = McpReloadToolSchema.safeParse(args);
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.target).toBe(target);
        }
      });
    });

    it('should allow custom timeout values', () => {
      const args = {
        timeout: 60000,
      };

      const result = McpReloadToolSchema.safeParse(args);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.timeout).toBe(60000);
      }
    });
  });

  describe('McpInfoToolSchema', () => {
    it('should validate valid info args', () => {
      const validArgs = {
        name: 'test-server',
      };

      const result = McpInfoToolSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {
        name: 'test-server',
      };

      const result = McpInfoToolSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('test-server');
        expect(result.data.includeCapabilities).toBe(true);
        expect(result.data.includeConfig).toBe(true);
        expect(result.data.format).toBe('table');
      }
    });
  });

  describe('McpRegistryStatusSchema', () => {
    it('should validate valid registry status args', () => {
      const validArgs = {
        registry: 'community',
      };

      const result = McpRegistryStatusSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.registry).toBe('community');
      }
    });

    it('should apply default registry', () => {
      const minimalArgs = {};

      const result = McpRegistryStatusSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.registry).toBe('official');
      }
    });
  });

  describe('McpRegistryInfoSchema', () => {
    it('should validate valid registry info args', () => {
      const validArgs = {
        registry: 'experimental',
      };

      const result = McpRegistryInfoSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.registry).toBe('experimental');
      }
    });

    it('should apply default registry', () => {
      const minimalArgs = {};

      const result = McpRegistryInfoSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.registry).toBe('official');
      }
    });
  });

  describe('McpRegistryListSchema', () => {
    it('should validate valid registry list args', () => {
      const validArgs = {
        includeStats: true,
      };

      const result = McpRegistryListSchema.safeParse(validArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeStats).toBe(true);
      }
    });

    it('should apply default values', () => {
      const minimalArgs = {};

      const result = McpRegistryListSchema.safeParse(minimalArgs);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeStats).toBe(false);
      }
    });
  });
});
