import type { ContextData } from '@src/types/context.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxyCommand } from './proxy.js';

const proxyMocks = vi.hoisted(() => {
  const start = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const attachFreshClientSurface = vi.fn();
  const resolveServeTarget = vi.fn(async () => {
    throw new Error('legacy resolver should not be called');
  });

  return {
    attachFreshClientSurface,
    close,
    resolveServeTarget,
    start,
    transportOptions: [] as unknown[],
  };
});

vi.mock('@src/commands/shared/clientSurfaceAttachment.js', () => ({
  attachFreshClientSurface: proxyMocks.attachFreshClientSurface,
}));

vi.mock('@src/commands/shared/serveTargetResolver.js', () => ({
  resolveServeTarget: proxyMocks.resolveServeTarget,
}));

vi.mock('@src/transport/stdioProxyTransport.js', () => ({
  StdioProxyTransport: vi.fn().mockImplementation(function (options: unknown) {
    proxyMocks.transportOptions.push(options);
    return {
      close: proxyMocks.close,
      start: proxyMocks.start,
    };
  }),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

const context: ContextData = {
  project: {
    path: '/tmp/project',
    cwd: '/tmp/project/packages/api',
    name: 'project',
    environment: 'development',
  },
  user: {
    username: 'tester',
    home: '/tmp',
  },
  environment: {
    variables: {
      PWD: '/tmp/project/packages/api',
    },
  },
  sessionId: 'stream-shared',
  transport: {
    type: 'stdio-proxy',
  },
  version: 'proxy',
};

describe('proxyCommand', () => {
  let processOnSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    proxyMocks.transportOptions.length = 0;
    processOnSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    proxyMocks.attachFreshClientSurface.mockResolvedValue({
      target: {
        cwd: '/tmp/project/packages/api',
        projectRoot: '/tmp/project',
        projectConfig: null,
        mergedOptions: {
          'config-dir': '/tmp/config',
          filter: 'web,api',
        },
        discoveredUrl: 'http://127.0.0.1:3050/mcp',
        serverUrl: new URL('http://127.0.0.1:3050/mcp?filter=web%2Capi'),
        source: 'pidfile',
      },
      options: {
        'config-dir': '/tmp/config',
        filter: 'web,api',
      },
      baseUrl: 'http://127.0.0.1:3050',
      serverUrl: new URL('http://127.0.0.1:3050/mcp?filter=web%2Capi'),
      bearerToken: 'secret-token',
      context,
      contextHash: 'context-hash',
      requestSessionId: 'stream-shared',
      sessionId: 'stream-shared',
    });
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('starts the stdio proxy from a fresh client-surface attachment', async () => {
    await proxyCommand({ 'config-dir': '/tmp/config', filter: 'web,api' });

    expect(proxyMocks.resolveServeTarget).not.toHaveBeenCalled();
    expect(proxyMocks.attachFreshClientSurface).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSurface: 'stdio-proxy',
        options: { 'config-dir': '/tmp/config', filter: 'web,api' },
      }),
    );
    expect(proxyMocks.transportOptions).toEqual([
      {
        serverUrl: 'http://127.0.0.1:3050/mcp?filter=web%2Capi',
        bearerToken: 'secret-token',
        context,
      },
    ]);
    expect(proxyMocks.start).toHaveBeenCalledTimes(1);
    expect(processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith('SIGHUP', expect.any(Function));
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
