import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getGlobalConfigDir } from '@src/constants.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertRuntimeTargetConfigDirAllowed,
  normalizeDisplayName,
  RuntimeTargetStore,
  validateRuntimeTargetName,
} from './runtimeTargetStore.js';

describe('RuntimeTargetStore', () => {
  let storeDir: string;
  let currentTime: Date;

  beforeEach(() => {
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-target-store-'));
    currentTime = new Date('2026-07-07T00:00:00.000Z');
  });

  afterEach(() => {
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  function createStore() {
    return new RuntimeTargetStore({
      storeDir,
      now: () => currentTime,
    });
  }

  const identity = {
    identityProtocolVersion: '1' as const,
    runtimeScopeId: 'scope_prod',
    externalUrl: 'https://prod.example.com',
    runtimeVersion: '0.34.0',
  };

  it('resolves the default store directory from the user-global config dir', () => {
    expect(RuntimeTargetStore.defaultStoreDir()).toBe(getGlobalConfigDir());
  });

  it('defaults to synthetic local and writes verified remote target metadata to the injected store dir', () => {
    const store = createStore();

    expect(store.current()).toMatchObject({ name: 'local', kind: 'local', synthetic: true });
    expect(store.list()).toEqual([
      expect.objectContaining({ name: 'local', kind: 'local', synthetic: true, current: true }),
    ]);

    const reservation = store.prepareAddTarget({
      name: 'prod',
      url: 'https://prod.example.com',
      displayName: ' Production ',
    });
    store.commitVerifiedAdd(reservation, identity);

    expect(store.inspect('prod')).toMatchObject({
      name: 'prod',
      url: 'https://prod.example.com',
      displayName: 'Production',
      observedIdentity: identity,
      lastVerifiedAt: '2026-07-07T00:00:00.000Z',
    });
    expect(store.current()).toMatchObject({ name: 'local', synthetic: true });

    const metadataPath = path.join(storeDir, 'runtime-targets.json');
    expect(fs.existsSync(metadataPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(metadataPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      targets: {
        prod: expect.objectContaining({
          url: 'https://prod.example.com',
          observedIdentity: identity,
        }),
      },
    });
  });

  it('validates target names and display names before storing metadata', () => {
    expect(validateRuntimeTargetName('prod.us-east_1')).toBe('prod.us-east_1');
    for (const invalidName of [
      '',
      'Prod',
      'prod target',
      'prod/target',
      'prod\\target',
      '-prod',
      'prod$',
      'a'.repeat(64),
    ]) {
      expect(() => validateRuntimeTargetName(invalidName)).toThrowError(
        expect.objectContaining({ code: 'target_name_invalid' }),
      );
    }
    expect(() => validateRuntimeTargetName('local')).toThrowError(
      expect.objectContaining({ code: 'target_name_reserved' }),
    );

    expect(normalizeDisplayName('  Production 🚀  ')).toBe('Production 🚀');
    expect(normalizeDisplayName('   ')).toBeUndefined();
    expect(() => normalizeDisplayName(`Production\nRuntime`)).toThrowError(
      expect.objectContaining({ code: 'target_display_name_invalid' }),
    );
    expect(() => normalizeDisplayName('a'.repeat(81))).toThrowError(
      expect.objectContaining({ code: 'target_display_name_invalid' }),
    );
  });

  it('strips query strings and fragments from stored target URLs', () => {
    const store = createStore();
    const prepared = store.prepareAddTarget({
      name: 'prod',
      url: 'https://prod.example.com/mcp?preset=prod#fragment',
    });
    store.commitVerifiedAdd(prepared, identity);

    expect(store.inspect('prod').url).toBe('https://prod.example.com/mcp');
  });

  it('selects, deletes, and renames only stored remote targets while preserving the built-in local target', () => {
    const store = createStore();
    addVerified(store, 'prod');
    addVerified(store, 'staging', { runtimeScopeId: 'scope_staging', externalUrl: 'https://staging.example.com' });

    expect(() => store.prepareAddTarget({ name: 'local', url: 'https://local.example.com' })).toThrowError(
      expect.objectContaining({ code: 'target_name_reserved' }),
    );
    expect(() => store.deleteTarget('local', { force: true })).toThrowError(
      expect.objectContaining({ code: 'target_local_reserved' }),
    );
    expect(() => store.renameTarget('local', 'remote-local')).toThrowError(
      expect.objectContaining({ code: 'target_local_reserved' }),
    );

    const warning = store.useTarget('prod');
    expect(warning).toEqual({ target: expect.objectContaining({ name: 'prod', current: true }), warnings: [] });
    expect(store.current()).toMatchObject({ name: 'prod', current: true });
    expect(() => store.deleteTarget('prod')).toThrowError(expect.objectContaining({ code: 'target_is_current' }));

    store.renameTarget('prod', 'production');
    expect(store.current()).toMatchObject({ name: 'production', current: true });
    expect(store.inspect('production')).toMatchObject({
      name: 'production',
      displayName: 'Production',
      observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
    });

    store.deleteTarget('production', { force: true });
    expect(store.current()).toMatchObject({ name: 'local', current: true, synthetic: true });
    expect(() => store.inspect('production')).toThrowError(expect.objectContaining({ code: 'target_not_found' }));
    expect(store.inspect('staging')).toMatchObject({ name: 'staging' });
  });

  it('stores credentials in an owner-only secrets file and cleans them during delete, rename, and replacement', () => {
    const store = createStore();
    addVerified(store, 'prod');

    store.setCredentialReferences('prod', 'scope_prod', {
      oauth: { profileId: 'oauth_ref' },
      adminSession: { handleId: 'admin_ref' },
    });

    const secretsPath = path.join(storeDir, 'runtime-target-secrets.json');
    expect(fs.statSync(secretsPath).mode & 0o777).toBe(0o600);
    expect(
      JSON.stringify(JSON.parse(fs.readFileSync(path.join(storeDir, 'runtime-targets.json'), 'utf8'))),
    ).not.toContain('oauth_ref');
    expect(store.inspect('prod').credentialReferences).toEqual({ oauth: true, adminSession: true });

    store.renameTarget('prod', 'production');
    expect(store.inspect('production').credentialReferences).toEqual({ oauth: true, adminSession: true });
    expect(readSecrets().credentials.prod).toBeUndefined();

    store.deleteTarget('production');
    expect(readSecrets().credentials.production).toBeUndefined();

    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', { oauth: { profileId: 'oauth_ref' } });
    store.replaceVerifiedTarget({
      name: 'prod',
      url: 'https://prod-new.example.com',
      observedIdentity: { ...identity, externalUrl: 'https://prod-new.example.com' },
    });
    expect(store.inspect('prod')).toMatchObject({
      url: 'https://prod-new.example.com',
      observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_prod' }),
      credentialReferences: { oauth: false, adminSession: false },
    });

    store.setCredentialReferences('prod', 'scope_prod', { adminSession: { handleId: 'admin_ref' } });
    expect(() =>
      store.replaceVerifiedTarget({
        name: 'prod',
        url: 'https://prod-new.example.com',
        observedIdentity: { ...identity, runtimeScopeId: 'scope_replaced' },
      }),
    ).toThrowError(expect.objectContaining({ code: 'identity_runtime_scope_mismatch' }));
    expect(store.inspect('prod').credentialReferences).toEqual({ oauth: false, adminSession: true });

    store.replaceVerifiedTarget({
      name: 'prod',
      url: 'https://prod-new.example.com',
      observedIdentity: { ...identity, runtimeScopeId: 'scope_replaced' },
      acceptNewIdentity: true,
    });
    expect(store.inspect('prod').credentialReferences).toEqual({ oauth: false, adminSession: false });
  });

  it('does not commit replacement metadata when credential cleanup fails', () => {
    const store = createStore();
    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', { oauth: { profileId: 'oauth_ref' } });
    const renameSync = fs.renameSync;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(newPath).endsWith('runtime-target-secrets.json')) {
        throw new Error('secret write failed');
      }
      return renameSync(oldPath, newPath);
    });

    try {
      expect(() =>
        store.replaceVerifiedTarget({
          name: 'prod',
          url: 'https://prod-new.example.com',
          observedIdentity: { ...identity, externalUrl: 'https://prod-new.example.com' },
        }),
      ).toThrow('secret write failed');
    } finally {
      renameSpy.mockRestore();
    }

    expect(store.inspect('prod')).toMatchObject({
      url: 'https://prod.example.com',
      credentialReferences: { oauth: true, adminSession: false },
    });
  });

  it('rolls back credential cleanup when replacement metadata write fails', () => {
    const store = createStore();
    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', { oauth: { profileId: 'oauth_ref' } });
    const renameSync = fs.renameSync;
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
      if (String(newPath).endsWith('runtime-targets.json')) {
        throw new Error('metadata write failed');
      }
      return renameSync(oldPath, newPath);
    });

    try {
      expect(() =>
        store.replaceVerifiedTarget({
          name: 'prod',
          url: 'https://prod-new.example.com',
          observedIdentity: { ...identity, externalUrl: 'https://prod-new.example.com' },
        }),
      ).toThrow('metadata write failed');
    } finally {
      renameSpy.mockRestore();
    }

    expect(store.inspect('prod')).toMatchObject({
      url: 'https://prod.example.com',
      credentialReferences: { oauth: true, adminSession: false },
    });
  });

  it('lists stale and never-verified labels with credential-reference presence without contacting the network', () => {
    const store = createStore();
    addVerified(store, 'stale');
    store.setCredentialReferences('stale', 'scope_prod', { oauth: { profileId: 'oauth_ref' } });

    const metadataPath = path.join(storeDir, 'runtime-targets.json');
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
      targets: Record<string, unknown>;
    };
    metadata.targets.imported = {
      name: 'imported',
      url: 'https://imported.example.com',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    currentTime = new Date('2026-08-07T00:00:00.001Z');

    expect(store.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'local', verificationStatus: 'synthetic' }),
        expect.objectContaining({
          name: 'stale',
          verificationStatus: 'stale',
          credentialReferences: { oauth: true, adminSession: false },
        }),
        expect.objectContaining({
          name: 'imported',
          verificationStatus: 'never-verified',
          credentialReferences: { oauth: false, adminSession: false },
        }),
      ]),
    );
  });

  it('exposes config-dir rejection rules for target-store commands', () => {
    expect(() =>
      assertRuntimeTargetConfigDirAllowed({ command: 'target-store', targetName: 'prod', configDir: '/tmp/scope' }),
    ).toThrowError(expect.objectContaining({ code: 'target_store_config_dir_unsupported' }));
    expect(() =>
      assertRuntimeTargetConfigDirAllowed({ command: 'verify', targetName: 'prod', configDir: '/tmp/scope' }),
    ).toThrowError(expect.objectContaining({ code: 'target_config_dir_remote_unsupported' }));
    expect(() =>
      assertRuntimeTargetConfigDirAllowed({ command: 'verify', targetName: 'local', configDir: '/tmp/scope' }),
    ).not.toThrow();
  });

  it('runs add verification outside the store lock and fails cleanly when final commit loses a race', async () => {
    const store = createStore();
    let verifierCalls = 0;
    let verifierSawUnlocked = false;

    await expect(
      store.addVerifiedTarget({ name: 'race', url: 'https://loser.example.com' }, async ({ storeLocked }) => {
        verifierCalls += 1;
        verifierSawUnlocked = !storeLocked;
        addVerified(createStore(), 'race', {
          runtimeScopeId: 'scope_winner',
          externalUrl: 'https://winner.example.com',
        });
        return {
          ...identity,
          runtimeScopeId: 'scope_loser',
          externalUrl: 'https://loser.example.com',
        };
      }),
    ).rejects.toMatchObject({ code: 'target_already_exists' });

    expect(verifierCalls).toBe(1);
    expect(verifierSawUnlocked).toBe(true);
    expect(createStore().inspect('race')).toMatchObject({
      url: 'https://winner.example.com',
      observedIdentity: expect.objectContaining({ runtimeScopeId: 'scope_winner' }),
    });
  });

  it('updates observed identity metadata on verify without touching credentials and fails closed on scope mismatch', () => {
    const store = createStore();
    addVerified(store, 'prod');
    store.setCredentialReferences('prod', 'scope_prod', { adminSession: { handleId: 'admin_ref' } });

    currentTime = new Date('2026-07-08T00:00:00.000Z');
    const result = store.updateObservedIdentityMetadata('prod', {
      ...identity,
      externalUrl: 'https://proxy.example.com',
      runtimeVersion: '0.35.0',
    });

    expect(result).toMatchObject({
      warnings: [expect.objectContaining({ code: 'warning_external_url_mismatch' })],
      target: {
        lastVerifiedAt: '2026-07-08T00:00:00.000Z',
        observedIdentity: expect.objectContaining({ runtimeVersion: '0.35.0' }),
        credentialReferences: { oauth: false, adminSession: true },
      },
    });

    expect(() =>
      store.updateObservedIdentityMetadata('prod', { ...identity, runtimeScopeId: 'scope_other' }),
    ).toThrowError(expect.objectContaining({ code: 'identity_runtime_scope_mismatch' }));
    expect(store.inspect('prod').credentialReferences).toEqual({ oauth: false, adminSession: true });
  });

  function addVerified(
    store: RuntimeTargetStore,
    name: string,
    identityOverrides: Partial<typeof identity> = {},
    options: { use?: boolean } = {},
  ) {
    const targetIdentity = { ...identity, ...identityOverrides };
    const prepared = store.prepareAddTarget({
      name,
      url: targetIdentity.externalUrl,
      displayName: name === 'prod' ? 'Production' : undefined,
      use: options.use,
    });
    return store.commitVerifiedAdd(prepared, targetIdentity);
  }

  function readSecrets() {
    return JSON.parse(fs.readFileSync(path.join(storeDir, 'runtime-target-secrets.json'), 'utf8')) as {
      credentials: Record<string, unknown>;
    };
  }
});
