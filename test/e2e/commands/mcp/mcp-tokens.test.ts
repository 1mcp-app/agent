import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { ServerConfig } from '../../../../src/commands/mcp/utils/configUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to run CLI commands
function runCli(
  command: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const cwd = options.cwd || process.cwd();
  const env = { ...process.env, ...options.env };

  try {
    const stdout = execSync(`node ${path.resolve(__dirname, '../../../../build/index.js')} ${command}`, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
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
    it('should show message when no servers are configured', async () => {
      const emptyConfig: ServerConfig = {
        mcpServers: {},
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(emptyConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No MCP servers configured');
      expect(result.stdout).toContain('Use "1mcp mcp add" to add servers');
    });

    it('should handle non-existent config file gracefully', async () => {
      const nonExistentConfig = path.join(tempDir, 'non-existent.json');

      const result = runCli(`mcp tokens --config="${nonExistentConfig}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should show help information', async () => {
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
            command: 'nonexistent-command-for-testing', // Command that doesn't exist for fast fail
            args: [],
            tags: ['test', 'ai', 'development'],
            env: {
              TEST_ENV: 'test1',
            },
          },
          'test-server-2': {
            command: 'nonexistent-command-for-testing', // Command that doesn't exist for fast fail
            args: [],
            tags: ['test', 'playwright', 'automation'],
            env: {
              TEST_ENV: 'test2',
            },
          },
          'disabled-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['test', 'disabled'],
            disabled: true,
          },
          'untagged-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(testConfig, null, 2));
    });

    it('should try to connect to all servers by default', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to');
      expect(result.stdout).toContain('MCP server(s) to analyze token usage');
      // Should show no connected servers since all fail
      expect(result.stdout).toContain('No connected MCP servers found');
    });

    it('should filter servers by tag expression', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="ai or playwright"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to');
      expect(result.stdout).toContain('MCP server(s) to analyze token usage');
      // Should show connection attempts for filtered servers
      expect(result.stdout).toContain('No connected MCP servers found');
    });

    it('should handle empty tag filter results', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="nonexistent"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No servers match the tag filter "nonexistent"');
    });

    it('should output in JSON format', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=json`);

      expect(result.exitCode).toBe(0);

      // Should be valid JSON
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
    });

    it('should output in summary format', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=summary`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MCP Token Usage Summary:');
      expect(result.stdout).toContain('Connected Servers: 0/');
      expect(result.stdout).toContain('Total Capabilities: 0');
      expect(result.stdout).toContain('Estimated Token Usage: ~0 tokens');
    });

    it('should handle invalid tag filter syntax', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="invalid syntax ("`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid tag-filter expression');
    });

    it('should handle complex tag filter expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="(ai or playwright) and test"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to');
      expect(result.stdout).toContain('MCP server(s) to analyze token usage');
      expect(result.stdout).toContain('No connected MCP servers found');
    });
  });

  describe('output format validation', () => {
    beforeEach(async () => {
      const minimalConfig: ServerConfig = {
        mcpServers: {
          'minimal-server': {
            command: 'nonexistent-command-for-testing', // Fast-failing command
            args: [],
            tags: ['minimal'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));
    });

    it('should default to table format', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No connected MCP servers found');
      // Should not be JSON format
      expect(() => JSON.parse(result.stdout)).toThrow();
    });

    it('should validate format parameter', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=invalid`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid values');
      expect(result.stderr).toContain('format');
    });

    it('should handle all valid format options', async () => {
      const formats = ['table', 'json', 'summary'];

      for (const format of formats) {
        const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=${format}`);
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe('tag filter validation', () => {
    beforeEach(async () => {
      const taggedConfig: ServerConfig = {
        mcpServers: {
          'server-a': {
            command: 'nonexistent-command-for-testing', // Fast-failing command
            args: [],
            tags: ['frontend', 'react', 'development'],
          },
          'server-b': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['backend', 'api', 'production'],
          },
          'server-c': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['database', 'production'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(taggedConfig, null, 2));
    });

    it('should support simple tag filters', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="production"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 2 MCP server(s)');
    });

    it('should support OR expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="frontend or backend"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 2 MCP server(s)');
    });

    it('should support AND expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="api and production"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)');
    });

    it('should support NOT expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="not development"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 2 MCP server(s)');
    });

    it('should support complex expressions with parentheses', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --tag-filter="(frontend or backend) and not development"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)');
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON config', async () => {
      await fs.writeFile(tempConfigFile, '{ invalid json }');

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should handle missing config directory', async () => {
      const missingDirConfig = path.join(tempDir, 'missing-dir', 'config.json');

      const result = runCli(`mcp tokens --config="${missingDirConfig}"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error');
    });

    it('should handle config with no mcpServers property', async () => {
      const invalidConfig = { someOtherProperty: 'value' };
      await fs.writeFile(tempConfigFile, JSON.stringify(invalidConfig));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No MCP servers configured');
    });
  });

  describe('configuration integration', () => {
    it('should work with minimal server configuration', async () => {
      const minimalConfig: ServerConfig = {
        mcpServers: {
          minimal: {
            command: 'nonexistent-command-for-testing',
            args: [],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)');
    });

    it('should work with fully configured servers', async () => {
      const fullConfig: ServerConfig = {
        mcpServers: {
          'full-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            cwd: '/app',
            env: {
              NODE_ENV: 'production',
              API_KEY: 'test-key',
            },
            tags: ['production', 'api', 'node'],
            timeout: 30000,
            disabled: false,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(fullConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)');
    });

    it('should skip disabled servers', async () => {
      const configWithDisabled: ServerConfig = {
        mcpServers: {
          'enabled-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
          },
          'disabled-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            disabled: true,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(configWithDisabled, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)');
    });
  });

  describe('preset integration', () => {
    let tempPresetConfigFile: string;

    beforeEach(async () => {
      // Create test config with servers
      const testConfig: ServerConfig = {
        mcpServers: {
          'web-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['web', 'frontend', 'development'],
          },
          'api-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['api', 'backend', 'production'],
          },
          'database-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['database', 'storage', 'production'],
          },
          'test-server': {
            command: 'nonexistent-command-for-testing',
            args: [],
            tags: ['testing', 'qa'],
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

    it('should use preset to filter servers', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 1 MCP server(s)'); // Only web-server matches
      expect(result.stdout).toContain('No connected MCP servers found'); // But connection fails
    });

    it('should show error for non-existent preset', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="nonexistent"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Preset not found: nonexistent');
      expect(result.stderr).toContain('Available presets: dev-preset, prod-preset, empty-preset');
    });

    it('should handle empty preset results', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="empty-preset"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No servers match the preset "empty-preset"');
    });

    it('should work with production preset', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="prod-preset"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 2 MCP server(s)'); // api-server and database-server match
      expect(result.stdout).toContain('No connected MCP servers found'); // But connections fail
    });

    it('should prevent using both preset and tag-filter', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset" --tag-filter="web"`,
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Arguments preset and tag-filter are mutually exclusive');
    });

    it('should work with preset in JSON format', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset" --format=json`,
      );

      expect(result.exitCode).toBe(0);

      // Should be valid JSON
      let parsedOutput: any;
      expect(() => {
        parsedOutput = JSON.parse(result.stdout);
      }).not.toThrow();

      // Check JSON structure
      expect(parsedOutput).toHaveProperty('summary');
      expect(parsedOutput).toHaveProperty('servers');
      expect(parsedOutput.summary.totalServers).toBe(1); // Only 1 server matches dev-preset
      expect(parsedOutput.summary.connectedServers).toBe(0); // But connection fails
    });

    it('should work with preset in summary format', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="prod-preset" --format=summary`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MCP Token Usage Summary:');
      expect(result.stdout).toContain('Connected Servers: 0/2'); // 2 servers match prod-preset, 0 connect
      expect(result.stdout).toContain('server(s) not connected');
    });

    it('should show help with preset option', async () => {
      const result = runCli('mcp tokens --help');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--preset');
      expect(result.stdout).toContain('Use preset filter instead of manual tag expression');
      expect(result.stdout).toContain('--preset development');
      expect(result.stdout).toContain('Use development preset for token');
    });

    it('should handle preset loading errors gracefully', async () => {
      // Remove preset file to simulate loading error
      await fs.rm(tempPresetConfigFile, { force: true });

      const result = runCli(`mcp tokens --config="${tempConfigFile}" --config-dir="${tempDir}" --preset="dev-preset"`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Preset not found: dev-preset');
    });

    it('should handle preset with complex tag query', async () => {
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

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Connecting to 2 MCP server(s)'); // web-server and api-server match
      expect(result.stdout).toContain('No connected MCP servers found'); // But connections fail
    });
  });
});
