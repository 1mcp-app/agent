import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ConfigContext from '@src/config/configContext.js';
import { createConfigChangeService } from '@src/domains/config-change/configChange.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdminConfiguredServerService,
  type ConfiguredServerConnectivityChecker,
} from './adminConfiguredServerService.js';
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
          schemaVersion: 3,
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
              id: 'transport',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  fieldPath: ['transport', 'url'],
                  applicableTransportTypes: ['http', 'sse', 'streamableHttp'],
                }),
                expect.objectContaining({
                  fieldPath: ['transport', 'command'],
                  value: '',
                  applicableTransportTypes: ['stdio'],
                }),
                expect.objectContaining({
                  fieldPath: ['transport', 'args'],
                  value: [],
                  applicableTransportTypes: ['stdio'],
                }),
              ]),
            }),
            expect.objectContaining({
              id: 'secrets',
              fields: expect.arrayContaining([
                expect.objectContaining({
                  fieldPath: ['headers', 'Authorization'],
                  control: 'secret',
                  applicableTransportTypes: ['http', 'sse', 'streamableHttp'],
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

  it('previews a configured-server edit with redacted diff, preview fingerprint, and automatic connectivity facts', async () => {
    const checkConnectivity = vi.fn(async () => ({
      status: 'passed' as const,
      mode: 'bounded_dry_run' as const,
      checkedAt: '2026-07-07T00:00:00.000Z',
    }));
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp?token=raw-token&workspace=docs',
          headers: {
            Authorization: 'Bearer raw-header-token',
          },
          tags: ['remote'],
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        id: 'github-renamed',
        enabled: true,
        tags: ['remote', 'edited'],
        transport: {
          url: 'https://api.example.com/v2/mcp?workspace=docs',
        },
        secrets: [
          {
            fieldPath: ['url', 'query', 'token'],
            action: 'replace',
            replacement: {
              kind: 'environmentReference',
              value: 'GITHUB_TOKEN',
            },
          },
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: {
              kind: 'environmentReference',
              value: 'GITHUB_AUTHORIZATION',
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      operationName: 'previewConfiguredServerEdit',
      result: {
        targetName: 'github',
        proposedTargetName: 'github-renamed',
        previewFingerprint: expect.stringMatching(/^preview_[a-f0-9]{64}$/),
        validation: {
          status: 'valid',
          errors: [],
        },
        configChange: {
          operation: 'set_static',
          changed: true,
          target: { name: 'github', source: 'mcpServers' },
          reload: { status: 'skipped' },
          backup: { created: false },
        },
        connectivityCheck: {
          status: 'passed',
          mode: 'bounded_dry_run',
          checkedAt: '2026-07-07T00:00:00.000Z',
        },
        diff: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: ['id'],
            oldValue: 'github',
            newValue: 'github-renamed',
            riskFlags: ['rename'],
          }),
          expect.objectContaining({
            fieldPath: ['tags'],
            oldValue: ['remote'],
            newValue: ['remote', 'edited'],
            riskFlags: [],
          }),
          expect.objectContaining({
            fieldPath: ['transport', 'url'],
            oldValue: 'https://api.example.com/mcp?token=REDACTED&workspace=docs',
            newValue: 'https://api.example.com/v2/mcp?workspace=docs&token=REDACTED',
            riskFlags: ['connection_critical'],
          }),
          expect.objectContaining({
            fieldPath: ['url', 'query', 'token'],
            secretAction: 'replace',
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GITHUB_TOKEN}',
              storesSecretMaterial: false,
            },
            riskFlags: ['connection_critical', 'secret'],
          }),
          expect.objectContaining({
            fieldPath: ['headers', 'Authorization'],
            secretAction: 'replace',
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GITHUB_AUTHORIZATION}',
              storesSecretMaterial: false,
            },
            riskFlags: ['connection_critical', 'secret'],
          }),
        ]),
      },
    });
    expect(checkConnectivity).toHaveBeenCalledWith({
      targetName: 'github-renamed',
      serverConfig: expect.objectContaining({
        url: 'https://api.example.com/v2/mcp?workspace=docs&token=${GITHUB_TOKEN}',
        headers: {
          Authorization: '${GITHUB_AUTHORIZATION}',
        },
      }),
    });
    expect(readConfig().mcpServers.github.headers.Authorization).toBe('Bearer raw-header-token');
    expect(reload).not.toHaveBeenCalled();
    expect(service.getRecentAuditFacts()).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/raw-token|raw-header-token/);
  });

  it('applies a fresh confirmed preview, preserves secrets, renames atomically, and audits redacted facts', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: { Authorization: 'Bearer raw-secret' },
          tags: ['remote'],
        },
      },
    });
    const checkConnectivity = vi.fn<ConfiguredServerConnectivityChecker>().mockResolvedValue({
      status: 'passed',
      mode: 'bounded_dry_run',
      checkedAt: '2026-07-07T00:00:00.000Z',
    });
    const service = createService({ checkConnectivity });
    const edit = {
      id: 'github-renamed',
      tags: ['remote', 'edited'],
      transport: { url: 'https://new.example.com/mcp' },
    };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'github',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const unconfirmed = await service.applyConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: 'apply-github',
        requestFingerprint: 'apply-fingerprint',
        confirmationFacts: {},
      }),
      targetName: 'github',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(unconfirmed).toMatchObject({
      ok: false,
      status: 'mutation_confirmation_required',
      confirmationRequirements: expect.arrayContaining([
        { code: 'previewConfirmed', expected: preview.result.previewFingerprint },
        { code: 'targetNameConfirmed', expected: 'github-renamed' },
        { code: 'connectionCriticalConfirmed', expected: true },
      ]),
    });

    const result = await service.applyConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: 'apply-github',
        requestFingerprint: 'apply-fingerprint',
        confirmationFacts: {
          previewConfirmed: preview.result.previewFingerprint,
          targetNameConfirmed: 'github-renamed',
          connectionCriticalConfirmed: true,
          ignoredRawValue: 'must-not-be-audited',
        },
      }),
      targetName: 'github',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });

    expect(result).toMatchObject({
      ok: true,
      operationName: 'applyConfiguredServerEdit',
      result: {
        originalTargetName: 'github',
        targetName: 'github-renamed',
        previewFingerprint: preview.result.previewFingerprint,
        configChange: {
          status: 'changed',
          operation: 'edit',
          backup: { created: true },
          reload: { status: 'observed' },
        },
      },
    });
    expect(readConfig().mcpServers).toEqual({
      'github-renamed': {
        type: 'http',
        url: 'https://new.example.com/mcp',
        headers: { Authorization: 'Bearer raw-secret' },
        tags: ['remote', 'edited'],
      },
    });
    expect(checkConnectivity).toHaveBeenCalled();
    const audit = service.getRecentAuditFacts({ limit: 1 })[0];
    expect(audit.confirmationFacts).toEqual({
      previewConfirmed: preview.result.previewFingerprint,
      targetNameConfirmed: 'github-renamed',
      connectionCriticalConfirmed: true,
    });
    expect(JSON.stringify(audit)).not.toMatch(/raw-secret|must-not-be-audited/u);

    const connectivityCallsBeforeReplay = checkConnectivity.mock.calls.length;
    const replay = await service.applyConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: 'apply-github',
        requestFingerprint: 'apply-fingerprint',
        confirmationFacts: {
          previewConfirmed: preview.result.previewFingerprint,
          targetNameConfirmed: 'github-renamed',
          connectionCriticalConfirmed: true,
        },
      }),
      targetName: 'github',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      operationId: result.ok ? result.operationId : undefined,
      result: { originalTargetName: 'github', targetName: 'github-renamed' },
    });
    expect(checkConnectivity).toHaveBeenCalledTimes(connectivityCallsBeforeReplay);
  });

  it('replays an ordinary successful apply before reading mutable config state', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'stdio', command: 'node', tags: ['one'] } } });
    const service = createService();
    const edit = { tags: ['two'] };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const applyInput = {
      context: context({
        idempotencyKey: 'apply-alpha',
        requestFingerprint: 'apply-alpha-fingerprint',
        confirmationFacts: { previewConfirmed: preview.result.previewFingerprint },
      }),
      targetName: 'alpha',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    };

    const first = await service.applyConfiguredServerEdit(applyInput);
    const replay = await service.applyConfiguredServerEdit(applyInput);

    expect(first).toMatchObject({ ok: true, replayed: false, result: { targetName: 'alpha' } });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      operationId: first.ok ? first.operationId : undefined,
      result: { targetName: 'alpha', previewFingerprint: preview.result.previewFingerprint },
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('completes and replays an applied edit when reload observation fails after the write', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'stdio', command: 'node', tags: ['one'] } } });
    reload.mockImplementation(() => {
      throw new Error('reload watcher unavailable');
    });
    const service = createService();
    const edit = { tags: ['two'] };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const applyInput = {
      context: context({
        idempotencyKey: 'apply-reload-failure',
        requestFingerprint: 'apply-reload-failure-fingerprint',
        confirmationFacts: { previewConfirmed: preview.result.previewFingerprint },
      }),
      targetName: 'alpha',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    };

    const first = await service.applyConfiguredServerEdit(applyInput);
    const replay = await service.applyConfiguredServerEdit(applyInput);

    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      result: {
        configChange: {
          status: 'changed',
          changed: true,
          reload: { status: 'failed', error: 'reload watcher unavailable' },
        },
      },
    });
    expect(replay).toMatchObject({
      ok: true,
      replayed: true,
      operationId: first.ok ? first.operationId : undefined,
      result: { configChange: { reload: { status: 'failed', error: 'reload watcher unavailable' } } },
    });
    expect(readConfig().mcpServers.alpha.tags).toEqual(['two']);
    expect(service.getRecentAuditFacts({ limit: 1 })[0]).toMatchObject({
      operationName: 'applyConfiguredServerEdit',
      result: 'completed',
    });
  });

  it('does not reserve invalid first apply requests', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'stdio', command: 'node', tags: ['one'] } } });
    const service = createService();
    const invalidEdit = { transport: { command: '' } };
    const invalidPreview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit: invalidEdit,
    });
    expect(invalidPreview.ok).toBe(true);
    if (!invalidPreview.ok) return;
    const sharedContext = context({
      idempotencyKey: 'apply-after-invalid',
      requestFingerprint: 'shared-fingerprint',
      confirmationFacts: { previewConfirmed: invalidPreview.result.previewFingerprint },
    });

    await expect(
      service.applyConfiguredServerEdit({
        context: sharedContext,
        targetName: 'alpha',
        edit: invalidEdit,
        previewFingerprint: invalidPreview.result.previewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'configured_server_edit_invalid' });
    expect(service.getRecentAuditFacts()).toEqual([]);

    const validEdit = { tags: ['two'] };
    const validPreview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit: validEdit,
    });
    expect(validPreview.ok).toBe(true);
    if (!validPreview.ok) return;
    const result = await service.applyConfiguredServerEdit({
      context: {
        ...sharedContext,
        confirmationFacts: { previewConfirmed: validPreview.result.previewFingerprint },
      },
      targetName: 'alpha',
      edit: validEdit,
      previewFingerprint: validPreview.result.previewFingerprint,
    });

    expect(result).toMatchObject({ ok: true, replayed: false, result: { targetName: 'alpha' } });
    expect(readConfig().mcpServers.alpha.tags).toEqual(['two']);
  });

  it('rejects stale previews before reserving or writing a mutation', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'stdio', command: 'node', tags: ['one'] } } });
    const service = createService();
    const edit = { tags: ['two'] };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    writeConfig({ mcpServers: { alpha: { type: 'stdio', command: 'node', tags: ['changed'] } } });

    await expect(
      service.applyConfiguredServerEdit({
        context: context({ confirmationFacts: { previewConfirmed: true } }),
        targetName: 'alpha',
        edit,
        previewFingerprint: preview.result.previewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'configured_server_stale_preview' });
    expect(readConfig().mcpServers.alpha.tags).toEqual(['changed']);
    expect(service.getRecentAuditFacts()).toEqual([]);
  });

  it('blocks enabled remote connection-critical applies when connectivity does not pass', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'http', url: 'https://old.example.com/mcp' } } });
    const service = createService({
      checkConnectivity: vi.fn<ConfiguredServerConnectivityChecker>().mockResolvedValue({
        status: 'failed',
        mode: 'bounded_dry_run',
        message: 'Connection refused',
      }),
    });
    const edit = { transport: { url: 'https://new.example.com/mcp' } };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await expect(
      service.applyConfiguredServerEdit({
        context: context({
          confirmationFacts: { previewConfirmed: true, connectionCriticalConfirmed: true },
        }),
        targetName: 'alpha',
        edit,
        previewFingerprint: preview.result.previewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'configured_server_connectivity_blocked' });
    expect(readConfig().mcpServers.alpha.url).toBe('https://old.example.com/mcp');
  });

  it('treats legacy disabled false strings as enabled for strict apply connectivity', async () => {
    writeConfig({
      mcpServers: {
        alpha: { type: 'http', url: 'https://old.example.com/mcp', disabled: 'false' },
      },
    });
    const checkConnectivity = vi.fn<ConfiguredServerConnectivityChecker>().mockResolvedValue({
      status: 'failed',
      mode: 'bounded_dry_run',
      message: 'Connection refused',
    });
    const service = createService({ checkConnectivity });
    const detail = await service.getConfiguredServerDetail({
      context: context(),
      targetName: 'alpha',
    });
    expect(detail.ok && detail.result.server.enabled).toBe(true);

    const edit = { transport: { url: 'https://new.example.com/mcp' } };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await expect(
      service.applyConfiguredServerEdit({
        context: context({
          confirmationFacts: {
            previewConfirmed: preview.result.previewFingerprint,
            connectionCriticalConfirmed: true,
          },
        }),
        targetName: 'alpha',
        edit,
        previewFingerprint: preview.result.previewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'configured_server_connectivity_blocked' });
    expect(checkConnectivity).toHaveBeenCalled();
    expect(readConfig().mcpServers.alpha.url).toBe('https://old.example.com/mcp');
  });

  it('converts HTTP transports to stdio and removes incompatible network fields from the preview', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: { 'X-Workspace': 'docs' },
          oauth: { clientId: 'client-id' },
          requestTimeout: 5_000,
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        connectivityCheck: { status: 'skipped', reason: 'local_stdio_transport' },
        diff: expect.arrayContaining([
          expect.objectContaining({ fieldPath: ['transport', 'type'], oldValue: 'http', newValue: 'stdio' }),
          expect.objectContaining({ fieldPath: ['transport', 'url'], oldValue: 'https://api.example.com/mcp' }),
          expect.objectContaining({
            fieldPath: ['transport', 'headers'],
            oldValue: { 'X-Workspace': { present: true, value: '[REDACTED]', secret: true } },
          }),
          expect.objectContaining({
            fieldPath: ['transport', 'oauth'],
            oldValue: { clientId: { present: true, value: '[REDACTED]', secret: true } },
          }),
          expect.objectContaining({ fieldPath: ['transport', 'command'], newValue: 'node' }),
          expect.objectContaining({ fieldPath: ['transport', 'args'], newValue: ['server.js'] }),
        ]),
      },
    });
    if (!result.ok) return;
    const removed = result.result.diff.filter((entry) => ['url', 'headers', 'oauth'].includes(entry.fieldPath[1]));
    expect(removed.every((entry) => entry.newValue === undefined)).toBe(true);
    expect(result.result.diff).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fieldPath: ['transport', 'requestTimeout'] })]),
    );
  });

  it('converts stdio transports to HTTP and removes incompatible process fields from the preview', async () => {
    writeConfig({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
          cwd: '/workspace',
          inheritParentEnv: true,
          restartOnExit: true,
          connectionTimeout: 2_000,
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'local' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'local',
      edit: { transport: { type: 'http', url: 'https://api.example.com/mcp' } },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        connectivityCheck: { status: 'skipped', reason: 'checker_unavailable' },
        diff: expect.arrayContaining([
          expect.objectContaining({ fieldPath: ['transport', 'type'], oldValue: 'stdio', newValue: 'http' }),
          expect.objectContaining({ fieldPath: ['transport', 'command'], oldValue: 'node' }),
          expect.objectContaining({ fieldPath: ['transport', 'args'], oldValue: ['server.js'] }),
          expect.objectContaining({ fieldPath: ['transport', 'cwd'], oldValue: '/workspace' }),
          expect.objectContaining({ fieldPath: ['transport', 'inheritParentEnv'], oldValue: true }),
          expect.objectContaining({ fieldPath: ['transport', 'restartOnExit'], oldValue: true }),
          expect.objectContaining({
            fieldPath: ['transport', 'url'],
            newValue: 'https://api.example.com/mcp',
          }),
        ]),
      },
    });
    if (!result.ok) return;
    const removedKeys = new Set(['command', 'args', 'cwd', 'inheritParentEnv', 'restartOnExit']);
    expect(
      result.result.diff
        .filter((entry) => removedKeys.has(entry.fieldPath[1]))
        .every((entry) => entry.newValue === undefined),
    ).toBe(true);
    expect(result.result.diff).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fieldPath: ['transport', 'connectionTimeout'] })]),
    );
  });

  it('previews configured-server edits when the runtime scope writer lock is unavailable', async () => {
    writeConfig({
      mcpServers: {
        github: { type: 'http', url: 'https://api.example.com/mcp' },
      },
    });
    const service = createService({
      mutationAvailability: { available: false, reason: 'writer_lock_unavailable' },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: { tags: ['previewed'] },
    });

    expect(result).toMatchObject({ ok: true, result: { validation: { status: 'valid' } } });
  });

  it('rejects transport fields that do not apply to the selected transport type', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: { transport: { type: 'stdio', command: 'node', url: 'https://other.example.com/mcp' } },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'transport_field_not_applicable',
              message: 'URL does not apply to stdio transports.',
            },
          ]),
        },
      },
    });
  });

  it('skips automatic connectivity when endpoint changes would carry preserved secrets', async () => {
    const checkConnectivity = vi.fn();
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer raw-header-token',
          },
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://other.example.com/mcp',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        diff: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: ['transport', 'url'],
            oldValue: 'https://api.example.com/mcp',
            newValue: 'https://other.example.com/mcp',
            riskFlags: ['connection_critical'],
          }),
        ]),
        configChange: {
          changed: true,
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'endpoint_changed_with_preserved_secrets',
        },
      },
    });
    expect(checkConnectivity).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/raw-header-token/);
  });

  it('previews validation and skipped connectivity for disabled targets without writing config', async () => {
    const checkConnectivity = vi.fn();
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        broken: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          disabled: true,
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'broken' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'broken',
      edit: {
        transport: {
          type: 'http',
          url: 'not a url',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: [
            {
              fieldPath: ['transport', 'url'],
              code: 'invalid_url',
              message: 'URL must be a valid URL or environment substitution reference.',
            },
          ],
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'target_disabled',
        },
        configChange: {
          changed: false,
          reload: { status: 'skipped' },
        },
      },
    });
    expect(checkConnectivity).not.toHaveBeenCalled();
    expect(readConfig().mcpServers.broken.url).toBe('https://api.example.com/mcp');
  });

  it('throws not found for missing preview targets before dry-run wraps failures', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {},
    });

    await expect(
      service.previewConfiguredServerEdit({
        context: context({
          target: { type: 'configured_server', id: 'missing' },
          idempotencyKey: undefined,
          requestFingerprint: undefined,
        }),
        targetName: 'missing',
        edit: {},
      }),
    ).rejects.toMatchObject({
      code: 'configured_server_not_found',
      targetName: 'missing',
    });
  });

  it('rejects unsupported top-level edit fields instead of accepting raw storage-shaped payloads', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        mcpServers: {
          other: {
            type: 'http',
            url: 'https://evil.example.com/mcp',
          },
        },
        globalTransport: {
          headers: {
            Authorization: 'Bearer raw-secret',
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['mcpServers'],
              code: 'unsupported_edit_field',
            }),
            expect.objectContaining({
              fieldPath: ['globalTransport'],
              code: 'unsupported_edit_field',
            }),
          ]),
        },
        diff: [],
        configChange: {
          changed: false,
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-secret/);
    expect(readConfig().mcpServers.github.url).toBe('https://api.example.com/mcp');
  });

  it('previews URL and args secret replacements against the raw target shape', async () => {
    const checkConnectivity = vi.fn(async () => ({
      status: 'passed' as const,
      mode: 'bounded_dry_run' as const,
      checkedAt: '2026-07-07T00:00:00.000Z',
    }));
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        gateway: {
          type: 'http',
          url: 'https://api.example.com/mcp?token=raw-token&workspace=docs',
          args: ['--api-key', 'raw-key'],
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: {
        secrets: [
          {
            fieldPath: ['url', 'query', 'token'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GATEWAY_TOKEN' },
          },
          {
            fieldPath: ['args', '1'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GATEWAY_API_KEY' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        diff: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: ['url', 'query', 'token'],
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GATEWAY_TOKEN}',
              storesSecretMaterial: false,
            },
          }),
          expect.objectContaining({
            fieldPath: ['args', '1'],
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${GATEWAY_API_KEY}',
              storesSecretMaterial: false,
            },
          }),
        ]),
      },
    });
    expect(checkConnectivity).toHaveBeenCalledWith({
      targetName: 'gateway',
      serverConfig: expect.objectContaining({
        url: 'https://api.example.com/mcp?token=${GATEWAY_TOKEN}&workspace=docs',
        args: ['--api-key', '${GATEWAY_API_KEY}'],
      }),
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-token|raw-key/);
  });

  it('previews env-array secret replacements without changing the env shape', async () => {
    const checkConnectivity = vi.fn(async () => ({
      status: 'passed' as const,
      mode: 'bounded_dry_run' as const,
      checkedAt: '2026-07-07T00:00:00.000Z',
    }));
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        filesystem: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          env: ['PUBLIC_MODE=debug', 'API_TOKEN=raw-token', 'OTHER=value'],
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'filesystem',
      edit: {
        secrets: [
          {
            fieldPath: ['env', 'API_TOKEN'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'FILESYSTEM_API_TOKEN' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        diff: [
          expect.objectContaining({
            fieldPath: ['env', 'API_TOKEN'],
            oldValue: { present: true, value: '[REDACTED]', secret: true },
            newValue: {
              kind: 'environmentReference',
              value: '${FILESYSTEM_API_TOKEN}',
              storesSecretMaterial: false,
            },
          }),
        ],
      },
    });
    expect(checkConnectivity).toHaveBeenCalledWith({
      targetName: 'filesystem',
      serverConfig: expect.objectContaining({
        env: ['PUBLIC_MODE=debug', 'API_TOKEN=${FILESYSTEM_API_TOKEN}', 'OTHER=value'],
      }),
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-token/);
  });

  it('skips preview connectivity for stdio targets without executing proposed commands', async () => {
    const checkConnectivity = vi.fn();
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        filesystem: {
          command: 'npx',
          url: 'https://api.example.com/mcp',
          args: ['server-a'],
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'filesystem' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'filesystem',
      edit: {
        transport: {
          command: 'node',
          args: ['server-b'],
        },
      },
      connectivityCheck: 'manual',
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        connectivityCheck: {
          status: 'skipped',
          reason: 'local_stdio_transport',
        },
      },
    });
    expect(checkConnectivity).not.toHaveBeenCalled();
  });

  it('skips connectivity checks when enabled target previews fail validation', async () => {
    const checkConnectivity = vi.fn();
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'not a url',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'invalid' },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
        configChange: {
          changed: false,
          reload: { status: 'skipped' },
        },
      },
    });
    expect(checkConnectivity).not.toHaveBeenCalled();
  });

  it('binds inline secret replacement values into preview fingerprints without echoing them', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer raw-header-token',
          },
        },
      },
    });
    const service = createService();
    const baseInput = {
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
    };

    const first = await service.previewConfiguredServerEdit({
      ...baseInput,
      edit: {
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'first-secret-value' },
          },
        ],
      },
    });
    const second = await service.previewConfiguredServerEdit({
      ...baseInput,
      edit: {
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'inlineSecret', value: 'second-secret-value' },
          },
        ],
      },
    });

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(first.ok && second.ok ? first.result.previewFingerprint : undefined).not.toBe(
      second.ok && first.ok ? second.result.previewFingerprint : undefined,
    );
    expect(JSON.stringify(first)).not.toMatch(/first-secret-value|second-secret-value/);
    expect(JSON.stringify(second)).not.toMatch(/first-secret-value|second-secret-value/);
  });

  it('returns structured validation for malformed preview edit shapes', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        id: 123,
        secrets: { bad: true },
      } as any,
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['id'],
              code: 'invalid_target_id',
              message: 'Target ID must be a string.',
            },
            {
              fieldPath: ['secrets'],
              code: 'invalid_secret_actions',
              message: 'Secret actions must be a list.',
            },
          ]),
        },
      },
    });
  });

  it('rejects raw values submitted as environment-reference secret replacements without echoing them', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer existing-token',
          },
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'Bearer raw-token-value' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['secrets', '0', 'replacement', 'value'],
              code: 'invalid_environment_reference',
              message: 'Environment reference must be an environment variable name or substitution expression.',
            },
          ]),
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-token-value|Bearer raw/i);
    expect(readConfig().mcpServers.github.headers.Authorization).toBe('Bearer existing-token');
  });

  it('allows adding new secret-capable fields through environment-reference secret actions', async () => {
    const checkConnectivity = vi.fn(async () => ({
      status: 'passed' as const,
      mode: 'bounded_dry_run' as const,
      checkedAt: '2026-07-07T00:00:00.000Z',
    }));
    const service = createService({ checkConnectivity });
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        secrets: [
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GITHUB_AUTHORIZATION' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
        diff: [
          expect.objectContaining({
            fieldPath: ['headers', 'Authorization'],
            secretAction: 'replace',
            oldValue: undefined,
            newValue: {
              kind: 'environmentReference',
              value: '${GITHUB_AUTHORIZATION}',
              storesSecretMaterial: false,
            },
            riskFlags: ['connection_critical', 'secret'],
          }),
        ],
      },
    });
    expect(checkConnectivity).toHaveBeenCalledWith({
      targetName: 'github',
      serverConfig: expect.objectContaining({
        headers: {
          Authorization: '${GITHUB_AUTHORIZATION}',
        },
      }),
    });
  });

  it('rejects secret-capable fields submitted through raw transport edits', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer existing-token',
          },
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          headers: {
            Authorization: 'Bearer raw-new-token',
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'headers'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-new-token|existing-token/);
  });

  it('rejects nested raw OAuth secret material submitted through transport edits', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          oauth: {
            metadata: {
              clientSecret: 'raw-oauth-secret',
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'oauth'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-oauth-secret/);
  });

  it('rejects nested raw OAuth secret-looking values submitted through transport edits', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          oauth: {
            metadata: {
              header: 'Bearer raw-oauth-token',
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'oauth'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-oauth-token|Bearer raw/i);
  });

  it('rejects raw OAuth string fields that bypass explicit secret actions', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          oauth: {
            clientId: 'raw-client-id',
            redirectUrl: 'https://callback.example.com/oauth',
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'oauth'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-client-id/);
  });

  it('rejects raw unknown transport fields that contain secret material', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          apiKey: 'raw-api-key',
          metadata: {
            clientSecret: {
              value: 'raw-metadata-secret',
            },
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'apiKey'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
            {
              fieldPath: ['transport', 'metadata'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-api-key|raw-metadata-secret/);
  });

  it('rejects raw args values that carry secret material', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          args: ['--header', 'Authorization: Bearer raw-token'],
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'args'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-token|Authorization: Bearer/i);
  });

  it('rejects reserved transport edit keys before applying preview edits', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        gateway: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: JSON.parse('{"transport":{"__proto__":{"url":"https://polluted.example.com/mcp"}}}'),
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', '__proto__'],
              code: 'invalid_transport_field_path',
              message: 'Transport field path contains a reserved segment.',
            },
          ]),
        },
        diff: [],
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(({} as Record<string, unknown>).url).toBeUndefined();
  });

  it('redacts nested OAuth secret material from existing config read models', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          oauth: {
            metadata: {
              clientSecret: 'raw-existing-oauth-secret',
            },
          },
        },
      },
    });
    const service = createService();

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
          transport: {
            oauth: {
              metadata: {
                clientSecret: { present: true, value: '[REDACTED]', secret: true },
              },
            },
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['oauth', 'metadata', 'clientSecret'],
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-existing-oauth-secret/);
  });

  it('redacts secret-bearing command args from existing config read models and summaries', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'stdio',
          command: 'node',
          args: [
            'server.js',
            '--header',
            'Authorization: Bearer raw-arg-token',
            '--header=Authorization: Bearer raw-inline-token',
            'Authorization: Bearer raw-standalone-token',
          ],
        },
      },
    });
    const service = createService();

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
            label: 'node server.js --header REDACTED --header=REDACTED REDACTED',
          },
          transport: {
            args: ['server.js', '--header', 'REDACTED', '--header=REDACTED', 'REDACTED'],
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['args', '2'],
            }),
            expect.objectContaining({
              fieldPath: ['args', '3'],
            }),
            expect.objectContaining({
              fieldPath: ['args', '4'],
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /raw-arg-token|raw-inline-token|raw-standalone-token|Authorization: Bearer/i,
    );
  });

  it('redacts object-valued secret-like fields from existing config read models', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          oauth: {
            metadata: {
              clientSecret: {
                value: 'raw-object-oauth-secret',
              },
            },
          },
        },
      },
    });
    const service = createService();

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
          transport: {
            oauth: {
              metadata: {
                clientSecret: { present: true, value: '[REDACTED]', secret: true },
              },
            },
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['oauth', 'metadata', 'clientSecret'],
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-object-oauth-secret/);
  });

  it('redacts nested OAuth secret-looking values from existing config read models', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          oauth: {
            metadata: {
              header: 'Bearer raw-existing-oauth-token',
            },
          },
        },
      },
    });
    const service = createService();

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
          transport: {
            oauth: {
              metadata: {
                header: { present: true, value: '[REDACTED]', secret: true },
              },
            },
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['oauth', 'metadata', 'header'],
            }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-existing-oauth-token|Bearer raw/i);
  });

  it('rejects malformed raw URL edits that contain userinfo secret material without echoing them', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://user:raw pass@bad host/mcp',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw pass|user:raw pass/);
  });

  it('redacts userinfo from malformed existing URLs in read models and summaries', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://user:raw pass@bad host/mcp?token=raw-token',
        },
      },
    });
    const service = createService();

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
            label: 'https://REDACTED@bad host/mcp?token=REDACTED',
          },
          transport: {
            url: 'https://REDACTED@bad host/mcp?token=REDACTED',
          },
          secretInputs: expect.arrayContaining([
            expect.objectContaining({ fieldPath: ['url', 'userinfo'] }),
            expect.objectContaining({ fieldPath: ['url', 'query', 'token'] }),
          ]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw pass|raw-token|user:raw pass/);
  });

  it('redacts existing URL query values that contain secret-looking material', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp?workspace=Bearer raw-url-token',
        },
      },
    });
    const service = createService();

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
            label: 'https://api.example.com/mcp?workspace=REDACTED',
          },
          transport: {
            url: 'https://api.example.com/mcp?workspace=REDACTED',
          },
          secretInputs: expect.arrayContaining([expect.objectContaining({ fieldPath: ['url', 'query', 'workspace'] })]),
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-url-token|Bearer raw/i);
  });

  it('rejects and redacts username-only malformed URL userinfo', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://raw user@bad host/mcp',
        },
      },
    });
    const service = createService();

    const detail = await service.getConfiguredServerDetail({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
    });
    const preview = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://raw user@bad host/mcp',
        },
      },
    });

    expect(detail).toMatchObject({
      ok: true,
      result: {
        server: {
          transport: {
            url: 'https://REDACTED@bad host/mcp',
          },
        },
      },
    });
    expect(preview).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(detail)).not.toMatch(/raw user/);
    expect(JSON.stringify(preview)).not.toMatch(/raw user/);
  });

  it('rejects replace and clear actions for malformed URL userinfo virtual fields', async () => {
    writeConfig({
      mcpServers: {
        gateway: {
          type: 'http',
          url: 'https://raw user@bad host/mcp',
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: {
        secrets: [
          {
            fieldPath: ['url', 'userinfo'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GATEWAY_USERINFO' },
          },
          {
            fieldPath: ['url', 'userinfo'],
            action: 'clear',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['secrets', '0', 'action'],
              code: 'unsupported_secret_action',
            }),
            expect.objectContaining({
              fieldPath: ['secrets', '1', 'action'],
              code: 'unsupported_secret_action',
            }),
          ]),
        },
        diff: [],
        configChange: {
          changed: false,
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(readConfig().mcpServers.gateway.url).toBe('https://raw user@bad host/mcp');
    expect(JSON.stringify(result)).not.toMatch(/raw user|GATEWAY_USERINFO/);
  });

  it('marks template changes with rendered-template risk', async () => {
    writeConfig({
      mcpServers: {
        templated: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          template: {
            shareable: true,
          },
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'templated' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'templated',
      edit: {
        transport: {
          template: {
            shareable: false,
          },
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        diff: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: ['transport', 'template'],
            riskFlags: ['connection_critical', 'template_risk'],
          }),
        ]),
      },
    });
  });

  it('marks template secret changes with rendered-template risk', async () => {
    writeConfig({
      mcpServers: {
        templated: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          template: {
            clientSecret: 'raw-template-secret',
          },
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'templated' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'templated',
      edit: {
        secrets: [
          {
            fieldPath: ['template', 'clientSecret'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'TEMPLATE_CLIENT_SECRET' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        diff: expect.arrayContaining([
          expect.objectContaining({
            fieldPath: ['template', 'clientSecret'],
            secretAction: 'replace',
            riskFlags: ['connection_critical', 'template_risk', 'secret'],
          }),
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-template-secret/);
  });

  it('rejects dangerous secret field-path segments before applying preview edits', async () => {
    const parsed = JSON.parse(
      '{"mcpServers":{"github":{"type":"http","url":"https://api.example.com/mcp","env":{"__proto__":"raw-secret"}}}}',
    );
    const service = createService({ readConfigDocument: () => parsed });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        secrets: [
          {
            fieldPath: ['env', '__proto__'],
            action: 'replace',
            replacement: { kind: 'environmentReference', value: 'GITHUB_TOKEN' },
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['secrets', '0', 'fieldPath'],
              code: 'invalid_secret_field_path',
              message: 'Secret field path contains a reserved segment.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(({} as Record<string, unknown>).GITHUB_TOKEN).toBeUndefined();
  });

  it('validates malformed transport fields against the runtime target schema', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        gateway: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: {
        transport: {
          template: {
            maxInstances: -1,
          },
          oauth: {
            autoRegister: 123,
          },
          disabledTools: ['safe-tool', 123],
          connectionTimeout: 'slow',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['transport', 'template', 'maxInstances'],
              code: 'invalid_transport_field',
            }),
            expect.objectContaining({
              fieldPath: ['transport', 'oauth'],
              code: 'transport_field_not_applicable',
            }),
            expect.objectContaining({
              fieldPath: ['transport', 'disabledTools', '1'],
              code: 'invalid_transport_field',
            }),
            expect.objectContaining({
              fieldPath: ['transport', 'connectionTimeout'],
              code: 'invalid_transport_field',
            }),
          ]),
        },
      },
    });
  });

  it('validates transport type-specific required fields', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        stdioSource: {
          type: 'stdio',
          command: 'node',
        },
        httpSource: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const httpWithoutUrl = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'stdioSource',
      edit: {
        transport: {
          type: 'http',
        },
      },
    });
    const stdioWithoutCommand = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'httpSource',
      edit: {
        transport: {
          type: 'stdio',
        },
      },
    });
    const malformedScalars = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'httpSource',
      edit: {
        transport: {
          type: 123,
          url: 456,
        },
      },
    });

    expect(httpWithoutUrl).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'missing_transport_url',
              message: 'URL is required for http servers.',
            },
          ]),
        },
      },
    });
    expect(stdioWithoutCommand).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'command'],
              code: 'missing_stdio_command',
              message: 'Command is required for stdio servers.',
            },
          ]),
        },
      },
    });
    expect(malformedScalars).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            expect.objectContaining({
              fieldPath: ['transport', 'type'],
              code: 'invalid_transport_field',
            }),
            expect.objectContaining({
              fieldPath: ['transport', 'url'],
              code: 'invalid_transport_field',
            }),
          ]),
        },
      },
    });
  });

  it('rejects raw URL secret material submitted through transport edits', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://api.example.com/mcp?token=raw-url-secret',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-url-secret/);
  });

  it('rejects raw URL secret query environment references so the diff cannot hide the change', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp?token=raw-url-secret',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://api.example.com/mcp?token=${GITHUB_TOKEN}',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
        configChange: {
          changed: false,
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-url-secret|GITHUB_TOKEN/);
  });

  it('rejects raw URL query values that contain secret-looking material', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
        },
      },
    });

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://api.example.com/mcp?workspace=Bearer raw-url-token',
        },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'url'],
              code: 'secret_transport_edit_requires_secret_action',
              message: 'Secret-capable transport fields must use explicit secret actions.',
            },
          ]),
        },
        diff: [],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/raw-url-token|Bearer raw/i);
  });

  it('rejects secret edits for unsupported fields and replace actions without replacement', async () => {
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer existing-token',
          },
        },
      },
    });
    const service = createService();

    const result = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        secrets: [
          {
            fieldPath: ['url'],
            action: 'clear',
          },
          {
            fieldPath: ['headers', 'Authorization'],
            action: 'replace',
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['secrets', '0', 'fieldPath'],
              code: 'unsupported_secret_field',
              message: 'Secret action must target a secret-capable field.',
            },
            {
              fieldPath: ['secrets', '1', 'replacement'],
              code: 'missing_secret_replacement',
              message: 'Replace actions require an explicit replacement.',
            },
          ]),
        },
        diff: [],
        configChange: {
          changed: false,
        },
        connectivityCheck: {
          status: 'skipped',
          reason: 'validation_failed',
        },
      },
    });
    expect(readConfig().mcpServers.github.url).toBe('https://api.example.com/mcp');
    expect(readConfig().mcpServers.github.headers.Authorization).toBe('Bearer existing-token');
  });

  it('includes the current redacted target state in the preview fingerprint', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://api.example.com/mcp',
          headers: {
            Authorization: 'Bearer first',
          },
        },
      },
    });
    const input = {
      context: context({
        target: { type: 'configured_server', id: 'github' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'github',
      edit: {
        transport: {
          url: 'https://api.example.com/v2/mcp',
        },
      },
    };

    const first = await service.previewConfiguredServerEdit(input);
    writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://other.example.com/mcp',
          headers: {
            Authorization: 'Bearer second',
          },
        },
      },
    });
    const second = await service.previewConfiguredServerEdit(input);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(first.ok && second.ok ? first.result.previewFingerprint : undefined).not.toBe(
      second.ok && first.ok ? second.result.previewFingerprint : undefined,
    );
    expect(JSON.stringify(first)).not.toMatch(/Bearer first|Bearer second/);
    expect(JSON.stringify(second)).not.toMatch(/Bearer first|Bearer second/);
  });

  it('accepts streamableHttp previews and validates args as strings', async () => {
    const service = createService();
    writeConfig({
      mcpServers: {
        gateway: {
          type: 'streamableHttp',
          url: 'https://api.example.com/mcp',
          args: ['--verbose'],
        },
      },
    });

    const valid = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: {},
    });
    const invalid = await service.previewConfiguredServerEdit({
      context: context({
        target: { type: 'configured_server', id: 'gateway' },
        idempotencyKey: undefined,
        requestFingerprint: undefined,
      }),
      targetName: 'gateway',
      edit: {
        transport: {
          args: ['--flag', 123],
        },
      },
    });

    expect(valid).toMatchObject({
      ok: true,
      result: {
        validation: { status: 'valid', errors: [] },
      },
    });
    expect(invalid).toMatchObject({
      ok: true,
      result: {
        validation: {
          status: 'invalid',
          errors: expect.arrayContaining([
            {
              fieldPath: ['transport', 'args'],
              code: 'transport_field_not_applicable',
              message: 'Args does not apply to streamableHttp transports.',
            },
          ]),
        },
      },
    });
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

  it('shows effective global transport defaults with field ownership and redacted inherited secrets', async () => {
    writeConfig({
      serverDefaults: {
        timeout: 5_000,
        headers: { Authorization: 'Bearer inherited-secret' },
        env: { SHARED_TOKEN: 'inherited-token' },
      },
      mcpServers: {
        alpha: { type: 'http', url: 'https://example.com/mcp', requestTimeout: 2_000 },
      },
    });
    const detail = await createService().getConfiguredServerDetail({ context: context(), targetName: 'alpha' });

    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.result.server.transport).toMatchObject({
      timeout: 5_000,
      requestTimeout: 2_000,
      headers: { Authorization: { present: true, value: '[REDACTED]', secret: true } },
      env: { SHARED_TOKEN: { present: true, value: '[REDACTED]', secret: true } },
    });
    const fields = detail.result.editContract.fieldGroups.flatMap((group) => group.fields);
    expect(fields.find((field) => field.fieldPath.join('.') === 'transport.timeout')).toMatchObject({
      source: 'inherited',
      overrideSupported: true,
      clearOverrideSupported: false,
    });
    expect(fields.find((field) => field.fieldPath.join('.') === 'transport.requestTimeout')).toMatchObject({
      source: 'server',
      clearOverrideSupported: true,
    });
    expect(fields.find((field) => field.fieldPath.join('.') === 'headers.Authorization')).toMatchObject({
      source: 'inherited',
      secret: { allowedActions: ['preserve', 'replace'] },
    });
    expect(JSON.stringify(detail)).not.toContain('inherited-secret');
    expect(JSON.stringify(detail)).not.toContain('inherited-token');
  });

  it('clears a server transport override and resumes inheritance from global defaults', async () => {
    writeConfig({
      serverDefaults: { timeout: 5_000 },
      mcpServers: { alpha: { type: 'http', url: 'https://example.com/mcp', timeout: 2_000 } },
    });
    const service = createService();
    const edit = { clearTransportOverrides: ['timeout'] };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.result.diff).toContainEqual(
      expect.objectContaining({ fieldPath: ['transport', 'timeout'], oldValue: 2_000, newValue: 5_000 }),
    );

    const applied = await service.applyConfiguredServerEdit({
      context: context({ confirmationFacts: { previewConfirmed: preview.result.previewFingerprint } }),
      targetName: 'alpha',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });
    expect(applied.ok).toBe(true);
    expect(readConfig().mcpServers.alpha).not.toHaveProperty('timeout');
    const detail = await service.getConfiguredServerDetail({ context: context(), targetName: 'alpha' });
    expect(detail.ok && detail.result.server.transport.timeout).toBe(5_000);
  });

  it('preserves sibling global values when replacing one inherited whole-field secret', async () => {
    writeConfig({
      serverDefaults: {
        headers: { Authorization: 'Bearer inherited-secret', 'X-Workspace': 'global-workspace' },
      },
      mcpServers: { alpha: { type: 'http', url: 'https://example.com/mcp', disabled: true } },
    });
    const service = createService();
    const edit = {
      secrets: [
        {
          fieldPath: ['headers', 'Authorization'],
          action: 'replace',
          replacement: { kind: 'environmentReference', value: 'NEW_TOKEN' },
        },
      ],
    };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const applied = await service.applyConfiguredServerEdit({
      context: context({
        confirmationFacts: {
          previewConfirmed: preview.result.previewFingerprint,
          connectionCriticalConfirmed: true,
          secretChangeConfirmed: true,
        },
      }),
      targetName: 'alpha',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });

    expect(applied.ok).toBe(true);
    expect(readConfig().mcpServers.alpha.headers).toEqual({
      Authorization: '${NEW_TOKEN}',
      'X-Workspace': 'global-workspace',
    });
  });

  it('rejects an apply when global transport defaults changed after preview', async () => {
    writeConfig({
      serverDefaults: { timeout: 5_000 },
      mcpServers: { alpha: { type: 'http', url: 'https://example.com/mcp' } },
    });
    const service = createService();
    const edit = { tags: ['updated'] };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    writeConfig({
      serverDefaults: { timeout: 6_000 },
      mcpServers: { alpha: { type: 'http', url: 'https://example.com/mcp' } },
    });

    await expect(
      service.applyConfiguredServerEdit({
        context: context({ confirmationFacts: { previewConfirmed: preview.result.previewFingerprint } }),
        targetName: 'alpha',
        edit,
        previewFingerprint: preview.result.previewFingerprint,
      }),
    ).rejects.toMatchObject({ code: 'configured_server_stale_preview' });
    expect(readConfig().mcpServers.alpha).not.toHaveProperty('tags');
  });

  it('applies a failed connectivity preview only with an explicit audited override', async () => {
    writeConfig({ mcpServers: { alpha: { type: 'http', url: 'https://old.example.com/mcp' } } });
    const service = createService({
      checkConnectivity: vi.fn<ConfiguredServerConnectivityChecker>().mockResolvedValue({
        status: 'failed',
        mode: 'bounded_dry_run',
        message: 'Connection refused with token=secret-value',
      }),
    });
    const edit = { transport: { url: 'https://new.example.com/mcp' } };
    const preview = await service.previewConfiguredServerEdit({
      context: context({ idempotencyKey: undefined, requestFingerprint: undefined }),
      targetName: 'alpha',
      edit,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await service.applyConfiguredServerEdit({
      context: context({
        confirmationFacts: {
          previewConfirmed: preview.result.previewFingerprint,
          connectionCriticalConfirmed: true,
          connectivityFailureOverrideConfirmed: true,
        },
      }),
      targetName: 'alpha',
      edit,
      previewFingerprint: preview.result.previewFingerprint,
    });

    expect(result.ok).toBe(true);
    expect(readConfig().mcpServers.alpha.url).toBe('https://new.example.com/mcp');
    expect(service.getRecentAuditFacts({ limit: 1 })[0]?.confirmationFacts).toMatchObject({
      connectivityFailureOverrideConfirmed: true,
    });
    expect(JSON.stringify(service.getRecentAuditFacts())).not.toContain('secret-value');
  });

  function createService(
    options: {
      readConfigDocument?: () => { serverDefaults?: Record<string, any>; mcpServers?: Record<string, any> } | null;
      checkConnectivity?: ConfiguredServerConnectivityChecker;
      mutationAvailability?: { available: boolean; reason?: 'writer_lock_unavailable' };
    } = {},
  ): AdminConfiguredServerService {
    const { mutationAvailability, ...serviceOptions } = options;
    const operationService = new AdminOperationService({
      runtimeScopeId: 'scope_123',
      storageDir,
      now: () => currentTime,
      createOperationId: () => `op_${currentTime.getTime()}`,
      mutationAvailability,
    });
    return new AdminConfiguredServerService({
      operationService,
      configChangeService: createConfigChangeService({
        reloadConfig: reload,
        now: () => currentTime.getTime(),
      }),
      readConfigDocument:
        serviceOptions.readConfigDocument ??
        (() => {
          if (!fs.existsSync(configPath)) {
            return null;
          }
          return JSON.parse(fs.readFileSync(configPath, 'utf8')) as { mcpServers?: Record<string, any> };
        }),
      ...serviceOptions,
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
