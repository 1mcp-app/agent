// sort-imports-ignore
import './transportFactory.testSetup.js';

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { MCPServerParams, transportConfigSchema } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTransports } from './transportFactory.js';

describe('TransportFactory environment substitution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should substitute stdio args from the filtered inherited environment', () => {
    process.env.CONTEXT7_API_KEY = 'context7-key';

    const config: Record<string, MCPServerParams> = {
      context7: {
        type: 'stdio',
        command: 'bunx',
        args: ['@upstash/context7-mcp@latest', '--api-key', '$CONTEXT7_API_KEY'],
        inheritParentEnv: true,
        envFilter: ['CONTEXT7_API_KEY'],
      },
    };

    (transportConfigSchema.parse as any).mockReturnValueOnce(config.context7);

    createTransports(config);

    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'bunx',
        args: ['@upstash/context7-mcp@latest', '--api-key', 'context7-key'],
        env: { CONTEXT7_API_KEY: 'context7-key' },
      }),
    );
  });

  it('should substitute stdio args when envFilter includes merged serverDefaults entries', () => {
    process.env.CONTEXT7_API_KEY = 'context7-key';

    const config: Record<string, MCPServerParams> = {
      context7: {
        type: 'stdio',
        command: 'bunx',
        args: ['@upstash/context7-mcp@latest', '--api-key', '${CONTEXT7_API_KEY}'],
        inheritParentEnv: true,
        envFilter: ['UV_*', 'https_proxy', 'HTTP_PROXY', 'no_proxy', 'CONTEXT7_API_KEY'],
      },
    };

    (transportConfigSchema.parse as any).mockReturnValueOnce(config.context7);

    createTransports(config);

    expect(logger.warn).not.toHaveBeenCalledWith(
      'Environment variable CONTEXT7_API_KEY not found, keeping placeholder: ${CONTEXT7_API_KEY}',
    );
    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['@upstash/context7-mcp@latest', '--api-key', 'context7-key'],
        env: expect.objectContaining({ CONTEXT7_API_KEY: 'context7-key' }),
      }),
    );
  });

  it('should substitute custom stdio env from the filtered inherited environment', () => {
    process.env.CONTEXT7_API_KEY = 'context7-key';

    const config: Record<string, MCPServerParams> = {
      context7: {
        type: 'stdio',
        command: 'bunx',
        args: ['@upstash/context7-mcp@latest'],
        inheritParentEnv: true,
        envFilter: ['CONTEXT7_API_KEY'],
        env: {
          CONTEXT7_TOKEN_COPY: '${CONTEXT7_API_KEY}',
        },
      },
    };

    (transportConfigSchema.parse as any).mockReturnValueOnce(config.context7);

    createTransports(config);

    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          CONTEXT7_API_KEY: 'context7-key',
          CONTEXT7_TOKEN_COPY: 'context7-key',
        },
      }),
    );
  });

  it('should warn for missing stdio placeholders after environment filtering', () => {
    delete process.env.CONTEXT7_API_KEY;

    const config: Record<string, MCPServerParams> = {
      context7: {
        type: 'stdio',
        command: 'bunx',
        args: ['@upstash/context7-mcp@latest', '--api-key', '${CONTEXT7_API_KEY}'],
        inheritParentEnv: true,
        envFilter: ['CONTEXT7_API_KEY'],
      },
    };

    (transportConfigSchema.parse as any).mockReturnValueOnce(config.context7);

    createTransports(config);

    const environmentProcessingLog = vi
      .mocked(debugIf)
      .mock.calls.map(([messageOrFactory]) =>
        typeof messageOrFactory === 'function' ? messageOrFactory() : messageOrFactory,
      )
      .find(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          'meta' in entry &&
          typeof (entry as { meta?: { totalVariables?: unknown } }).meta?.totalVariables === 'number',
      );
    expect((environmentProcessingLog as { meta?: { totalVariables?: number } } | undefined)?.meta?.totalVariables).toBe(
      0,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'Environment variable CONTEXT7_API_KEY not found, keeping placeholder unchanged',
    );
    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['@upstash/context7-mcp@latest', '--api-key', '${CONTEXT7_API_KEY}'],
        env: {},
      }),
    );
  });
});
