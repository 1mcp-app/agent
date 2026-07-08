import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ConfigContext from '@src/config/configContext.js';
import { createConfigChangeService } from '@src/domains/config-change/configChange.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminConfiguredServerService } from './adminConfiguredServerService.js';
import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';

const mockAgentConfig = {
  get: vi.fn().mockImplementation((key: string) => {
    const config = {
      features: {
        configReload: true,
        envSubstitution: true,
      },
    };
    return key.split('.').reduce((obj: any, segment: string) => obj?.[segment], config);
  }),
};

vi.mock('@src/core/server/agentConfig.js', () => ({
  AgentConfigManager: {
    getInstance: () => mockAgentConfig,
  },
}));

describe('AdminConfiguredServerService', () => {
  let tempDir: string;
  let configPath: string;
  let storageDir: string;
  let reload: ReturnType<typeof vi.fn<(configPath: string) => void>>;
  let currentTime: Date;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-configured-server-'));
    configPath = path.join(tempDir, 'mcp.json');
    storageDir = path.join(tempDir, 'state');
    ConfigContext.getInstance().setConfigPath(configPath);
    reload = vi.fn<(configPath: string) => void>();
    currentTime = new Date('2026-07-07T00:00:00.000Z');
  });

  afterEach(() => {
    ConfigContext.getInstance().reset();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('enables a configured server through Admin Operation admission and records audit facts after reload observation', async () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
        },
      },
    });
    const service = createService();

    const result = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: 'enable-filesystem',
        requestFingerprint: 'enable:fingerprint',
      }),
      targetName: 'filesystem',
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      operationName: 'enableConfiguredServer',
      replayed: false,
      result: {
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: {
          status: 'changed',
          operation: 'enable',
          changed: true,
          reload: { status: 'observed' },
        },
      },
    });
    expect(readConfig().mcpServers.filesystem).toEqual({
      type: 'stdio',
      command: 'npx',
    });
    expect(reload).toHaveBeenCalledWith(configPath);
    expect(service.getRecentAuditFacts({ limit: 1 })).toEqual([
      expect.objectContaining({
        operationName: 'enableConfiguredServer',
        result: 'completed',
        target: { type: 'configured_server', id: 'filesystem' },
      }),
    ]);
  });

  it('disables a configured server and replays the completed result for the same idempotency key', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
    });
    const service = createService();
    const mutationContext = context({
      target: { type: 'configured_server', id: 'github' },
      idempotencyKey: 'disable-github',
      requestFingerprint: 'disable:fingerprint',
    });

    const first = await service.disableConfiguredServer({ context: mutationContext, targetName: 'github' });
    const replay = await service.disableConfiguredServer({ context: mutationContext, targetName: 'github' });

    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      result: {
        targetName: 'github',
        enabled: false,
        outcome: 'disabled',
      },
    });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      result: {
        targetName: 'github',
        enabled: false,
        outcome: 'disabled',
      },
    });
    expect(readConfig().mcpServers.github.disabled).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('returns already-enabled and already-disabled outcomes without reload', async () => {
    writeConfig({
      mcpServers: {
        enabled: {
          type: 'stdio',
          command: 'node',
        },
        disabled: {
          type: 'stdio',
          command: 'node',
          disabled: true,
        },
      },
    });
    const service = createService();

    const enableResult = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'enabled' },
        idempotencyKey: 'already-enabled',
        requestFingerprint: 'already-enabled:fingerprint',
      }),
      targetName: 'enabled',
    });
    const disableResult = await service.disableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'disabled' },
        idempotencyKey: 'already-disabled',
        requestFingerprint: 'already-disabled:fingerprint',
      }),
      targetName: 'disabled',
    });

    expect(enableResult).toMatchObject({ ok: true, result: { outcome: 'already_enabled' } });
    expect(disableResult).toMatchObject({ ok: true, result: { outcome: 'already_disabled' } });
    expect(reload).not.toHaveBeenCalled();
  });

  it('previews configured server enablement without writing config, backups, reloads, or audit facts', async () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
        },
      },
    });
    const service = createService();

    const result = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'filesystem',
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      operationName: 'enableConfiguredServer',
      result: {
        mode: 'dry_run',
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
        configChange: {
          status: 'changed',
          operation: 'enable',
          changed: true,
          backup: { created: false },
          retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
          reload: { status: 'skipped' },
        },
      },
    });
    expect(readConfig().mcpServers.filesystem.disabled).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(service.getRecentAuditFacts()).toEqual([]);
  });

  it('lists configured servers from the injected config document reader', async () => {
    const readConfigDocument = vi.fn(() => ({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
          env: {
            API_KEY: 'raw-api-key',
          },
        },
      },
    }));
    const service = createService({ readConfigDocument });

    const result = await service.listConfiguredServers({
      context: context({
        target: { type: 'configured_server_collection' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
    });

    expect(readConfigDocument).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      result: {
        servers: [
          {
            id: 'filesystem',
            enabled: false,
            transportSummary: {
              kind: 'stdio',
              label: 'npx',
            },
            transport: {
              env: {
                API_KEY: {
                  present: true,
                  secret: true,
                  value: '[REDACTED]',
                },
              },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-api-key');
  });

  it('loads one configured-server detail with an operator edit contract and no raw secret exposure', async () => {
    const readConfigDocument = vi.fn(() => ({
      mcpServers: {
        'github/api': {
          type: 'http',
          url: 'https://api.example.com/mcp?token=raw-url-token&workspace=docs',
          headers: {
            Authorization: 'Bearer raw-header-token',
          },
          oauth: {
            clientSecret: 'raw-client-secret',
          },
          tags: ['remote', 'oauth'],
        },
      },
    }));
    const service = createService({ readConfigDocument });

    const result = await service.getConfiguredServerDetail({
      context: context({
        target: { type: 'configured_server', id: 'github/api' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github/api',
    });

    expect(readConfigDocument).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      operationName: 'getConfiguredServerDetail',
      result: {
        server: {
          id: 'github/api',
          enabled: true,
          tags: ['remote', 'oauth'],
          transportSummary: {
            kind: 'http',
            label: 'https://api.example.com/mcp?token=REDACTED&workspace=docs',
          },
          transport: {
            type: 'http',
            url: 'https://api.example.com/mcp?token=REDACTED&workspace=docs',
            headers: {
              Authorization: { present: true, value: '[REDACTED]', secret: true },
            },
            oauth: {
              clientSecret: { present: true, value: '[REDACTED]', secret: true },
            },
          },
        },
        editContract: {
          schemaVersion: 1,
          target: { type: 'configured_server', id: 'github/api', source: 'mcpServers' },
          capabilities: {
            singleTargetEdit: true,
            rename: { supported: true },
            create: { supported: false },
            delete: { supported: false },
            bulkEdit: { supported: false },
            rawJson: { supported: false },
          },
          fieldGroups: expect.arrayContaining([
            expect.objectContaining({
              id: 'identity',
              fields: expect.arrayContaining([
                expect.objectContaining({ fieldPath: ['id'], control: 'text', value: 'github/api' }),
                expect.objectContaining({ fieldPath: ['enabled'], control: 'switch', value: true }),
                expect.objectContaining({ fieldPath: ['tags'], control: 'tag-list', value: ['remote', 'oauth'] }),
              ]),
            }),
            expect.objectContaining({
              id: 'secrets',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  fieldPath: ['headers', 'Authorization'],
                  control: 'secret',
                  secret: expect.objectContaining({
                    state: 'present',
                    defaultAction: 'preserve',
                    allowedActions: ['preserve', 'replace', 'clear'],
                    environmentReference: expect.objectContaining({
                      supported: true,
                      recommended: true,
                    }),
                    inlineReplacement: expect.objectContaining({
                      supported: true,
                      emphasis: 'secondary',
                    }),
                  }),
                }),
              ]),
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-url-token|raw-header-token|raw-client-secret/);
    expect(JSON.stringify(result)).not.toMatch(/zod|rawSchema|storageShape/i);
  });

  it('keeps nested secret record values out of editable transport record fields', async () => {
    const service = createService({
      readConfigDocument: () => ({
        mcpServers: {
          nested: {
            type: 'stdio',
            command: 'node',
            metadata: {
              region: 'us-east-1',
              apiToken: 'raw-nested-token',
            },
          },
        },
      }),
    });

    const result = await service.getConfiguredServerDetail({
      context: context({
        target: { type: 'configured_server', id: 'nested' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'nested',
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        server: {
          transport: {
            metadata: {
              region: 'us-east-1',
              apiToken: { present: true, value: '[REDACTED]', secret: true },
            },
          },
        },
        editContract: {
          fieldGroups: expect.arrayContaining([
            expect.objectContaining({
              id: 'transport',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  fieldPath: ['transport', 'metadata'],
                  control: 'record',
                  value: {
                    region: 'us-east-1',
                  },
                }),
              ]),
            }),
            expect.objectContaining({
              id: 'secrets',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  fieldPath: ['metadata', 'apiToken'],
                  control: 'secret',
                  secret: expect.objectContaining({
                    defaultAction: 'preserve',
                    allowedActions: ['preserve', 'replace', 'clear'],
                  }),
                }),
              ]),
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-nested-token');
    expect(
      JSON.stringify(
        result.ok
          ? (result.result.editContract.fieldGroups.find((group) => group.id === 'transport')?.fields ?? [])
          : [],
      ),
    ).not.toMatch(/apiToken|raw-nested-token/);
  });

  it('redacts URL username and password credentials from detail read models and edit contracts', async () => {
    const service = createService({
      readConfigDocument: () => ({
        mcpServers: {
          github: {
            type: 'http',
            url: 'https://raw-user:raw-pass@api.example.com/mcp?token=raw-token&workspace=docs',
          },
        },
      }),
    });

    const result = await service.getConfiguredServerDetail({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        server: {
          transportSummary: {
            label: 'https://REDACTED:REDACTED@api.example.com/mcp?token=REDACTED&workspace=docs',
          },
          transport: {
            url: 'https://REDACTED:REDACTED@api.example.com/mcp?token=REDACTED&workspace=docs',
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({ fieldPath: ['url', 'username'], label: 'url.username' }),
            expect.objectContaining({ fieldPath: ['url', 'password'], label: 'url.password' }),
            expect.objectContaining({ fieldPath: ['url', 'query', 'token'], label: 'url.query.token' }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-user|raw-pass|raw-token/);
  });

  it('fails dry-run admission when the request runtime identity does not match the Runtime Scope', async () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
        },
      },
    });
    const service = createService();

    const result = await service.enableConfiguredServer({
      context: context({
        runtimeIdentity: { runtimeScopeId: 'scope_other', runtimeVersion: '1.2.3' },
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'filesystem',
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'runtime_scope_mismatch',
      code: 'runtime_scope_mismatch',
      operationName: 'enableConfiguredServer',
    });
    expect(readConfig().mcpServers.filesystem.disabled).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('returns mutation_failed when dry-run planned config validation fails', async () => {
    writeConfig({
      mcpServers: {
        broken: {
          type: 'http',
          url: 'invalid-url',
          disabled: true,
        },
      },
    });
    const service = createService();

    const result = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'broken' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'broken',
      dryRun: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      code: 'mutation_failed',
      operationName: 'enableConfiguredServer',
    });
    expect(readConfig().mcpServers.broken.disabled).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('passes dangerous mutation confirmation requirements to Admin Operation admission', async () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
        },
      },
    });
    const service = createService();
    const confirmationRequirements = [
      {
        code: 'confirm_non_loopback_runtime',
        expected: true,
        target: { type: 'configured_server', id: 'filesystem' },
      },
      {
        code: 'confirmedOperation',
        expected: 'mcp.enable',
        target: { type: 'configured_server', id: 'filesystem' },
      },
      {
        code: 'confirmedRuntimeScopeId',
        expected: 'scope_123',
        target: { type: 'configured_server', id: 'filesystem' },
      },
      {
        code: 'confirmationSource',
        expected: 'cli_flag',
        target: { type: 'configured_server', id: 'filesystem' },
      },
    ];

    const missingConfirmation = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: 'enable-filesystem',
        requestFingerprint: 'enable:fingerprint',
      }),
      targetName: 'filesystem',
      confirmationRequirements,
    });
    const confirmed = await service.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: 'enable-filesystem-confirmed',
        requestFingerprint: 'enable:fingerprint:confirmed',
        confirmationFacts: {
          confirm_non_loopback_runtime: true,
          confirmedOperation: 'mcp.enable',
          confirmedRuntimeScopeId: 'scope_123',
          confirmedTargetUrl: 'https://target-alias.example.com',
          confirmationSource: 'cli_flag',
        },
      }),
      targetName: 'filesystem',
      confirmationRequirements,
    });

    expect(missingConfirmation).toMatchObject({
      ok: false,
      status: 'mutation_confirmation_required',
      code: 'mutation_confirmation_required',
      confirmationRequirements,
    });
    expect(readConfig().mcpServers.filesystem.disabled).toBeUndefined();
    expect(confirmed).toMatchObject({
      ok: true,
      result: {
        targetName: 'filesystem',
        enabled: true,
        outcome: 'enabled',
      },
    });
    expect(service.getRecentAuditFacts({ limit: 1 })[0]?.confirmationFacts).toEqual({
      confirm_non_loopback_runtime: true,
      confirmedOperation: 'mcp.enable',
      confirmedRuntimeScopeId: 'scope_123',
      confirmedTargetUrl: 'https://target-alias.example.com',
      confirmationSource: 'cli_flag',
    });
  });

  it('treats config change failure and reload observation failure as mutation failures', async () => {
    writeConfig({
      mcpServers: {
        reloadFails: {
          type: 'stdio',
          command: 'node',
          disabled: true,
        },
      },
    });
    const validationFailureService = createService();
    const validationFailure = await validationFailureService.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'missing' },
        idempotencyKey: 'validation-failure',
        requestFingerprint: 'validation-failure:fingerprint',
      }),
      targetName: 'missing',
    });

    reload.mockImplementationOnce(() => {
      throw new Error('runtime did not observe reload');
    });
    const reloadFailure = await validationFailureService.enableConfiguredServer({
      context: context({
        target: { type: 'configured_server', id: 'reloadFails' },
        idempotencyKey: 'reload-failure',
        requestFingerprint: 'reload-failure:fingerprint',
      }),
      targetName: 'reloadFails',
    });

    expect(validationFailure).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: expect.stringContaining('missing'),
    });
    expect(reloadFailure).toMatchObject({
      ok: false,
      status: 'mutation_failed',
      error: 'Config reload observation failed: runtime did not observe reload',
    });
    expect(validationFailureService.getRecentAuditFacts({ limit: 5 })).toEqual(
      expect.arrayContaining([expect.objectContaining({ operationName: 'enableConfiguredServer', result: 'failed' })]),
    );
  });

  it('returns normalized configured-server read models with env and header values redacted', async () => {
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
          tags: ['local', 'storage'],
          env: {
            PUBLIC_MODE: 'debug',
            API_TOKEN: 'super-secret',
          },
        },
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp?token=raw-token&workspace=docs',
          headers: {
            Authorization: 'Bearer raw-token',
            'X-Trace': 'trace-id',
          },
          disabled: true,
          oauth: {
            clientId: 'client-id',
            clientSecret: 'client-secret',
          },
        },
      },
    });

    const result = await createService().listConfiguredServers({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        servers: [
          {
            id: 'filesystem',
            source: 'mcpServers',
            target: {
              type: 'configured_server',
              id: 'filesystem',
              source: 'mcpServers',
            },
            enabled: true,
            tags: ['local', 'storage'],
            transportSummary: {
              kind: 'stdio',
              label: 'npx -y @modelcontextprotocol/server-filesystem /tmp/project',
            },
            mutationAvailability: {
              available: true,
              operations: ['enable', 'disable'],
            },
            actionState: {
              enable: {
                available: false,
                disabledReason: 'already_enabled',
                label: 'Enable filesystem',
              },
              disable: {
                available: true,
                label: 'Disable filesystem',
              },
            },
            transport: {
              type: 'stdio',
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project'],
              env: {
                PUBLIC_MODE: { present: true, value: '[REDACTED]', secret: true },
                API_TOKEN: { present: true, value: '[REDACTED]', secret: true },
              },
            },
            secretInputs: expect.arrayContaining([
              {
                fieldPath: ['env', 'PUBLIC_MODE'],
                label: 'PUBLIC_MODE',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
            ]),
          },
          {
            id: 'github',
            source: 'mcpServers',
            target: {
              type: 'configured_server',
              id: 'github',
              source: 'mcpServers',
            },
            enabled: false,
            tags: [],
            transportSummary: {
              kind: 'http',
              label: 'https://api.example.com/mcp?token=REDACTED&workspace=docs',
            },
            mutationAvailability: {
              available: true,
              operations: ['enable', 'disable'],
            },
            actionState: {
              enable: {
                available: true,
                label: 'Enable github',
              },
              disable: {
                available: false,
                disabledReason: 'already_disabled',
                label: 'Disable github',
              },
            },
            transport: {
              type: 'http',
              url: 'https://api.example.com/mcp?token=REDACTED&workspace=docs',
              headers: {
                Authorization: { present: true, value: '[REDACTED]', secret: true },
                'X-Trace': { present: true, value: '[REDACTED]', secret: true },
              },
              oauth: {
                clientId: { present: true, value: '[REDACTED]', secret: true },
                clientSecret: { present: true, value: '[REDACTED]', secret: true },
              },
            },
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('raw-token');
    expect(JSON.stringify(result)).not.toContain('client-secret');
    expect(JSON.stringify(result)).not.toContain('trace-id');
  });

  it('represents redacted URL query secrets as editable secret inputs', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp?access_token=raw-token&workspace=docs&apiKey=raw-key',
        },
      },
    });

    const result = await createService().listConfiguredServers({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        servers: [
          {
            id: 'github',
            transport: {
              url: 'https://api.example.com/mcp?access_token=REDACTED&workspace=docs&apiKey=REDACTED',
            },
            secretInputs: expect.arrayContaining([
              {
                fieldPath: ['url', 'query', 'access_token'],
                label: 'url.query.access_token',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
              {
                fieldPath: ['url', 'query', 'apiKey'],
                label: 'url.query.apiKey',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
            ]),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-token');
    expect(JSON.stringify(result)).not.toContain('raw-key');
  });

  it('redacts secret-like stdio args from the transport model and summary', async () => {
    writeConfig({
      mcpServers: {
        cli: {
          type: 'stdio',
          command: 'node',
          args: ['server.js', '--token', 'raw-token', '--api-key=raw-key', '--workspace', 'docs'],
        },
      },
    });

    const result = await createService().listConfiguredServers({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        servers: [
          {
            id: 'cli',
            transportSummary: {
              kind: 'stdio',
              label: 'node server.js --token REDACTED --api-key=REDACTED --workspace docs',
            },
            transport: {
              args: ['server.js', '--token', 'REDACTED', '--api-key=REDACTED', '--workspace', 'docs'],
            },
            secretInputs: expect.arrayContaining([
              {
                fieldPath: ['args', '2'],
                label: 'args.--token',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
              {
                fieldPath: ['args', '3'],
                label: 'args.--api-key',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
            ]),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-token');
    expect(JSON.stringify(result)).not.toContain('raw-key');
  });

  it('redacts top-level and nested unknown secret-like fields while preserving non-secret unknown fields', async () => {
    writeConfig({
      mcpServers: {
        custom: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          displayName: 'Custom API',
          apiKey: 'raw-api-key',
          metadata: {
            region: 'us-east-1',
            accessToken: 'raw-access-token',
            nested: {
              password: 'raw-password',
              label: 'safe-label',
            },
          },
        },
      },
    });

    const result = await createService().listConfiguredServers({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        servers: [
          {
            id: 'custom',
            transport: {
              displayName: 'Custom API',
              apiKey: { present: true, value: '[REDACTED]', secret: true },
              metadata: {
                region: 'us-east-1',
                accessToken: { present: true, value: '[REDACTED]', secret: true },
                nested: {
                  password: { present: true, value: '[REDACTED]', secret: true },
                  label: 'safe-label',
                },
              },
            },
            secretInputs: expect.arrayContaining([
              {
                fieldPath: ['apiKey'],
                label: 'apiKey',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
              {
                fieldPath: ['metadata', 'accessToken'],
                label: 'metadata.accessToken',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
              {
                fieldPath: ['metadata', 'nested', 'password'],
                label: 'metadata.nested.password',
                state: 'present',
                allowedActions: ['preserve', 'replace', 'clear'],
              },
            ]),
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('raw-api-key');
    expect(JSON.stringify(result)).not.toContain('raw-access-token');
    expect(JSON.stringify(result)).not.toContain('raw-password');
  });

  function createService(
    options: { readConfigDocument?: () => { mcpServers?: Record<string, any> } | null } = {},
  ): AdminConfiguredServerService {
    const operationService = new AdminOperationService({
      runtimeScopeId: 'scope_123',
      storageDir,
      now: () => currentTime,
      createOperationId: () => `op_${currentTime.getTime()}`,
    });
    return new AdminConfiguredServerService({
      operationService,
      configChangeService: createConfigChangeService({
        reloadConfig: reload,
        now: () => currentTime.getTime(),
      }),
      readConfigDocument:
        options.readConfigDocument ??
        (() => {
          if (!fs.existsSync(configPath)) {
            return null;
          }
          return JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers?: Record<string, any> };
        }),
      ...options,
    });
  }

  function context(overrides: Partial<AdminOperationContext> = {}): AdminOperationContext {
    return {
      actor: { type: 'admin_session', accountId: 'acct_1', sessionId: 'sess_1' },
      origin: 'browser',
      target: { type: 'configured_server' },
      runtimeIdentity: { runtimeScopeId: 'scope_123', runtimeVersion: '1.2.3' },
      request: { requestId: 'req_1', jsonMode: true },
      idempotencyKey: 'idem_1',
      requestFingerprint: 'fingerprint_1',
      ...overrides,
    };
  }

  function writeConfig(config: Record<string, unknown>): void {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  function readConfig(): Record<string, any> {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
});
