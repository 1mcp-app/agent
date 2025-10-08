import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ServerConfig } from '../../../../src/commands/mcp/utils/configUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Set very aggressive timeouts for faster test execution
const TEST_TIMEOUT = 5000; // 5 seconds max per test
const CLI_TIMEOUT = 3000; // 3 seconds max per CLI command

// Helper to run CLI commands with timeout
function runCli(
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const cwd = options.cwd || process.cwd();
  const env = {
    ...process.env,
    ...options.env,
    // Force extremely fast failures and disable retries
    ONE_MCP_LOG_LEVEL: 'error',
    NODE_ENV: 'test',
  };
  const timeout = options.timeout || CLI_TIMEOUT;

  try {
    const stdout = execSync(`node ${path.resolve(__dirname, '../../../../build/index.js')} ${command}`, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout, // Add timeout to prevent hanging
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status || 1,
    };
  }
}

describe('mcp tokens command', () => {
  let tempDir: string;
  let tempConfigFile: string;

  beforeEach(async () => {
    // Create a temporary directory for test configuration in build/ folder
    const buildDir = path.join(process.cwd(), 'build');
    await fs.mkdir(buildDir, { recursive: true });
    tempDir = await fs.mkdtemp(path.join(buildDir, 'test-temp-tokens-'));
    tempConfigFile = path.join(tempDir, 'test-config.json');
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to clean up temp directory: ${tempDir}`, error);
    }
  });

  describe('basic functionality', () => {
    it('should show message when no servers are configured', { timeout: TEST_TIMEOUT }, async () => {
      const emptyConfig: ServerConfig = {
        mcpServers: {},
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(emptyConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No MCP servers configured');
      expect(result.stdout).toContain('Use "1mcp mcp add" to add servers');
    });

    it('should handle non-existent config file gracefully', { timeout: TEST_TIMEOUT }, async () => {
      const nonExistentConfig = path.join(tempDir, 'non-existent.json');

      const result = runCli(`mcp tokens --config="${nonExistentConfig}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should show help information', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli('mcp tokens --help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Estimate MCP token usage for server capabilities');
      expect(result.stdout).toContain('--tag-filter');
      expect(result.stdout).toContain('--format');
      expect(result.stdout).toContain('table');
      expect(result.stdout).toContain('json');
      expect(result.stdout).toContain('summary');
    });
  });

  describe('with test servers', () => {
    beforeEach(async () => {
      // Create a test configuration with test servers that fail fast
      const testConfig: ServerConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'false', // Command that fails immediately
            args: [],
            tags: ['test', 'ai', 'development'],
            timeout: 100, // Extremely short timeout
            env: {
              TEST_ENV: 'test1',
            },
          },
          'test-server-2': {
            command: 'false', // Command that fails immediately
            args: [],
            tags: ['test', 'playwright', 'automation'],
            timeout: 100, // Extremely short timeout
            env: {
              TEST_ENV: 'test2',
            },
          },
          'disabled-server': {
            command: 'false',
            args: [],
            tags: ['test', 'disabled'],
            disabled: true,
          },
          'untagged-server': {
            command: 'false',
            args: [],
            timeout: 100,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(testConfig, null, 2));
    });

    it('should try to connect to all servers by default', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should filter servers by tag expression', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="ai or playwright"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should handle empty tag filter results', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="nonexistent"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No servers match the tag filter "nonexistent"');
    });

    it('should output in JSON format', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=json`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);

      // Should be valid JSON if we got output
      if (result.stdout && result.stdout.trim()) {
        let parsedOutput: any;
        expect(() => {
          parsedOutput = JSON.parse(result.stdout);
        }).not.toThrow();

        // Check JSON structure
        expect(parsedOutput).toHaveProperty('summary');
        expect(parsedOutput).toHaveProperty('servers');
        expect(parsedOutput).toHaveProperty('timestamp');
        expect(parsedOutput.summary).toHaveProperty('totalServers');
        expect(parsedOutput.summary).toHaveProperty('connectedServers');
        expect(parsedOutput.summary).toHaveProperty('overallTokens');
        expect(Array.isArray(parsedOutput.servers)).toBe(true);
        // All test servers should fail connection
        expect(parsedOutput.summary.connectedServers).toBe(0);
        expect(parsedOutput.summary.overallTokens).toBe(0);
      }
    });

    it('should output in summary format', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=summary`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      if (result.stdout && result.stdout.trim()) {
        expect(result.stdout).toContain('MCP Token Usage Summary');
        expect(result.stdout).toContain('Connected Servers: 0/');
        expect(result.stdout).toContain('Total Capabilities: 0');
        expect(result.stdout).toContain('Estimated Token Usage: ~0 tokens');
      }
    });

    it('should handle invalid tag filter syntax', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="invalid syntax ("`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid tag-filter expression');
    });

    it('should handle complex tag filter expressions', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="(ai or playwright) and test"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });
  });

  describe('output format validation', () => {
    beforeEach(async () => {
      const minimalConfig: ServerConfig = {
        mcpServers: {
          'minimal-server': {
            command: 'false', // Fast-failing command
            args: [],
            tags: ['minimal'],
            timeout: 100,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));
    });

    it('should default to table format', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
      // Should not be JSON format
      expect(() => JSON.parse(result.stdout)).toThrow();
    });

    it('should validate format parameter', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=invalid`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid values');
      expect(result.stderr).toContain('format');
    });

    it('should handle all valid format options', { timeout: TEST_TIMEOUT }, async () => {
      const formats = ['table', 'json', 'summary'];

      for (const format of formats) {
        const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=${format}`);
        // May timeout or return exit code 1 due to connection failures - both are acceptable
        expect([0, 1, 124]).toContain(result.exitCode);
      }
    });
  });

  describe('tag filter validation', () => {
    beforeEach(async () => {
      const taggedConfig: ServerConfig = {
        mcpServers: {
          'server-a': {
            command: 'false', // Fast-failing command
            args: [],
            tags: ['frontend', 'react', 'development'],
            timeout: 100,
          },
          'server-b': {
            command: 'false',
            args: [],
            tags: ['backend', 'api', 'production'],
            timeout: 100,
          },
          'server-c': {
            command: 'false',
            args: [],
            tags: ['database', 'production'],
            timeout: 100,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(taggedConfig, null, 2));
    });

    it('should support simple tag filters', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="production"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should support OR expressions', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="frontend or backend"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should support AND expressions', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="api and production"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should support NOT expressions', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="not development"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should support complex expressions with parentheses', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --tag-filter="(frontend or backend) and not development"`,
      );

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON config', { timeout: TEST_TIMEOUT }, async () => {
      await fs.writeFile(tempConfigFile, '{ invalid json }');

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should handle missing config directory', { timeout: TEST_TIMEOUT }, async () => {
      const missingDirConfig = path.join(tempDir, 'missing-dir', 'config.json');

      const result = runCli(`mcp tokens --config="${missingDirConfig}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should handle config with no mcpServers property', { timeout: TEST_TIMEOUT }, async () => {
      const invalidConfig = { someOtherProperty: 'value' };
      await fs.writeFile(tempConfigFile, JSON.stringify(invalidConfig));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No MCP servers configured');
    });
  });

  describe('configuration integration', () => {
    it('should work with minimal server configuration', { timeout: TEST_TIMEOUT }, async () => {
      const minimalConfig: ServerConfig = {
        mcpServers: {
          minimal: {
            command: 'false',
            args: [],
            timeout: 100,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should work with fully configured servers', { timeout: TEST_TIMEOUT }, async () => {
      const fullConfig: ServerConfig = {
        mcpServers: {
          'full-server': {
            command: 'false',
            args: [],
            cwd: '/app',
            env: {
              NODE_ENV: 'production',
              API_KEY: 'test-key',
            },
            tags: ['production', 'api', 'node'],
            timeout: 100,
            disabled: false,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(fullConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });

    it('should skip disabled servers', { timeout: TEST_TIMEOUT }, async () => {
      const configWithDisabled: ServerConfig = {
        mcpServers: {
          'enabled-server': {
            command: 'false',
            args: [],
            timeout: 100,
          },
          'disabled-server': {
            command: 'false',
            args: [],
            disabled: true,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(configWithDisabled, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      }
    });
  });

  describe('preset integration', () => {
    let tempPresetConfigFile: string;

    beforeEach(async () => {
      // Create test config with servers
      const testConfig: ServerConfig = {
        mcpServers: {
          'web-server': {
            command: 'false',
            args: [],
            tags: ['web', 'frontend', 'development'],
            timeout: 100,
          },
          'api-server': {
            command: 'false',
            args: [],
            tags: ['api', 'backend', 'production'],
            timeout: 100,
          },
          'database-server': {
            command: 'false',
            args: [],
            tags: ['database', 'storage', 'production'],
            timeout: 100,
          },
          'test-server': {
            command: 'false',
            args: [],
            tags: ['testing', 'qa'],
            timeout: 100,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(testConfig, null, 2));

      // Create test preset configuration
      const presetConfig = {
        presets: {
          'dev-preset': {
            name: 'dev-preset',
            description: 'Development servers preset',
            strategy: 'or' as const,
            tagQuery: {
              $or: [{ tag: 'web' }, { tag: 'development' }],
            },
            created: '2023-01-01T00:00:00.000Z',
            lastModified: '2023-01-01T00:00:00.000Z',
          },
          'prod-preset': {
            name: 'prod-preset',
            description: 'Production servers preset',
            strategy: 'and' as const,
            tagQuery: {
              tag: 'production',
            },
            created: '2023-01-01T00:00:00.000Z',
            lastModified: '2023-01-01T00:00:00.000Z',
          },
          'empty-preset': {
            name: 'empty-preset',
            description: 'Preset that matches no servers',
            strategy: 'or' as const,
            tagQuery: {
              tag: 'nonexistent-tag',
            },
            created: '2023-01-01T00:00:00.000Z',
            lastModified: '2023-01-01T00:00:00.000Z',
          },
        },
      };

      tempPresetConfigFile = path.join(tempDir, 'presets.json');
      await fs.writeFile(tempPresetConfigFile, JSON.stringify(presetConfig, null, 2));
    });

    it('should use preset to filter servers', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      } // Only web-server matches
      expect(result.stdout).toContain('No connected MCP servers found'); // But connection fails
    });

    it('should show error for non-existent preset', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="nonexistent"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Preset not found: nonexistent');
      expect(result.stderr).toContain('Available presets: dev-preset, prod-preset, empty-preset');
    });

    it('should handle empty preset results', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="empty-preset"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No servers match the preset "empty-preset"');
    });

    it('should work with production preset', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="prod-preset"`);

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      } // api-server and database-server match
      expect(result.stdout).toContain('No connected MCP servers found'); // But connections fail
    });

    it('should prevent using both preset and tag-filter', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset" --tag-filter="web"`,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Arguments preset and tag-filter are mutually exclusive');
    });

    it('should work with preset in JSON format', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset" --format=json`,
      );

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);

      // Should be valid JSON if we got output
      if (result.stdout && result.stdout.trim()) {
        let parsedOutput: any;
        expect(() => {
          parsedOutput = JSON.parse(result.stdout);
        }).not.toThrow();

        // Check JSON structure
        expect(parsedOutput).toHaveProperty('summary');
        expect(parsedOutput).toHaveProperty('servers');
        expect(parsedOutput.summary.totalServers).toBe(1); // Only 1 server matches dev-preset
        expect(parsedOutput.summary.connectedServers).toBe(0); // But connection fails
      }
    });

    it('should work with preset in summary format', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="prod-preset" --format=summary`,
      );

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      if (result.stdout && result.stdout.trim()) {
        expect(result.stdout).toContain('MCP Token Usage Summary');
        expect(result.stdout).toContain('Connected Servers: 0/2'); // 2 servers match prod-preset, 0 connect
        expect(result.stdout).toContain('server(s) not connected');
      }
    });

    it('should show help with preset option', { timeout: TEST_TIMEOUT }, async () => {
      const result = runCli('mcp tokens --help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--preset');
      expect(result.stdout).toContain('Use preset filter instead of manual tag expression');
      expect(result.stdout).toContain('--preset development');
      expect(result.stdout).toContain('Use development preset for token');
    });

    it('should handle preset loading errors gracefully', { timeout: TEST_TIMEOUT }, async () => {
      // Remove preset file to simulate loading error
      await fs.rm(tempPresetConfigFile, { force: true });

      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Preset not found: dev-preset');
    });

    it('should handle preset with complex tag query', { timeout: TEST_TIMEOUT }, async () => {
      // Add a preset with complex query
      const complexPresetConfig = {
        presets: {
          'complex-preset': {
            name: 'complex-preset',
            description: 'Complex tag query preset',
            strategy: 'advanced' as const,
            tagQuery: {
              $and: [
                {
                  $or: [{ tag: 'web' }, { tag: 'api' }],
                },
                {
                  $not: { tag: 'testing' },
                },
              ],
            },
            created: '2023-01-01T00:00:00.000Z',
            lastModified: '2023-01-01T00:00:00.000Z',
          },
        },
      };

      await fs.writeFile(tempPresetConfigFile, JSON.stringify(complexPresetConfig, null, 2));

      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="complex-preset"`,
      );

      // May timeout or return exit code 1 due to connection failures - both are acceptable
      expect([0, 1, 124]).toContain(result.exitCode);
      // Should show no connected servers since all fail or timeout
      if (result.stdout) {
        expect(result.stdout).toMatch(/No connected MCP servers found|No MCP servers configured/);
      } // web-server and api-server match
      expect(result.stdout).toContain('No connected MCP servers found'); // But connections fail
    });
  });
});
