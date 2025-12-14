/**
 * Unit tests for MCP edit tool schemas
 */
import { describe, expect, it } from 'vitest';

import {
  type ConfigChange,
  type McpEditOutput,
  McpEditOutputSchema,
  type McpEditToolArgs,
  McpEditToolSchema,
} from './edit.js';

describe('McpEditToolSchema', () => {
  it('should validate required fields', () => {
    const invalidInput = {};
    const result = McpEditToolSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('name');
    }
  });

  it('should validate basic edit input', () => {
    const input: McpEditToolArgs = {
      name: 'test-server',
    };
    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should validate complete stdio server edit', () => {
    const input: McpEditToolArgs = {
      name: 'stdio-server',
      newName: 'new-stdio-server',
      tags: ['production', 'api'],
      disabled: false,
      connectionTimeout: 5000,
      requestTimeout: 10000,
      env: {
        NODE_ENV: 'production',
        DEBUG: 'true',
      },
      command: 'node',
      args: ['server.js', '--port', '8080'],
      cwd: '/app',
      inheritParentEnv: true,
      envFilter: ['PATH', 'NODE_ENV'],
      restartOnExit: true,
      maxRestarts: 3,
      restartDelay: 1000,
      preview: false,
      backup: true,
    };

    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should validate complete HTTP server edit', () => {
    const input: McpEditToolArgs = {
      name: 'http-server',
      newName: 'new-http-server',
      tags: ['web', 'api'],
      disabled: false,
      connectionTimeout: 3000,
      requestTimeout: 15000,
      env: {
        API_URL: 'https://api.example.com',
      },
      url: 'https://new-api.example.com/mcp',
      headers: {
        Authorization: 'Bearer token123',
        'User-Agent': '1MCP/1.0',
      },
      oauth: {
        clientId: 'client123',
        clientSecret: 'secret456',
        scopes: ['read', 'write'],
        autoRegister: true,
        redirectUrl: 'https://app.example.com/callback',
      },
      preview: true,
      backup: false,
    };

    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('should reject invalid timeout values', () => {
    const input = {
      name: 'test-server',
      timeout: -1000, // Negative timeout
    };
    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject invalid URLs', () => {
    const input = {
      name: 'test-server',
      url: 'not-a-valid-url',
    };
    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject maxRestarts negative values', () => {
    const input = {
      name: 'test-server',
      maxRestarts: -1, // Negative value not allowed
    };
    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it('should reject restartDelay negative values', () => {
    const input = {
      name: 'test-server',
      restartDelay: -100, // Negative value not allowed
    };
    const result = McpEditToolSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe('McpEditOutputSchema', () => {
  it('should validate successful output', () => {
    const output: McpEditOutput = {
      success: true,
      message: 'Server configuration updated successfully',
      serverName: 'test-server',
      changes: [
        {
          field: 'tags',
          oldValue: ['old-tag'],
          newValue: ['new-tag'],
        },
        {
          field: 'timeout',
          oldValue: 30000,
          newValue: 60000,
        },
      ],
      backupPath: '/config/backup/test-server-2025-12-06.json',
      reloadRecommended: true,
    };

    const result = McpEditOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('should validate preview output', () => {
    const output: McpEditOutput = {
      success: true,
      message: 'Preview of changes for server configuration',
      serverName: 'test-server',
      preview: true,
      changes: [
        {
          field: 'disabled',
          oldValue: false,
          newValue: true,
        },
      ],
    };

    const result = McpEditOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('should validate error output', () => {
    const output: McpEditOutput = {
      success: false,
      message: 'Failed to update server configuration',
      serverName: 'test-server',
      error: 'Server not found: test-server',
    };

    const result = McpEditOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('should validate output with warnings', () => {
    const output: McpEditOutput = {
      success: true,
      message: 'Server configuration updated with warnings',
      serverName: 'test-server',
      changes: [
        {
          field: 'url',
          oldValue: 'http://old-url.com',
          newValue: 'https://new-url.com',
        },
      ],
      warnings: ['Server is currently running and may need reload', 'URL protocol changed from http to https'],
      reloadRecommended: true,
    };

    const result = McpEditOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it('should require success and message fields', () => {
    const output = {
      serverName: 'test-server',
    };
    const result = McpEditOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fieldNames = result.error.issues.map((issue) => issue.path[0]);
      expect(fieldNames).toContain('success');
      expect(fieldNames).toContain('message');
    }
  });
});

describe('Type Exports', () => {
  it('should export ConfigChange interface', () => {
    const change: ConfigChange = {
      field: 'test-field',
      oldValue: 'old-value',
      newValue: 'new-value',
    };

    expect(change.field).toBe('test-field');
    expect(change.oldValue).toBe('old-value');
    expect(change.newValue).toBe('new-value');
  });
});
