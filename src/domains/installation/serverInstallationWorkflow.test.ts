import type { RegistryServer } from '@src/domains/registry/types.js';

import { describe, expect, it, vi } from 'vitest';

import {
  createServerInstallationWorkflow,
  type ServerInstallationWorkflowPorts,
} from './serverInstallationWorkflow.js';

describe('Server Installation Workflow', () => {
  it('returns a direct stdio preview without invoking Config Change', async () => {
    const applyConfigChange = vi.fn();
    const workflow = createWorkflow({ applyConfigChange });

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'direct',
        localName: 'local-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' },
        tags: ['local'],
      },
    });

    expect(result).toMatchObject({
      status: 'preview',
      targetName: 'local-server',
      sourceType: 'direct',
      config: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' },
        tags: ['local'],
      },
    });
    expect(result.configChange).toBeUndefined();
    expect(applyConfigChange).not.toHaveBeenCalled();
  });

  it('builds package-only direct stdio installs as npx commands', async () => {
    const workflow = createWorkflow();

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'direct',
        localName: 'package-server',
        transport: 'stdio',
        package: '@scope/pkg',
        args: ['--flag'],
      },
    });

    expect(result).toMatchObject({
      status: 'preview',
      targetName: 'package-server',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@scope/pkg', '--flag'],
      },
    });
  });

  it('returns invalid_input with field errors for malformed direct sources', async () => {
    const workflow = createWorkflow();

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'direct',
        localName: 'broken',
        transport: 'http',
        command: 'node',
      },
    });

    expect(result).toMatchObject({
      status: 'invalid_input',
      sourceType: 'direct',
      fieldErrors: {
        url: ['Direct http installs require url'],
        command: ['Direct http installs cannot include command'],
      },
    });
  });

  it('returns exists for static conflicts without force and template_conflict even with force', async () => {
    const workflow = createWorkflow({
      findConfiguredTarget: vi
        .fn()
        .mockReturnValueOnce({ name: 'conflict', source: 'mcpServers' })
        .mockReturnValueOnce({ name: 'template-name', source: 'mcpTemplates' }),
    });

    await expect(
      workflow.run({
        mode: 'apply',
        source: {
          type: 'direct',
          localName: 'conflict',
          transport: 'stdio',
          command: 'node',
        },
      }),
    ).resolves.toMatchObject({
      status: 'exists',
      targetName: 'conflict',
    });

    await expect(
      workflow.run({
        mode: 'apply',
        force: true,
        source: {
          type: 'direct',
          localName: 'template-name',
          transport: 'stdio',
          command: 'node',
        },
      }),
    ).resolves.toMatchObject({
      status: 'template_conflict',
      targetName: 'template-name',
    });
  });

  it('applies a static replacement through Config Change with required backup when forced', async () => {
    const applyConfigChange = vi.fn().mockResolvedValue({
      status: 'changed',
      operation: 'set_static',
      configPath: '/tmp/mcp.json',
      target: { name: 'existing', source: 'mcpServers' },
      changed: true,
      backup: { created: true, path: '/tmp/mcp.json.backup.1' },
      retentionCleanup: { attempted: true, deletedPaths: [], warnings: [] },
      reload: { status: 'observed' },
      warnings: [],
    });
    const workflow = createWorkflow({
      findConfiguredTarget: vi.fn(() => ({ name: 'existing', source: 'mcpServers' as const })),
      applyConfigChange,
    });

    const result = await workflow.run({
      mode: 'apply',
      force: true,
      source: {
        type: 'direct',
        localName: 'existing',
        transport: 'stdio',
        command: 'node',
      },
    });

    expect(result).toMatchObject({
      status: 'applied',
      targetName: 'existing',
      configChange: {
        backup: {
          path: '/tmp/mcp.json.backup.1',
        },
        reload: {
          status: 'observed',
        },
      },
    });
    expect(applyConfigChange).toHaveBeenCalledWith({
      targetName: 'existing',
      serverConfig: {
        type: 'stdio',
        command: 'node',
      },
      operation: 'install',
      backup: 'required',
    });
  });

  it('uses registry endpoint priority and result-only metadata', async () => {
    const registryServer = makeRegistryServer({
      packages: [
        { identifier: 'pkg:pypi', registryType: 'pypi' },
        { identifier: '@scope/npm-server', registryType: 'npm' },
      ],
      remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
    });
    const workflow = createWorkflow({
      getRegistryServer: vi.fn().mockResolvedValue(registryServer),
    });

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'registry',
        registryId: 'io.github.owner/server-name',
        version: '1.2.3',
        tags: ['custom'],
      },
    });

    expect(result).toMatchObject({
      status: 'preview',
      targetName: 'server-name',
      version: '1.0.0',
      selectedEndpoint: {
        kind: 'package',
        type: 'npm',
        identifier: '@scope/npm-server',
      },
      metadata: {
        registryId: 'io.github.owner/server-name',
        localName: 'server-name',
      },
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['@scope/npm-server'],
        tags: ['custom', 'server-name', 'io.github.owner/server-name'],
      },
    });
    expect(result.config).not.toHaveProperty('_metadata');
  });

  it('places registry package before runtime args', async () => {
    const workflow = createWorkflow({
      getRegistryServer: vi.fn().mockResolvedValue(
        makeRegistryServer({
          packages: [{ identifier: '@scope/npm-server', registryType: 'npm' }],
          remotes: [],
        }),
      ),
    });

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'registry',
        registryId: 'io.github.owner/server-name',
        args: ['--api-key', 'secret'],
      },
    });

    expect(result).toMatchObject({
      status: 'preview',
      config: {
        type: 'stdio',
        command: 'npx',
        args: ['@scope/npm-server', '--api-key', 'secret'],
      },
    });
  });

  it('prefers streamable-http remotes when no packages are available', async () => {
    const workflow = createWorkflow({
      getRegistryServer: vi.fn().mockResolvedValue(
        makeRegistryServer({
          packages: [],
          remotes: [
            { type: 'sse', url: 'https://example.com/sse' },
            { type: 'streamable-http', url: 'https://example.com/mcp' },
          ],
        }),
      ),
    });

    const result = await workflow.run({
      mode: 'preview',
      source: {
        type: 'registry',
        registryId: 'io.github.owner/remote-server',
      },
    });

    expect(result).toMatchObject({
      status: 'preview',
      selectedEndpoint: {
        kind: 'remote',
        type: 'streamable-http',
        url: 'https://example.com/mcp',
      },
      config: {
        type: 'http',
        url: 'https://example.com/mcp',
      },
    });
  });

  it('returns registry statuses instead of throwing for not-found and unavailable lookups', async () => {
    const notFoundWorkflow = createWorkflow({
      getRegistryServer: vi.fn().mockResolvedValue(null),
    });

    await expect(
      notFoundWorkflow.run({
        mode: 'preview',
        source: { type: 'registry', registryId: 'missing' },
      }),
    ).resolves.toMatchObject({
      status: 'not_found',
      sourceType: 'registry',
      registryId: 'missing',
    });

    const unavailableWorkflow = createWorkflow({
      getRegistryServer: vi.fn().mockRejectedValue(new Error('network down')),
    });

    await expect(
      unavailableWorkflow.run({
        mode: 'preview',
        source: { type: 'registry', registryId: 'unavailable' },
      }),
    ).resolves.toMatchObject({
      status: 'registry_unavailable',
      sourceType: 'registry',
      registryId: 'unavailable',
      error: 'network down',
    });
  });

  function createWorkflow(ports: ServerInstallationWorkflowPorts = {}) {
    return createServerInstallationWorkflow({
      findConfiguredTarget: vi.fn(() => null),
      applyConfigChange: vi.fn(),
      ...ports,
    });
  }

  function makeRegistryServer(overrides: Pick<RegistryServer, 'packages' | 'remotes'>): RegistryServer {
    return {
      name: 'io.github.owner/server-name',
      description: 'Test server',
      status: 'active',
      version: '1.0.0',
      repository: {
        source: 'github',
        url: 'https://github.com/owner/server-name',
      },
      packages: overrides.packages,
      remotes: overrides.remotes,
      _meta: {
        'io.modelcontextprotocol.registry/official': {
          isLatest: true,
          publishedAt: '2026-05-21T00:00:00Z',
          status: 'active',
          updatedAt: '2026-05-21T00:00:00Z',
        },
      },
    };
  }
});
