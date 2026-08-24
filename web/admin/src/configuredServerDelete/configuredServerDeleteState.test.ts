import { describe, expect, it } from 'vitest';

import type { ConfiguredServerDeletePreview } from '../api/adminApi';
import {
  configuredServerDeleteEligible,
  configuredServerDeleteRecoveryRequired,
  createConfiguredServerDeleteState,
  reduceConfiguredServerDeleteState,
} from './configuredServerDeleteState';

const preview: ConfiguredServerDeletePreview = {
  target: { type: 'configured_server', source: 'mcpTemplates', id: 'shared' },
  qualifiedId: 'mcpTemplates/shared',
  targetFingerprint: 'configured_server_target',
  previewFingerprint: 'delete_preview_1',
  authority: 'authoritative',
  removal: {
    definition: {
      id: 'shared',
      source: 'mcpTemplates',
      target: { type: 'configured_server', source: 'mcpTemplates', id: 'shared' },
      enabled: true,
      tags: [],
      transportSummary: { kind: 'stdio', label: 'STDIO' },
      mutationAvailability: { available: false, operations: [] },
      actionState: {
        enable: { available: false, label: 'Enable' },
        disable: { available: false, label: 'Disable' },
      },
      transport: { type: 'stdio', command: 'redacted' },
      secretInputs: [],
    },
    preservesSameNamedOtherSource: true,
    cascades: false,
  },
  configChange: {
    status: 'changed',
    operation: 'remove',
    target: { name: 'shared', source: 'mcpTemplates' },
    changed: true,
    backup: { created: false },
    retentionCleanup: { attempted: false, deletedPaths: [], warnings: [] },
    reload: { status: 'skipped' },
  },
  expectedBackup: { policy: 'required', recoveryCopy: true },
  expectedReload: {
    policy: 'observe_after_write',
    possibleStatuses: ['observed', 'runtime_not_running', 'reload_disabled', 'failed'],
  },
  runtimeImpact: { kind: 'template', activeInstanceCount: 2, retirement: 'reload_scheduled' },
  warnings: [],
};

describe('configured server delete state', () => {
  it('requires exact source-qualified confirmation and clears stale previews', () => {
    let state = reduceConfiguredServerDeleteState(createConfiguredServerDeleteState(), {
      type: 'previewSucceeded',
      preview,
    });
    state = reduceConfiguredServerDeleteState(state, { type: 'confirmationChanged', value: 'shared' });
    expect(configuredServerDeleteEligible(state)).toBe(false);
    state = reduceConfiguredServerDeleteState(state, {
      type: 'confirmationChanged',
      value: 'mcpTemplates/shared',
    });
    expect(configuredServerDeleteEligible(state)).toBe(true);
    state = reduceConfiguredServerDeleteState(state, {
      type: 'applyFailed',
      message: 'Delete failed: Preview is stale.',
      clearPreview: true,
    });
    expect(state).toMatchObject({ preview: null, confirmation: '', error: 'Delete failed: Preview is stale.' });
  });

  it('preserves a completed post-write recovery result', () => {
    const result = {
      target: preview.target,
      qualifiedId: preview.qualifiedId,
      previewFingerprint: preview.previewFingerprint,
      configChange: {
        ...preview.configChange,
        backup: { created: true, path: '/redacted/backup' },
        reload: { status: 'failed' as const, error: 'reload failed' },
      },
      runtimeImpact: {
        activeInstancesBefore: 2,
        retiredInstances: 0,
        activeInstancesAfter: 2,
        retirementObserved: false,
      },
    };
    const state = reduceConfiguredServerDeleteState(createConfiguredServerDeleteState(), {
      type: 'applySucceeded',
      result,
    });

    expect(state).toMatchObject({ preview: null, confirmation: '', applyBusy: false, result });
  });

  it.each(['failed', 'runtime_not_running', 'reload_disabled'] as const)(
    'requires recovery when runtime reload status is %s',
    (status) => {
      expect(
        configuredServerDeleteRecoveryRequired({
          target: preview.target,
          qualifiedId: preview.qualifiedId,
          previewFingerprint: preview.previewFingerprint,
          configChange: { ...preview.configChange, reload: { status } },
        }),
      ).toBe(true);
    },
  );

  it('requires recovery when Template retirement is not observed after reload', () => {
    expect(
      configuredServerDeleteRecoveryRequired({
        target: preview.target,
        qualifiedId: preview.qualifiedId,
        previewFingerprint: preview.previewFingerprint,
        configChange: { ...preview.configChange, reload: { status: 'observed' } },
        runtimeImpact: {
          activeInstancesBefore: 2,
          retiredInstances: 0,
          activeInstancesAfter: 2,
          retirementObserved: false,
        },
      }),
    ).toBe(true);
  });
});
