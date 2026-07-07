import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  type RuntimeTargetObservedIdentity,
  RuntimeTargetStore,
} from '@src/domains/runtime-targets/runtimeTargetStore.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  targetAddCommand,
  type TargetCommandDependencies,
  targetCurrentCommand,
  targetDeleteCommand,
  targetInspectCommand,
  targetListCommand,
  targetRenameCommand,
  targetUseCommand,
  targetVerifyCommand,
} from './target.js';

describe('target commands', () => {
  let storeDir: string;
  let now: Date;
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-command-'));
    now = new Date('2026-07-07T00:00:00.000Z');
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it('adds a verified target before writing metadata and switches only with --use', async () => {
    const store = createStore();
    const fetchRuntimeIdentity = vi.fn(async () => identity());

    await targetAddCommand(
      {
        name: 'prod',
        url: 'https://prod.example.com',
        displayName: ' Production ',
      },
      deps({ store, fetchRuntimeIdentity }),
    );

    expect(fetchRuntimeIdentity).toHaveBeenCalledWith('https://prod.example.com');
    expect(store.inspect('prod')).toMatchObject({
      name: 'prod',
      displayName: 'Production',
      observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      lastVerifiedAt: '2026-07-07T00:00:00.000Z',
    });
    expect(store.current()).toMatchObject({ name: 'local', synthetic: true });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('target use prod'));

    await targetAddCommand(
      {
        name: 'staging',
        url: 'https://staging.example.com',
        use: true,
      },
      deps({
        store,
        fetchRuntimeIdentity: vi.fn(async () =>
          identity({ runtimeScopeId: 'scope_staging', externalUrl: 'https://staging.example.com' }),
        ),
      }),
    );

    expect(store.current()).toMatchObject({ name: 'staging', current: true });
  });

  it('replaces a target URL with the same identity and requires explicit acceptance for identity changes', async () => {
    const store = createStore();
    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', {
      oauth: { profileId: 'oauth_ref' },
      adminSession: { handleId: 'admin_ref' },
    });

    await targetAddCommand(
      {
        name: 'prod',
        url: 'https://prod-new.example.com',
        replace: true,
      },
      deps({
        store,
        fetchRuntimeIdentity: vi.fn(async () => identity({ externalUrl: 'https://prod-new.example.com' })),
      }),
    );

    expect(store.inspect('prod')).toMatchObject({
      url: 'https://prod-new.example.com',
      displayName: 'Production',
      observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      credentialReferences: { oauth: false, adminSession: false },
    });

    await expect(
      targetAddCommand(
        {
          name: 'prod',
          url: 'https://replacement.example.com',
          replace: true,
        },
        deps({
          store,
          fetchRuntimeIdentity: vi.fn(async () =>
            identity({ runtimeScopeId: 'scope_replacement', externalUrl: 'https://replacement.example.com' }),
          ),
        }),
      ),
    ).rejects.toMatchObject({ code: 'identity_runtime_scope_mismatch' });

    stdout.mockClear();
    await targetAddCommand(
      {
        name: 'prod',
        url: 'https://replacement.example.com',
        replace: true,
        acceptNewIdentity: true,
      },
      deps({
        store,
        fetchRuntimeIdentity: vi.fn(async () =>
          identity({ runtimeScopeId: 'scope_replacement', externalUrl: 'https://replacement.example.com' }),
        ),
      }),
    );

    expect(store.inspect('prod').observedIdentity?.runtimeScopeId).toBe('scope_replacement');
    expect(stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('')).toContain(
      'runtimeScopeId: scope_prod -> scope_replacement',
    );
  });

  it('uses, lists, currents, and inspects targets offline with freshness and credential labels', async () => {
    const store = createStore();
    const fetchRuntimeIdentity = vi.fn();
    addVerified(store, 'stale');
    store.setCredentialReferences('stale', 'scope_prod', { oauth: { profileId: 'oauth_ref' } });
    writeImportedTarget();
    now = new Date('2026-08-07T00:00:00.001Z');

    await targetUseCommand({ name: 'imported' }, deps({ store, fetchRuntimeIdentity }));
    await targetCurrentCommand({}, deps({ store, fetchRuntimeIdentity }));
    await targetListCommand({}, deps({ store, fetchRuntimeIdentity }));
    await targetInspectCommand({ name: 'stale' }, deps({ store, fetchRuntimeIdentity }));

    expect(fetchRuntimeIdentity).not.toHaveBeenCalled();
    const output = stdout.mock.calls.map((call: unknown[]) => String(call[0])).join('');
    expect(output).toContain('Current target: imported');
    expect(output).toContain('warning_target_never_verified');
    expect(output).toContain('local');
    expect(output).toContain('stale');
    expect(output).toContain('verification=stale');
    expect(output).toContain('credentials=oauth');
    expect(output).toContain('runtimeScopeId: scope_prod');
  });

  it('deletes and renames targets offline while preserving reserved local protections', async () => {
    const store = createStore();
    const fetchRuntimeIdentity = vi.fn();
    addVerified(store, 'prod', {}, { use: true });

    await expect(targetDeleteCommand({ name: 'prod' }, deps({ store, fetchRuntimeIdentity }))).rejects.toMatchObject({
      code: 'target_is_current',
    });
    await targetDeleteCommand({ name: 'prod', force: true }, deps({ store, fetchRuntimeIdentity }));
    expect(store.current()).toMatchObject({ name: 'local', synthetic: true });

    addVerified(store, 'prod');
    await targetRenameCommand({ oldName: 'prod', newName: 'production' }, deps({ store, fetchRuntimeIdentity }));
    expect(store.inspect('production')).toMatchObject({ name: 'production' });
    expect(fetchRuntimeIdentity).not.toHaveBeenCalled();

    await expect(targetDeleteCommand({ name: 'local', force: true }, deps({ store }))).rejects.toMatchObject({
      code: 'target_local_reserved',
    });
    await expect(
      targetRenameCommand({ oldName: 'local', newName: 'remote-local' }, deps({ store })),
    ).rejects.toMatchObject({ code: 'target_local_reserved' });
  });

  it('verifies remote targets by updating non-secret metadata and verifies local via config-dir without store writes', async () => {
    const store = createStore();
    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', { adminSession: { handleId: 'admin_ref' } });
    now = new Date('2026-07-08T00:00:00.000Z');

    await targetVerifyCommand(
      { name: 'prod' },
      deps({
        store,
        fetchRuntimeIdentity: vi.fn(async () => identity({ runtimeVersion: '0.35.0' })),
      }),
    );

    expect(store.inspect('prod')).toMatchObject({
      observedIdentity: expect.objectContaining({ runtimeVersion: '0.35.0' }),
      lastVerifiedAt: '2026-07-08T00:00:00.000Z',
      credentialReferences: { oauth: false, adminSession: true },
    });

    const localStoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'target-local-verify-'));
    try {
      await targetVerifyCommand(
        { name: 'local', 'config-dir': '/tmp/runtime-scope' },
        deps({
          store: new RuntimeTargetStore({ storeDir: localStoreDir, now: () => now }),
          discoverServerWithPidFile: vi.fn(async () => ({
            url: 'http://127.0.0.1:3050/mcp',
            source: 'pidfile' as const,
            pid: 1234,
          })),
          fetchRuntimeIdentity: vi.fn(async () =>
            identity({ runtimeScopeId: 'scope_local', externalUrl: 'http://127.0.0.1:3050' }),
          ),
        }),
      );

      expect(fs.existsSync(path.join(localStoreDir, 'runtime-targets.json'))).toBe(false);
    } finally {
      fs.rmSync(localStoreDir, { recursive: true, force: true });
    }
  });

  it('rejects config-dir for target store commands and remote verify commands', async () => {
    const store = createStore();
    addVerified(store, 'prod');

    await expect(targetListCommand({ 'config-dir': '/tmp/runtime-scope' }, deps({ store }))).rejects.toMatchObject({
      code: 'target_store_config_dir_unsupported',
    });
    await expect(
      targetVerifyCommand({ name: 'prod', 'config-dir': '/tmp/runtime-scope' }, deps({ store })),
    ).rejects.toMatchObject({ code: 'target_config_dir_remote_unsupported' });
  });

  function createStore(): RuntimeTargetStore {
    return new RuntimeTargetStore({ storeDir, now: () => now });
  }

  function deps(overrides: Partial<TargetCommandDependencies> = {}): TargetCommandDependencies {
    return {
      store: createStore(),
      fetchRuntimeIdentity: vi.fn(async () => identity()),
      discoverServerWithPidFile: vi.fn(async () => ({
        url: 'http://127.0.0.1:3050/mcp',
        source: 'pidfile' as const,
        pid: 1234,
      })),
      ...overrides,
    };
  }

  function addVerified(
    store: RuntimeTargetStore,
    name: string,
    identityOverrides: Partial<RuntimeTargetObservedIdentity> = {},
    options: { use?: boolean } = {},
  ): void {
    const observedIdentity = identity(identityOverrides);
    const prepared = store.prepareAddTarget({
      name,
      url: observedIdentity.externalUrl,
      displayName: name === 'prod' ? 'Production' : undefined,
      use: options.use,
    });
    store.commitVerifiedAdd(prepared, observedIdentity);
  }

  function identity(overrides: Partial<RuntimeTargetObservedIdentity> = {}): RuntimeTargetObservedIdentity {
    return {
      identityProtocolVersion: '1',
      runtimeScopeId: 'scope_prod',
      externalUrl: 'https://prod.example.com',
      runtimeVersion: '0.34.0',
      ...overrides,
    };
  }

  function writeImportedTarget(): void {
    const metadataPath = path.join(storeDir, 'runtime-targets.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
      schemaVersion: 1;
      targets: Record<string, unknown>;
    };
    metadata.targets.imported = {
      name: 'imported',
      url: 'https://imported.example.com',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
});
