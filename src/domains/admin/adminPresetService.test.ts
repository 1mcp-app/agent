import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PresetManager } from '@src/domains/preset/manager/presetManager.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AdminOperationContext, AdminOperationService } from './adminOperationService.js';
import { AdminPresetConflictError, AdminPresetService } from './adminPresetService.js';

describe('AdminPresetService', () => {
  let tempDir: string;
  let manager: PresetManager;
  let service: AdminPresetService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-presets-'));
    PresetManager.resetInstance();
    manager = PresetManager.getInstance(tempDir);
    await manager.loadPresetsWithoutWatcher();
    service = new AdminPresetService({
      operationService: new AdminOperationService({ runtimeScopeId: 'scope_1', storageDir: tempDir }),
      presetManager: manager,
      readServerTargets: () => ({
        enabled: { type: 'stdio', command: 'node', tags: ['web'] },
        disabled: { type: 'stdio', command: 'node', tags: ['web', 'private'], disabled: true },
      }),
      createBackupId: () => 'backup',
    });
  });

  afterEach(async () => {
    await manager.cleanup();
    PresetManager.resetInstance();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('previews enabled and disabled matches and preserves advanced queries', async () => {
    const result = await service.previewPreset({
      context: context(),
      draft: { name: 'web', strategy: 'advanced', tagQuery: { $advanced: 'web AND NOT private' } },
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        matchCount: 1,
        structuredConversion: { lossless: false },
        matches: [
          { name: 'enabled', enabled: true, matched: true },
          { name: 'disabled', enabled: false, matched: false },
        ],
      },
    });
  });

  it('previews presets when the runtime scope writer lock is unavailable', async () => {
    const lockedService = new AdminPresetService({
      operationService: new AdminOperationService({
        runtimeScopeId: 'scope_1',
        storageDir: tempDir,
        mutationAvailability: { available: false, reason: 'writer_lock_unavailable' },
      }),
      presetManager: manager,
      readServerTargets: () => ({ enabled: { type: 'stdio', command: 'node', tags: ['web'] } }),
    });

    const result = await lockedService.previewPreset({
      context: context(),
      draft: { name: 'web', strategy: 'or', tagQuery: { $or: [{ tag: 'web' }] } },
    });

    expect(result).toMatchObject({ ok: true, result: { matchCount: 1 } });
  });

  it('requires preview and zero-match confirmations before creating', async () => {
    const previewResult = await service.previewPreset({
      context: context(),
      draft: { name: 'none', strategy: 'or', tagQuery: { $or: [{ tag: 'missing' }] } },
    });
    if (!previewResult.ok) throw new Error('preview failed');

    const result = await service.createPreset({
      context: context({ idempotencyKey: 'key', requestFingerprint: 'create-none' }),
      draft: previewResult.result.draft,
      revision: previewResult.result.revision,
      previewFingerprint: previewResult.result.previewFingerprint,
    });

    expect(result).toMatchObject({
      ok: false,
      code: 'mutation_confirmation_required',
      confirmationRequirements: expect.arrayContaining([
        { code: 'previewConfirmed', expected: previewResult.result.previewFingerprint },
        { code: 'zeroMatchConfirmed', expected: true },
      ]),
    });
  });

  it('rejects stale revisions without overwriting CLI changes', async () => {
    const previewResult = await service.previewPreset({
      context: context(),
      draft: { name: 'web', strategy: 'or', tagQuery: { $or: [{ tag: 'web' }] } },
    });
    if (!previewResult.ok) throw new Error('preview failed');
    await manager.savePreset('cli-change', { strategy: 'or', tagQuery: { $or: [{ tag: 'private' }] } });

    await expect(
      service.createPreset({
        context: context({
          idempotencyKey: 'key',
          requestFingerprint: 'create-web',
          confirmationFacts: { previewConfirmed: previewResult.result.previewFingerprint },
        }),
        draft: previewResult.result.draft,
        revision: previewResult.result.revision,
        previewFingerprint: previewResult.result.previewFingerprint,
      }),
    ).resolves.toMatchObject({ ok: false, code: 'mutation_failed' });
    expect(manager.hasPreset('cli-change')).toBe(true);
    expect(manager.hasPreset('web')).toBe(false);
  });

  it('creates, audits, previews delete impact, and deletes with backups', async () => {
    const previewResult = await service.previewPreset({
      context: context(),
      draft: { name: 'web', strategy: 'or', tagQuery: { $or: [{ tag: 'web' }] } },
    });
    if (!previewResult.ok) throw new Error('preview failed');
    const created = await service.createPreset({
      context: context({
        idempotencyKey: 'create',
        requestFingerprint: 'create-web',
        confirmationFacts: { previewConfirmed: previewResult.result.previewFingerprint },
      }),
      draft: previewResult.result.draft,
      revision: previewResult.result.revision,
      previewFingerprint: previewResult.result.previewFingerprint,
    });
    expect(created).toMatchObject({ ok: true, result: { preset: { name: 'web' }, backupPath: expect.any(String) } });
    if (!created.ok) throw new Error('create failed');

    const deletePreview = await service.previewDeletePreset({
      context: context(),
      name: 'web',
      revision: (created.result as { revision: string }).revision,
    });
    expect(deletePreview).toMatchObject({
      ok: true,
      result: { matchCount: 2, consequence: expect.stringContaining('preset-not-found') },
    });
    if (!deletePreview.ok) throw new Error('delete preview failed');
    expect((deletePreview.result as { matches: unknown[] }).matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'disabled', enabled: false, matched: true })]),
    );
    const deleteResult = deletePreview.result as { previewFingerprint: string; revision: string };
    const deleted = await service.deletePreset({
      context: context({
        idempotencyKey: 'delete',
        requestFingerprint: 'delete-web',
        confirmationFacts: { previewConfirmed: deleteResult.previewFingerprint, presetNameConfirmed: 'web' },
      }),
      name: 'web',
      revision: deleteResult.revision,
      previewFingerprint: deleteResult.previewFingerprint,
    });
    expect(deleted).toMatchObject({ ok: true, result: { deleted: 'web', backupPath: expect.any(String) } });
    expect(service.getRecentAuditFacts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operationName: 'createPreset' }),
        expect.objectContaining({ operationName: 'deletePreset' }),
      ]),
    );
  });

  it('reports lossless structured conversion only for flat OR and AND queries', async () => {
    const result = await service.previewPreset({
      context: context(),
      draft: { name: 'web', strategy: 'and', tagQuery: { $and: [{ tag: 'web' }, { tag: 'private' }] } },
    });
    expect(result).toMatchObject({
      ok: true,
      result: { structuredConversion: { lossless: true, strategy: 'and', tags: ['web', 'private'] } },
    });
    expect(new AdminPresetConflictError().code).toBe('preset_revision_conflict');
  });
});

function context(overrides: Partial<AdminOperationContext> = {}): AdminOperationContext {
  return {
    actor: { type: 'admin_session', accountId: 'acct', sessionId: 'session' },
    origin: 'browser',
    target: { type: 'preset' },
    runtimeIdentity: { runtimeScopeId: 'scope_1', runtimeVersion: '1.0.0' },
    request: { requestId: 'req' },
    ...overrides,
  };
}
