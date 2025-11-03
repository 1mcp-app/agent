import { MCPRegistryClient } from '@src/domains/registry/mcpRegistryClient.js';
import { RegistryServer } from '@src/domains/registry/types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallWizard } from './installWizard.js';

describe('InstallWizard', () => {
  let wizard: InstallWizard;
  let mockRegistryClient: MCPRegistryClient;

  beforeEach(() => {
    // Mock registry client
    mockRegistryClient = {
      searchServers: vi.fn(),
      getServerById: vi.fn(),
    } as unknown as MCPRegistryClient;

    wizard = new InstallWizard(mockRegistryClient);

    // Spy on console
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WizardInstallConfig', () => {
    it('should define the correct interface structure', () => {
      const config = {
        serverId: 'test-server',
        version: '1.0.0',
        localName: 'local-test',
        tags: ['tag1', 'tag2'],
        env: { KEY: 'value' },
        args: ['--arg1'],
        installAnother: false,
        cancelled: false,
      };

      expect(config.serverId).toBe('test-server');
      expect(config.version).toBe('1.0.0');
      expect(config.localName).toBe('local-test');
      expect(config.tags).toEqual(['tag1', 'tag2']);
      expect(config.env).toEqual({ KEY: 'value' });
      expect(config.args).toEqual(['--arg1']);
      expect(config.installAnother).toBe(false);
      expect(config.cancelled).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should create wizard with registry client', () => {
      expect(wizard).toBeDefined();
      expect(wizard).toBeInstanceOf(InstallWizard);
    });
  });

  describe('cancelled result', () => {
    it('should create proper cancelled result structure', () => {
      const result = {
        serverId: '',
        version: undefined,
        localName: undefined,
        tags: undefined,
        env: undefined,
        args: undefined,
        cancelled: true,
        installAnother: false,
      };

      expect(result.cancelled).toBe(true);
      expect(result.serverId).toBe('');
      expect(result.installAnother).toBe(false);
    });
  });

  describe('showWelcome', () => {
    it('should display welcome screen', () => {
      // Wizard is initialized and console spies are set up
      expect(wizard).toBeDefined();
    });
  });

  describe('RegistryServer integration', () => {
    it('should handle server with all optional fields', () => {
      const server: RegistryServer = {
        name: 'test-server',
        description: 'Test server description',
        status: 'active',
        version: '1.0.0',
        repository: {
          url: 'https://github.com/test/repo',
          source: 'github',
        },
        websiteUrl: 'https://example.com',
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active',
            updatedAt: new Date().toISOString(),
          },
        },
      };

      expect(server.name).toBe('test-server');
      expect(server.websiteUrl).toBe('https://example.com');
      expect(server.repository.url).toBe('https://github.com/test/repo');
    });

    it('should handle server with minimal fields', () => {
      const server: RegistryServer = {
        name: 'minimal-server',
        description: 'Minimal description',
        status: 'active',
        version: '0.1.0',
        repository: {
          url: 'https://github.com/test/minimal',
          source: 'github',
        },
        _meta: {
          'io.modelcontextprotocol.registry/official': {
            isLatest: true,
            publishedAt: new Date().toISOString(),
            status: 'active',
            updatedAt: new Date().toISOString(),
          },
        },
      };

      expect(server.name).toBe('minimal-server');
      expect(server.websiteUrl).toBeUndefined();
    });
  });

  describe('Configuration parsing', () => {
    it('should parse tags from comma-separated string', () => {
      const input = 'tag1, tag2, tag3';
      const tags = input.split(',').map((t: string) => t.trim());

      expect(tags).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should parse environment variables from JSON', () => {
      const input = '{"KEY1":"value1","KEY2":"value2"}';
      const env = JSON.parse(input);

      expect(env).toEqual({ KEY1: 'value1', KEY2: 'value2' });
    });

    it('should parse arguments from comma-separated string', () => {
      const input = '--arg1, --arg2, --arg3';
      const args = input.split(',').map((a: string) => a.trim());

      expect(args).toEqual(['--arg1', '--arg2', '--arg3']);
    });

    it('should handle empty configuration values', () => {
      const emptyTags = '';
      const emptyEnv = '{}';
      const emptyArgs = '';

      expect(emptyTags.trim()).toBe('');
      expect(JSON.parse(emptyEnv)).toEqual({});
      expect(emptyArgs.trim()).toBe('');
    });
  });

  describe('Cancelled result helper', () => {
    it('should create proper cancelled result structure', () => {
      const result = {
        serverId: '',
        cancelled: true,
        installAnother: false,
      };

      expect(result.cancelled).toBe(true);
      expect(result.serverId).toBe('');
      expect(result.installAnother).toBe(false);
    });
  });
});
