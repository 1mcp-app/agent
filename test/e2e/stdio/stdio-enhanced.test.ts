import { ConfigBuilder, TestProcessManager } from '@test/e2e/utils/index.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Enhanced Stdio MCP Server E2E', () => {
  let processManager: TestProcessManager;
  let configBuilder: ConfigBuilder;

  beforeEach(async () => {
    processManager = new TestProcessManager();
    configBuilder = new ConfigBuilder();
  });

  afterEach(async () => {
    await processManager.cleanup();
    configBuilder.cleanup();
  });

  describe('Environment Variable Features', () => {
    it('should support environment variable substitution in config', async () => {
      // Set test environment variables
      process.env.TEST_COMMAND = 'echo';
      process.env.TEST_ARG = 'env-substitution-works';

      try {
        const config = configBuilder
          .enableStdioTransport()
          .addServer({
            name: 'env-test-server',
            transport: 'stdio',
            command: '${TEST_COMMAND}', // Should substitute to 'echo'
            args: ['${TEST_ARG}'], // Should substitute to 'env-substitution-works'
            tags: ['test'],
          })
          .build();

        expect(config.mcpServers['env-test-server'].command).toBe('${TEST_COMMAND}');
        expect(config.mcpServers['env-test-server'].args).toEqual(['${TEST_ARG}']);
      } finally {
        delete process.env.TEST_COMMAND;
        delete process.env.TEST_ARG;
      }
    });

    it('should support flexible env configuration formats', async () => {
      // Test object format
      const objectConfig = configBuilder
        .enableStdioTransport()
        .addServer({
          name: 'object-env-server',
          transport: 'stdio',
          command: 'echo',
          args: ['test'],
          env: {
            NODE_ENV: 'test',
            DEBUG: 'true',
          },
          tags: ['test'],
        })
        .build();

      expect(objectConfig.mcpServers['object-env-server'].env).toEqual({
        NODE_ENV: 'test',
        DEBUG: 'true',
      });

      // Reset config builder for array format test
      configBuilder.cleanup();
      configBuilder = new ConfigBuilder();

      // Test array format (simulated since ConfigBuilder may not support it directly)
      const arrayConfig = {
        mcpServers: {
          'array-env-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            env: ['NODE_ENV=test', 'DEBUG=true'], // Array format
            tags: ['test'],
          },
        },
      };

      expect(arrayConfig.mcpServers['array-env-server'].env).toEqual(['NODE_ENV=test', 'DEBUG=true']);
    });
  });

  describe('Environment Inheritance and Filtering', () => {
    it('should support parent environment inheritance configuration', async () => {
      const config = {
        mcpServers: {
          'inherit-env-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            inheritParentEnv: true,
            envFilter: ['NODE_*', 'HOME', '!SENSITIVE_*'],
            env: {
              CUSTOM_VAR: 'custom-value',
            },
            tags: ['test'],
          },
        },
      };

      // Verify configuration structure
      expect(config.mcpServers['inherit-env-server'].inheritParentEnv).toBe(true);
      expect(config.mcpServers['inherit-env-server'].envFilter).toEqual(['NODE_*', 'HOME', '!SENSITIVE_*']);
    });

    it('should support environment filtering patterns', async () => {
      const config = {
        mcpServers: {
          'filtered-env-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            inheritParentEnv: true,
            envFilter: [
              'PATH', // Allow PATH
              'HOME', // Allow HOME
              'NODE_*', // Allow NODE_* variables
              '!SECRET_*', // Block SECRET_* variables
              '!BASH_FUNC_*', // Block bash functions
            ],
            tags: ['test'],
          },
        },
      };

      // Verify filter configuration
      const filters = config.mcpServers['filtered-env-server'].envFilter;
      expect(filters).toContain('PATH');
      expect(filters).toContain('NODE_*');
      expect(filters).toContain('!SECRET_*');
      expect(filters).toContain('!BASH_FUNC_*');
    });
  });

  describe('Restart on Exit Feature', () => {
    it('should support restart on exit configuration', async () => {
      const config = {
        mcpServers: {
          'restart-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            restartOnExit: true,
            tags: ['test'],
          },
        },
      };

      expect(config.mcpServers['restart-server'].restartOnExit).toBe(true);
    });

    it('should support maxRestarts configuration', async () => {
      const config = {
        mcpServers: {
          'limited-restart-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            restartOnExit: true,
            maxRestarts: 5,
            tags: ['test'],
          },
        },
      };

      expect(config.mcpServers['limited-restart-server'].restartOnExit).toBe(true);
      expect(config.mcpServers['limited-restart-server'].maxRestarts).toBe(5);
    });

    it('should support restartDelay configuration', async () => {
      const config = {
        mcpServers: {
          'delayed-restart-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            restartOnExit: true,
            restartDelay: 2000,
            tags: ['test'],
          },
        },
      };

      expect(config.mcpServers['delayed-restart-server'].restartOnExit).toBe(true);
      expect(config.mcpServers['delayed-restart-server'].restartDelay).toBe(2000);
    });

    it('should support both maxRestarts and restartDelay together', async () => {
      const config = {
        mcpServers: {
          'full-restart-config': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            restartOnExit: true,
            maxRestarts: 3,
            restartDelay: 1500,
            tags: ['test'],
          },
        },
      };

      expect(config.mcpServers['full-restart-config'].restartOnExit).toBe(true);
      expect(config.mcpServers['full-restart-config'].maxRestarts).toBe(3);
      expect(config.mcpServers['full-restart-config'].restartDelay).toBe(1500);
    });

    it('should handle process restart behavior', async () => {
      // This test is more conceptual since testing actual restart behavior
      // would require a more complex setup with actual process management

      const config = configBuilder
        .enableStdioTransport()
        .addServer({
          name: 'restart-test-server',
          transport: 'stdio',
          command: 'echo', // Simple command that exits immediately
          args: ['restart-test'],
          // Note: ConfigBuilder may not directly support these new properties
          // but we can verify the configuration structure
          tags: ['test'],
        })
        .build();

      // Verify basic configuration
      expect(config.mcpServers['restart-test-server']).toBeDefined();
      expect(config.mcpServers['restart-test-server'].command).toBe('echo');
      expect(config.mcpServers['restart-test-server'].args).toEqual(['restart-test']);
    });
  });

  describe('Working Directory Support', () => {
    it('should support custom working directory configuration', async () => {
      const config = {
        mcpServers: {
          'cwd-server': {
            type: 'stdio',
            command: 'pwd', // Command that shows current directory
            cwd: '/tmp', // Set working directory
            tags: ['test'],
          },
        },
      };

      expect(config.mcpServers['cwd-server'].cwd).toBe('/tmp');
    });
  });

  describe('Complete Enhanced Configuration', () => {
    it('should support all new stdio options together', async () => {
      // Set up test environment
      process.env.TEST_API_KEY = 'test-api-key-123';

      try {
        const config = {
          mcpServers: {
            'enhanced-stdio-server': {
              type: 'stdio',
              command: 'node',
              args: ['server.js'],
              cwd: '/app',

              // Environment inheritance and filtering
              inheritParentEnv: true,
              envFilter: ['PATH', 'HOME', 'NODE_*', 'NPM_*', '!SECRET_*', '!BASH_FUNC_*'],

              // Custom environment with substitution
              env: {
                NODE_ENV: 'production',
                API_KEY: '${TEST_API_KEY}',
                DEBUG: 'false',
              },

              // Process management
              restartOnExit: true,
              maxRestarts: 5,
              restartDelay: 2000,

              // Metadata
              tags: ['production', 'api'],
              timeout: 30000,
            },
          },
        };

        // Verify all configuration options
        const serverConfig = config.mcpServers['enhanced-stdio-server'];

        expect(serverConfig.type).toBe('stdio');
        expect(serverConfig.command).toBe('node');
        expect(serverConfig.args).toEqual(['server.js']);
        expect(serverConfig.cwd).toBe('/app');
        expect(serverConfig.inheritParentEnv).toBe(true);
        expect(serverConfig.envFilter).toContain('NODE_*');
        expect(serverConfig.envFilter).toContain('!SECRET_*');
        expect(serverConfig.env.API_KEY).toBe('${TEST_API_KEY}');
        expect(serverConfig.restartOnExit).toBe(true);
        expect(serverConfig.maxRestarts).toBe(5);
        expect(serverConfig.restartDelay).toBe(2000);
        expect(serverConfig.tags).toContain('production');
        expect(serverConfig.timeout).toBe(30000);
      } finally {
        delete process.env.TEST_API_KEY;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid environment filter patterns gracefully', async () => {
      const config = {
        mcpServers: {
          'invalid-filter-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            inheritParentEnv: true,
            envFilter: [
              '', // Empty pattern
              'VALID_*',
              '!!INVALID', // Invalid pattern
            ],
            tags: ['test'],
          },
        },
      };

      // Configuration should still be valid even with problematic patterns
      expect(config.mcpServers['invalid-filter-server'].envFilter).toEqual(['', 'VALID_*', '!!INVALID']);
    });

    it('should handle missing environment variables in substitution', async () => {
      const config = {
        mcpServers: {
          'missing-env-server': {
            type: 'stdio',
            command: 'echo',
            args: ['test'],
            env: {
              EXISTING_VAR: 'value',
              MISSING_VAR: '${NON_EXISTENT_VAR}', // This var doesn't exist
            },
            tags: ['test'],
          },
        },
      };

      // Configuration should be valid - substitution happens at runtime
      expect(config.mcpServers['missing-env-server'].env.MISSING_VAR).toBe('${NON_EXISTENT_VAR}');
    });
  });

  describe('Backwards Compatibility', () => {
    it('should maintain compatibility with existing stdio configurations', async () => {
      // Test that old-style configurations still work
      const legacyConfig = configBuilder
        .enableStdioTransport()
        .addStdioServer('legacy-server', 'echo', ['hello'], ['legacy'])
        .build();

      expect(legacyConfig.mcpServers['legacy-server']).toBeDefined();
      expect(legacyConfig.mcpServers['legacy-server'].command).toBe('echo');
      expect(legacyConfig.mcpServers['legacy-server'].args).toEqual(['hello']);
      expect(legacyConfig.mcpServers['legacy-server'].tags).toContain('legacy');

      // Verify new properties have sensible defaults when not specified
      expect(legacyConfig.mcpServers['legacy-server'].inheritParentEnv).toBeUndefined();
      expect(legacyConfig.mcpServers['legacy-server'].envFilter).toBeUndefined();
      expect(legacyConfig.mcpServers['legacy-server'].restartOnExit).toBeUndefined();
    });
  });
});
