import { act, renderHook } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';

import {
  type AdminApiClient,
  AdminApiError,
  type AdminSession,
  type ConfiguredServerDeletePreviewResponse,
} from '../api/adminApi';
import { useConfiguredServerDelete } from './useConfiguredServerDelete';

const session: AdminSession = {
  authenticated: true,
  account: { id: 'admin-1', username: 'admin', role: 'full-admin' },
  csrfToken: 'csrf-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
};
const target = { type: 'configured_server' as const, source: 'mcpTemplates' as const, id: 'shared' };

function deletePreview(): ConfiguredServerDeletePreviewResponse {
  return {
    ok: true,
    operationId: 'preview-op',
    preview: {
      target,
      qualifiedId: 'mcpTemplates/shared',
      targetFingerprint: 'target-fingerprint',
      previewFingerprint: 'delete-preview-1',
      authority: 'authoritative',
      removal: {
        definition: {
          id: 'shared',
          source: 'mcpTemplates',
          target,
          enabled: true,
          tags: [],
          transportSummary: { kind: 'stdio', label: 'STDIO' },
          mutationAvailability: { available: false, operations: [] },
          actionState: {
            enable: { available: false, label: 'Enable' },
            disable: { available: false, label: 'Disable' },
          },
          transport: { type: 'stdio', command: '{{project.command}}' },
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
    },
  };
}

describe('useConfiguredServerDelete', () => {
  it('previews, blocks a bare-name confirmation, and applies the exact qualified identity', async () => {
    const previewConfiguredServerDelete = vi.fn(async () => deletePreview());
    const deleteConfiguredServer = vi.fn(async () => ({
      ok: true as const,
      operationId: 'delete-op',
      result: {
        target,
        qualifiedId: 'mcpTemplates/shared',
        previewFingerprint: 'delete-preview-1',
        configChange: deletePreview().preview.configChange,
      },
    }));
    const onDeleted = vi.fn();
    const api = { previewConfiguredServerDelete, deleteConfiguredServer } as Pick<
      AdminApiClient,
      'previewConfiguredServerDelete' | 'deleteConfiguredServer'
    >;
    const { result } = renderHook(() =>
      useConfiguredServerDelete({ api, session, onUnauthenticated: vi.fn(), onDeleted }),
    );

    await act(() => result.current.preview(target));
    act(() => result.current.changeConfirmation('shared'));
    await act(() => result.current.apply(target));
    expect(deleteConfiguredServer).not.toHaveBeenCalled();

    act(() => result.current.changeConfirmation('mcpTemplates/shared'));
    await act(() => result.current.apply(target));
    expect(deleteConfiguredServer).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        csrfToken: 'csrf-token',
        previewFingerprint: 'delete-preview-1',
        confirmedIdentity: 'mcpTemplates/shared',
        idempotencyKey: expect.stringMatching(/^admin-console-server-delete-/),
      }),
    );
    expect(onDeleted).toHaveBeenCalledWith(target, expect.objectContaining({ qualifiedId: 'mcpTemplates/shared' }));
  });

  it('clears preview and confirmation when the target source changes', async () => {
    const failure = new AdminApiError(
      409,
      {
        code: 'configured_server_source_changed',
        message: 'The source changed. Preview again.',
      },
      'configured_server_source_changed',
    );
    const api = {
      previewConfiguredServerDelete: vi.fn(async () => deletePreview()),
      deleteConfiguredServer: vi.fn(async () => {
        throw failure;
      }),
    } as unknown as Pick<AdminApiClient, 'previewConfiguredServerDelete' | 'deleteConfiguredServer'>;
    const { result } = renderHook(() =>
      useConfiguredServerDelete({ api, session, onUnauthenticated: vi.fn(), onDeleted: vi.fn() }),
    );

    await act(() => result.current.preview(target));
    act(() => result.current.changeConfirmation('mcpTemplates/shared'));
    await act(() => result.current.apply(target));

    expect(result.current.state).toMatchObject({ preview: null, confirmation: '', applyBusy: false });
  });

  it('preserves the completed delete result for post-write recovery UI', async () => {
    const recoveryResult = {
      target,
      qualifiedId: 'mcpTemplates/shared',
      previewFingerprint: 'delete-preview-1',
      configChange: {
        ...deletePreview().preview.configChange,
        backup: { created: true, path: '[redacted]' },
        reload: {
          status: 'failed' as const,
          error: 'Runtime reload failed after the configuration was deleted.',
        },
      },
    };
    const api = {
      previewConfiguredServerDelete: vi.fn(async () => deletePreview()),
      deleteConfiguredServer: vi.fn(async () => ({
        ok: true as const,
        operationId: 'delete-op',
        result: recoveryResult,
      })),
    } as Pick<AdminApiClient, 'previewConfiguredServerDelete' | 'deleteConfiguredServer'>;
    const { result } = renderHook(() =>
      useConfiguredServerDelete({ api, session, onUnauthenticated: vi.fn(), onDeleted: vi.fn() }),
    );

    await act(() => result.current.preview(target));
    act(() => result.current.changeConfirmation('mcpTemplates/shared'));
    await act(() => result.current.apply(target));

    expect(result.current.state).toMatchObject({ preview: null, confirmation: '', result: recoveryResult });
  });
});
