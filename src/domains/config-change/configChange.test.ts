import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import ConfigContext from '@src/config/configContext.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfigChangeService, fingerprintConfiguredServerTarget } from './configChange.js';

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

describe('Config Change', () => {
  let tempDir: string;
  let configPath: string;
  let reload: (configPath: string) => void;

  beforeEach(async () => {
    tempDir = path.join(tmpdir(), `config-change-test-${randomBytes(4).toString('hex')}`);
    await fs.mkdir(tempDir, { recursive: true });
    configPath = path.join(tempDir, 'mcp.json');
    ConfigContext.getInstance().setConfigPath(configPath);
    reload = vi.fn<(configPath: string) => void>();
  });

  afterEach(async () => {
    ConfigContext.getInstance().reset();
    vi.clearAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses a keyed opaque fingerprint for configured server credentials', () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://user:password@example.com/mcp',
    };

    const fingerprint = fingerprintConfiguredServerTarget(serverConfig);
    const formerUnkeyedFingerprint = `configured_server_${createHash('sha256')
      .update(JSON.stringify(serverConfig))
      .digest('hex')}`;

    expect(fingerprintConfiguredServerTarget(serverConfig)).toBe(fingerprint);
    expect(fingerprint).toMatch(/^configured_server_[a-f0-9]{64}$/);
    expect(fingerprint).not.toBe(formerUnkeyedFingerprint);
    expect(fingerprint).not.toContain('password');
    expect(fingerprintConfiguredServerTarget({ ...serverConfig, url: 'https://user:other@example.com/mcp' })).not.toBe(
      fingerprint,
    );
  });

  it('atomically edits and renames a configured server with one required backup and reload', async () => {
    const original = {
      type: 'http' as const,
      url: 'https://old.example.com/mcp',
      headers: { Authorization: 'secret' },
    };
    await writeConfig({ customTopLevel: { preserved: true }, mcpServers: { alpha: original } });
    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.editConfiguredServerTarget({
      sourceName: 'alpha',
      targetName: 'renamed',
      serverConfig: { ...original, url: 'https://new.example.com/mcp' },
      expectedSourceFingerprint: fingerprintConfiguredServerTarget(original),
    });

    expect(result).toMatchObject({
      status: 'changed',
      operation: 'edit',
      target: { name: 'renamed', source: 'mcpServers' },
      changed: true,
      backup: { created: true },
      reload: { status: 'observed' },
    });
    expect(await readConfig()).toEqual({
      customTopLevel: { preserved: true },
      mcpServers: { renamed: { ...original, url: 'https://new.example.com/mcp' } },
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rejects stale edit preconditions without backup, write, or reload', async () => {
    const original = { type: 'stdio' as const, command: 'node' };
    await writeConfig({ mcpServers: { alpha: original } });
    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.editConfiguredServerTarget({
      sourceName: 'alpha',
      targetName: 'alpha',
      serverConfig: { ...original, command: 'bun' },
      expectedSourceFingerprint: fingerprintConfiguredServerTarget({ ...original, command: 'changed' }),
    });

    expect(result).toMatchObject({ status: 'source_conflict', changed: false, backup: { created: false } });
    expect(await readConfig()).toEqual({ mcpServers: { alpha: original } });
    expect(reload).not.toHaveBeenCalled();
  });

  it('rejects rename destination conflicts before backup or write', async () => {
    const original = { type: 'stdio' as const, command: 'node' };
    await writeConfig({
      mcpServers: { alpha: original, occupied: { type: 'stdio', command: 'bun' } },
    });
    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.editConfiguredServerTarget({
      sourceName: 'alpha',
      targetName: 'occupied',
      serverConfig: original,
      expectedSourceFingerprint: fingerprintConfiguredServerTarget(original),
    });

    expect(result).toMatchObject({ status: 'destination_conflict', changed: false, backup: { created: false } });
    expect((await readConfig()).mcpServers).toHaveProperty('alpha');
    expect(reload).not.toHaveBeenCalled();
  });

  it('removes a static configured target with default destructive backup and observed reload', async () => {
    await writeConfig({
      customTopLevel: { preserved: true },
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          customServerField: 'keep',
        },
        github: {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
      mcpTemplates: {
        contextual: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const service = createConfigChangeService({
      reloadConfig: reload,
    });

    const result = await service.removeConfiguredServerTarget({
      targetName: 'filesystem',
      operation: 'uninstall',
    });

    expect(result.status).toBe('changed');
    expect(result.operation).toBe('remove');
    expect(result.target).toEqual({
      name: 'filesystem',
      source: 'mcpServers',
    });
    expect(result.changed).toBe(true);
    expect(result.backup?.created).toBe(true);
    expect(result.backup?.path).toMatch(/mcp\.json\.backup\.\d+$/u);
    expect(result.reload).toEqual({ status: 'observed' });
    expect(reload).toHaveBeenCalledWith(configPath);

    const savedConfig = await readConfig();
    expect(savedConfig).toEqual({
      customTopLevel: { preserved: true },
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
      mcpTemplates: {
        contextual: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    expect(result.backup?.path).toBeDefined();
    const backupContent = JSON.parse(await fs.readFile(result.backup.path!, 'utf8'));
    expect(backupContent.mcpServers.filesystem.customServerField).toBe('keep');
  });

  it('sets a new static configured target without a backup by default', async () => {
    await writeConfig({
      customTopLevel: { preserved: true },
      mcpServers: {
        existing: {
          type: 'stdio',
          command: 'node',
        },
      },
      mcpTemplates: {
        templateOnly: {
          type: 'stdio',
          command: 'template',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.setStaticConfiguredServerTarget({
      targetName: 'new-server',
      serverConfig: {
        type: 'http',
        url: 'https://example.com/mcp',
      },
      operation: 'install',
    });

    expect(result).toMatchObject({
      status: 'changed',
      operation: 'set_static',
      changed: true,
      target: {
        name: 'new-server',
        source: 'mcpServers',
      },
      backup: {
        created: false,
      },
      reload: {
        status: 'observed',
      },
    });
    expect(reload).toHaveBeenCalledWith(configPath);
    expect(await readConfig()).toEqual({
      customTopLevel: { preserved: true },
      mcpServers: {
        existing: {
          type: 'stdio',
          command: 'node',
        },
        'new-server': {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
      mcpTemplates: {
        templateOnly: {
          type: 'stdio',
          command: 'template',
        },
      },
    });
  });

  it('creates a backup before replacing a static configured target when requested', async () => {
    await writeConfig({
      mcpServers: {
        replaceMe: {
          type: 'stdio',
          command: 'old',
          preservedInBackup: true,
        },
      },
    });

    const now = Date.UTC(2026, 4, 21);
    const service = createConfigChangeService({
      reloadConfig: reload,
      now: () => now,
    });

    const result = await service.setStaticConfiguredServerTarget({
      targetName: 'replaceMe',
      serverConfig: {
        type: 'stdio',
        command: 'new',
      },
      operation: 'install',
      backup: 'required',
    });

    expect(result.status).toBe('changed');
    expect(result.backup).toEqual({
      created: true,
      path: `${configPath}.backup.${now}`,
    });
    expect(JSON.parse(await fs.readFile(result.backup.path!, 'utf8')).mcpServers.replaceMe).toEqual({
      type: 'stdio',
      command: 'old',
      preservedInBackup: true,
    });
    expect(await readConfig()).toEqual({
      mcpServers: {
        replaceMe: {
          type: 'stdio',
          command: 'new',
        },
      },
    });
  });

  it('refuses to set a static target over a template target name', async () => {
    await writeConfig({
      mcpServers: {},
      mcpTemplates: {
        templateName: {
          type: 'stdio',
          command: 'template',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.setStaticConfiguredServerTarget({
      targetName: 'templateName',
      serverConfig: {
        type: 'stdio',
        command: 'new',
      },
      operation: 'install',
    });

    expect(result).toMatchObject({
      status: 'template_conflict',
      changed: false,
      target: {
        name: 'templateName',
        source: 'mcpTemplates',
      },
      backup: {
        created: false,
      },
      reload: {
        status: 'skipped',
      },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(await readConfig()).toEqual({
      mcpServers: {},
      mcpTemplates: {
        templateName: {
          type: 'stdio',
          command: 'template',
        },
      },
    });
  });

  it('uses template-first resolution when duplicate configured target names exist', async () => {
    await writeConfig({
      mcpServers: {
        duplicate: {
          type: 'stdio',
          command: 'static',
        },
      },
      mcpTemplates: {
        duplicate: {
          type: 'stdio',
          command: 'template',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.removeConfiguredServerTarget({
      targetName: 'duplicate',
      operation: 'uninstall',
      backup: 'skip',
    });

    expect(result.target).toEqual({
      name: 'duplicate',
      source: 'mcpTemplates',
    });
    expect(result.backup).toEqual({ created: false });

    const savedConfig = await readConfig();
    expect(savedConfig.mcpServers.duplicate).toEqual({
      type: 'stdio',
      command: 'static',
    });
    expect(savedConfig.mcpTemplates).toEqual({});
  });

  it('reports reload failure after a successful write without rolling back', async () => {
    await writeConfig({
      mcpServers: {
        failing: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const service = createConfigChangeService({
      reloadConfig: vi.fn<(configPath: string) => void>(() => {
        throw new Error('reload failed');
      }),
    });

    const result = await service.removeConfiguredServerTarget({
      targetName: 'failing',
      operation: 'uninstall',
      backup: 'skip',
    });

    expect(result.status).toBe('changed');
    expect(result.changed).toBe(true);
    expect(result.reload).toEqual({
      status: 'failed',
      error: 'reload failed',
    });
    expect(await readConfig()).toEqual({
      mcpServers: {},
    });
  });

  it('enables a disabled static configured target through backup, validation, write, and reload observation', async () => {
    await writeConfig({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          disabled: true,
          env: {
            API_TOKEN: 'secret',
          },
        },
      },
    });

    const now = Date.UTC(2026, 6, 7);
    const service = createConfigChangeService({
      reloadConfig: reload,
      now: () => now,
    });

    const result = await service.setConfiguredServerTargetEnabledState({
      targetName: 'filesystem',
      enabled: true,
      backup: 'required',
    });

    expect(result).toMatchObject({
      status: 'changed',
      operation: 'enable',
      changed: true,
      target: {
        name: 'filesystem',
        source: 'mcpServers',
      },
      backup: {
        created: true,
        path: `${configPath}.backup.${now}`,
      },
      reload: {
        status: 'observed',
      },
    });
    expect(reload).toHaveBeenCalledWith(configPath);
    expect(await readConfig()).toEqual({
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          env: {
            API_TOKEN: 'secret',
          },
        },
      },
    });
  });

  it('disables an enabled static configured target through backup, validation, write, and reload observation', async () => {
    await writeConfig({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.setConfiguredServerTargetEnabledState({
      targetName: 'github',
      enabled: false,
      backup: 'required',
    });

    expect(result).toMatchObject({
      status: 'changed',
      operation: 'disable',
      changed: true,
      target: {
        name: 'github',
        source: 'mcpServers',
      },
      backup: {
        created: true,
      },
      reload: {
        status: 'observed',
      },
    });
    expect(await readConfig()).toEqual({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://example.com/mcp',
          disabled: true,
        },
      },
    });
  });

  it('returns unchanged without backup, write, or reload when the requested enabled state is already true', async () => {
    await writeConfig({
      mcpServers: {
        alreadyEnabled: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.setConfiguredServerTargetEnabledState({
      targetName: 'alreadyEnabled',
      enabled: true,
      backup: 'required',
    });

    expect(result).toMatchObject({
      status: 'unchanged',
      operation: 'enable',
      changed: false,
      backup: {
        created: false,
      },
      reload: {
        status: 'skipped',
      },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(await readConfig()).toEqual({
      mcpServers: {
        alreadyEnabled: {
          type: 'stdio',
          command: 'node',
        },
      },
    });
  });

  it('refuses to enable or disable template configured targets', async () => {
    await writeConfig({
      mcpTemplates: {
        templateOnly: {
          type: 'stdio',
          command: 'node',
          disabled: true,
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.setConfiguredServerTargetEnabledState({
      targetName: 'templateOnly',
      enabled: true,
      backup: 'required',
    });

    expect(result).toMatchObject({
      status: 'template_conflict',
      operation: 'enable',
      changed: false,
      target: {
        name: 'templateOnly',
        source: 'mcpTemplates',
      },
      reload: {
        status: 'skipped',
      },
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('returns not_found without writing, backing up, or reloading', async () => {
    await writeConfig({
      mcpServers: {
        existing: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const service = createConfigChangeService({ reloadConfig: reload });

    const result = await service.removeConfiguredServerTarget({
      targetName: 'missing',
      operation: 'uninstall',
    });

    expect(result).toMatchObject({
      status: 'not_found',
      changed: false,
      target: {
        name: 'missing',
      },
      backup: {
        created: false,
      },
      reload: {
        status: 'skipped',
      },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(await readConfig()).toEqual({
      mcpServers: {
        existing: {
          type: 'stdio',
          command: 'node',
        },
      },
    });
  });

  it('applies backup retention by deleting backups outside the latest count or older than max age', async () => {
    await writeConfig({
      mcpServers: {
        target: {
          type: 'stdio',
          command: 'node',
        },
      },
    });
    await fs.writeFile(
      path.join(tempDir, 'config.toml'),
      ['[configChange.backupRetention]', 'keepLatest = 3', 'maxAgeDays = 30'].join('\n'),
    );

    const now = Date.UTC(2026, 4, 21);
    const oldBackup = await writeBackup(now - 31 * 24 * 60 * 60 * 1000);
    const crowdedBackup = await writeBackup(now - 4 * 1000);
    const keptBackupA = await writeBackup(now - 3 * 1000);
    const keptBackupB = await writeBackup(now - 2 * 1000);

    const service = createConfigChangeService({
      reloadConfig: reload,
      now: () => now,
    });

    const result = await service.removeConfiguredServerTarget({
      targetName: 'target',
      operation: 'uninstall',
    });

    expect(result.retentionCleanup).toEqual({
      attempted: true,
      deletedPaths: expect.arrayContaining([oldBackup, crowdedBackup]),
      warnings: [],
    });
    expect(await exists(oldBackup)).toBe(false);
    expect(await exists(crowdedBackup)).toBe(false);
    expect(await exists(keptBackupA)).toBe(true);
    expect(await exists(keptBackupB)).toBe(true);
    expect(await exists(result.backup.path!)).toBe(true);
  });

  it('fails with a lock timeout result when another writer holds the config lock', async () => {
    await writeConfig({
      mcpServers: {
        blocked: {
          type: 'stdio',
          command: 'node',
        },
      },
    });

    const release = await createConfigChangeService().acquireConfigLockForTest(configPath);
    try {
      const service = createConfigChangeService({
        reloadConfig: reload,
        lockTimeoutMs: 1,
      });

      const result = await service.removeConfiguredServerTarget({
        targetName: 'blocked',
        operation: 'uninstall',
      });

      expect(result).toMatchObject({
        status: 'failed',
        changed: false,
        target: {
          name: 'blocked',
        },
        backup: {
          created: false,
        },
        reload: {
          status: 'skipped',
        },
      });
      expect(result.error).toMatch(/Timed out waiting for config lock/u);
      expect(reload).not.toHaveBeenCalled();
      expect(await readConfig()).toEqual({
        mcpServers: {
          blocked: {
            type: 'stdio',
            command: 'node',
          },
        },
      });
    } finally {
      release();
    }
  });

  async function writeConfig(config: Record<string, unknown>): Promise<void> {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  }

  async function readConfig(): Promise<Record<string, any>> {
    return JSON.parse(await fs.readFile(configPath, 'utf8'));
  }

  async function writeBackup(timestamp: number): Promise<string> {
    const backupPath = `${configPath}.backup.${timestamp}`;
    await fs.writeFile(backupPath, JSON.stringify({ timestamp }, null, 2));
    return backupPath;
  }

  async function exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
});
