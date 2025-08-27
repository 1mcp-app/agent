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
    // Create a temporary directory for test configuration
    tempDir = await fs.mkdtemp(path.join(process.cwd(), 'test-temp-tokens-'));
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

  describe('with mock servers', () => {
    beforeEach(async () => {
      // Create a test configuration with mock servers
      const testConfig: ServerConfig = {
        mcpServers: {
          'test-server-1': {
            command: 'echo',
            args: ['Hello from test server 1'],
            tags: ['test', 'ai', 'development'],
            env: {
              TEST_ENV: 'test1',
            },
          },
          'test-server-2': {
            command: 'echo',
            args: ['Hello from test server 2'],
            tags: ['test', 'playwright', 'automation'],
            env: {
              TEST_ENV: 'test2',
            },
          },
          'disabled-server': {
            command: 'echo',
            args: ['Hello from disabled server'],
            tags: ['test', 'disabled'],
            disabled: true,
          },
          'untagged-server': {
            command: 'echo',
            args: ['Hello from untagged server'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(testConfig, null, 2));
    });

    it('should analyze all servers by default', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
      expect(result.stdout).toContain('MCP server(s) for token estimation');
      expect(result.stdout).toContain('MCP Server Token Estimates');
    });

    it('should filter servers by tag expression', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="ai or playwright"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
      expect(result.stdout).toContain('MCP server(s) for token estimation');
      // Should analyze servers with 'ai' or 'playwright' tags
      expect(result.stdout).toContain('MCP Server Token Estimates');
    });

    it('should handle empty tag filter results', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="nonexistent"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No servers match the tag filter: nonexistent');
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
    });

    it('should output in summary format', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --format=summary`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MCP Token Usage Summary:');
      expect(result.stdout).toContain('Connected Servers:');
      expect(result.stdout).toContain('Total Capabilities:');
      expect(result.stdout).toContain('Estimated Token Usage:');
    });

    it('should handle invalid tag filter syntax', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="invalid syntax ("`);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid tag-filter expression');
    });

    it('should handle complex tag filter expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="(ai or playwright) and test"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
      expect(result.stdout).toContain('MCP server(s) for token estimation');
    });
  });

  describe('output format validation', () => {
    beforeEach(async () => {
      const minimalConfig: ServerConfig = {
        mcpServers: {
          'minimal-server': {
            command: 'echo',
            args: ['minimal test'],
            tags: ['minimal'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));
    });

    it('should default to table format', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('MCP Server Token Estimates');
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
            command: 'echo',
            args: ['server a'],
            tags: ['frontend', 'react', 'development'],
          },
          'server-b': {
            command: 'echo',
            args: ['server b'],
            tags: ['backend', 'api', 'production'],
          },
          'server-c': {
            command: 'echo',
            args: ['server c'],
            tags: ['database', 'production'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(taggedConfig, null, 2));
    });

    it('should support simple tag filters', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="production"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
    });

    it('should support OR expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="frontend or backend"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
    });

    it('should support AND expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="api and production"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
    });

    it('should support NOT expressions', async () => {
      const result = runCli(`mcp tokens --config="${tempConfigFile}" --tag-filter="not development"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
    });

    it('should support complex expressions with parentheses', async () => {
      const result = runCli(
        `mcp tokens --config="${tempConfigFile}" --tag-filter="(frontend or backend) and not development"`,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing');
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
            command: 'echo',
            args: ['hello'],
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(minimalConfig, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing 1 MCP server(s)');
    });

    it('should work with fully configured servers', async () => {
      const fullConfig: ServerConfig = {
        mcpServers: {
          'full-server': {
            command: 'node',
            args: ['server.js'],
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
      expect(result.stdout).toContain('Analyzing 1 MCP server(s)');
    });

    it('should skip disabled servers', async () => {
      const configWithDisabled: ServerConfig = {
        mcpServers: {
          'enabled-server': {
            command: 'echo',
            args: ['enabled'],
          },
          'disabled-server': {
            command: 'echo',
            args: ['disabled'],
            disabled: true,
          },
        },
      };

      await fs.writeFile(tempConfigFile, JSON.stringify(configWithDisabled, null, 2));

      const result = runCli(`mcp tokens --config="${tempConfigFile}"`);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Analyzing 1 MCP server(s)');
    });
  });
});
