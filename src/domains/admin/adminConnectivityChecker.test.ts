import { McpConnectionHelper } from '@src/commands/shared/connectionHelper.js';

import { describe, expect, it, vi } from 'vitest';

import { createAdminConnectivityChecker } from './adminConnectivityChecker.js';

vi.mock('@src/commands/shared/connectionHelper.js', () => ({
  McpConnectionHelper: vi.fn(),
}));

describe('createAdminConnectivityChecker', () => {
  it('redacts URL userinfo from connectivity failure messages', async () => {
    const cleanup = vi.fn(async () => undefined);
    vi.mocked(McpConnectionHelper).mockImplementation(function () {
      return {
        connectToServers: vi.fn(async () => [
          {
            serverName: 'github',
            connected: false,
            tools: [],
            resources: [],
            prompts: [],
            error:
              'Failed to connect to https://user:raw-password@example.com/mcp?token=raw-token and https://user:raw pass@bad host/mcp and https://raw user@bad host/mcp',
          },
        ]),
        cleanup,
      } as unknown as McpConnectionHelper;
    });

    const result = await createAdminConnectivityChecker({ now: () => new Date('2026-07-07T00:00:00.000Z') })({
      targetName: 'github',
      serverConfig: {
        type: 'http',
        url: 'https://user:raw-password@example.com/mcp?token=${GITHUB_TOKEN}',
      },
    });

    expect(result).toEqual({
      status: 'failed',
      mode: 'bounded_dry_run',
      message:
        'Failed to connect to https://[REDACTED]@example.com/mcp?token=[REDACTED] and https://[REDACTED]@bad host/mcp and https://[REDACTED]@bad host/mcp',
    });
    expect(cleanup).toHaveBeenCalled();
  });

  it('redacts basic authorization and composite secret keys from connectivity failures', async () => {
    const cleanup = vi.fn(async () => undefined);
    vi.mocked(McpConnectionHelper).mockImplementation(function () {
      return {
        connectToServers: vi.fn(async () => [
          {
            serverName: 'github',
            connected: false,
            tools: [],
            resources: [],
            prompts: [],
            error: 'Authorization: Basic raw-basic-token clientSecret=raw-client-secret privateKey: raw-private-key',
          },
        ]),
        cleanup,
      } as unknown as McpConnectionHelper;
    });

    const result = await createAdminConnectivityChecker()({
      targetName: 'github',
      serverConfig: {
        type: 'http',
        url: 'https://api.example.com/mcp',
      },
    });

    expect(result).toEqual({
      status: 'failed',
      mode: 'bounded_dry_run',
      message: 'Authorization: [REDACTED] clientSecret=[REDACTED] privateKey: [REDACTED]',
    });
    expect(cleanup).toHaveBeenCalled();
  });

  it('redacts thrown connectivity errors before returning them', async () => {
    const cleanup = vi.fn(async () => undefined);
    vi.mocked(McpConnectionHelper).mockImplementation(function () {
      return {
        connectToServers: vi.fn(async () => {
          throw new Error('Failed with Basic raw-basic-token and clientSecret=raw-client-secret');
        }),
        cleanup,
      } as unknown as McpConnectionHelper;
    });

    const result = await createAdminConnectivityChecker()({
      targetName: 'github',
      serverConfig: {
        type: 'http',
        url: 'https://api.example.com/mcp',
      },
    });

    expect(result).toEqual({
      status: 'failed',
      mode: 'bounded_dry_run',
      message: 'Failed with Basic [REDACTED] and clientSecret=[REDACTED]',
    });
    expect(cleanup).toHaveBeenCalled();
  });
});
