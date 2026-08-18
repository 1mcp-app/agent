// sort-imports-ignore
import './transportFactory.testSetup.js';

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import { activateRuntimeScopeEnvironment } from '@src/config/runtimeScopeEnv.js';
import { MCPServerParams, transportConfigSchema } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTransports, createTransportsWithContext } from './transportFactory.js';

describe('TransportFactory environment substitution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateRuntimeScopeEnvironment({});
  });

  it('substitutes stdio references and explicit inheritance from Runtime Scope values', () => {
    delete process.env.RUNTIME_SCOPE_TOKEN;
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_TOKEN: 'scope-value' });
    const config: Record<string, MCPServerParams> = {
      scoped: {
        type: 'stdio',
        command: 'node',
        args: ['server.js', '$RUNTIME_SCOPE_TOKEN'],
        inheritParentEnv: true,
        envFilter: ['RUNTIME_SCOPE_TOKEN'],
      },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);

    createTransports(config);

    expect(StdioClientTransport).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['server.js', 'scope-value'], env: { RUNTIME_SCOPE_TOKEN: 'scope-value' } }),
    );
  });

  it('uses parent values ahead of Runtime Scope values', () => {
    process.env.RUNTIME_SCOPE_PRECEDENCE = 'parent-value';
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_PRECEDENCE: 'scope-value' });
    const config: Record<string, MCPServerParams> = {
      scoped: { type: 'stdio', command: 'node', args: ['$RUNTIME_SCOPE_PRECEDENCE'] },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);

    createTransports(config);

    expect(StdioClientTransport).toHaveBeenCalledWith(expect.objectContaining({ args: ['parent-value'] }));
    delete process.env.RUNTIME_SCOPE_PRECEDENCE;
  });

  it('substitutes Runtime Scope values in HTTP URLs, headers, and OAuth fields', () => {
    delete process.env.RUNTIME_SCOPE_HTTP;
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_HTTP: 'scope-value' });
    const config: Record<string, MCPServerParams> = {
      scoped: {
        type: 'http',
        url: 'https://$RUNTIME_SCOPE_HTTP.example.com/mcp',
        headers: { Authorization: 'Bearer ${RUNTIME_SCOPE_HTTP}' },
        oauth: {
          clientId: '$RUNTIME_SCOPE_HTTP',
          clientSecret: '${RUNTIME_SCOPE_HTTP}',
          redirectUrl: 'https://callback.example.com/$RUNTIME_SCOPE_HTTP',
          scopes: ['scope:${RUNTIME_SCOPE_HTTP}'],
        },
      },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);

    createTransports(config);

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL('https://scope-value.example.com/mcp'),
      expect.objectContaining({
        requestInit: { headers: expect.objectContaining({ Authorization: 'Bearer scope-value' }) },
      }),
    );
    expect(SDKOAuthClientProvider).toHaveBeenCalledWith(
      'scoped',
      expect.objectContaining({
        clientId: 'scope-value',
        clientSecret: 'scope-value',
        redirectUrl: 'https://callback.example.com/scope-value',
        scopes: ['scope:scope-value'],
      }),
      undefined,
    );
  });

  it.each(['http', 'sse'] as const)('redacts resolved Runtime Scope values from invalid %s URL errors', (type) => {
    const secret = 'must-not-appear';
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_INVALID_URL: `http://[${secret}` });
    const config: Record<string, MCPServerParams> = {
      scoped: { type, url: '$RUNTIME_SCOPE_INVALID_URL' },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);

    let thrown: unknown;
    try {
      createTransports(config);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(`${String(thrown)}\n${(thrown as Error).stack}\n${JSON.stringify(thrown)}`).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(secret);
  });

  it('redacts resolved values from contextual transport creation errors', async () => {
    const secret = 'context-secret-must-not-appear';
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_CONTEXT_URL: `http://[${secret}` });
    const config: Record<string, MCPServerParams> = {
      contextual: { type: 'http', url: '$RUNTIME_SCOPE_CONTEXT_URL' },
    };
    (transportConfigSchema.parse as any).mockImplementationOnce((value: MCPServerParams) => value);

    const thrown = await createTransportsWithContext(config, {
      project: { path: '/project' },
      user: {},
      environment: {},
    }).catch((error: unknown) => error);
    expect(`${String(thrown)}\n${(thrown as Error).stack}\n${JSON.stringify(thrown)}`).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(secret);
  });

  it('preserves unrelated OAuth constructor diagnostics unchanged', () => {
    const diagnostic = Object.assign(new TypeError('OAuth session storage is unavailable'), { code: 'EACCES' });
    const config: Record<string, MCPServerParams> = {
      scoped: { type: 'http', url: 'https://example.test/mcp' },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);
    vi.mocked(SDKOAuthClientProvider).mockImplementationOnce(function () {
      throw diagnostic;
    });

    let thrown: unknown;
    try {
      createTransports(config);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(diagnostic);
    expect((thrown as Error).message).toBe('OAuth session storage is unavailable');
    expect((thrown as Error & { code: string }).code).toBe('EACCES');
  });

  it('substitutes Runtime Scope values for SSE URLs and headers', () => {
    activateRuntimeScopeEnvironment({ RUNTIME_SCOPE_SSE: 'events.example.com' });
    const config: Record<string, MCPServerParams> = {
      scoped: {
        type: 'sse',
        url: 'https://$RUNTIME_SCOPE_SSE/events',
        headers: { Authorization: 'Bearer ${RUNTIME_SCOPE_SSE}' },
      },
    };
    (transportConfigSchema.parse as any).mockReturnValueOnce(config.scoped);

    createTransports(config);

    expect(SSEClientTransport).toHaveBeenCalledWith(
      new URL('https://events.example.com/events'),
      expect.objectContaining({ requestInit: { headers: { Authorization: 'Bearer events.example.com' } } }),
    );
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
