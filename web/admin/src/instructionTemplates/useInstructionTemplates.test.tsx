import { act, renderHook, waitFor } from '@testing-library/react';

import { vi } from 'vitest';

import type { AdminApiClient, AdminInstructionTemplateStore } from '../api/adminApi';
import { useInstructionTemplates } from './useInstructionTemplates';

const store: AdminInstructionTemplateStore = {
  activeIdentity: 'default',
  selectionExplicit: true,
  configFingerprint: 'config_1',
  legacyImportAvailable: true,
  renderFailures: {},
  templates: [
    {
      identity: 'default',
      variants: { initialization: 'init default', cli: 'cli default' },
      protected: true,
      active: true,
      draft: false,
      validation: { valid: true, initialization: { valid: true }, cli: { valid: true } },
    },
    {
      identity: 'focused',
      variants: { initialization: 'init focused', cli: 'cli focused' },
      protected: false,
      active: false,
      draft: true,
      validation: {
        valid: false,
        initialization: { valid: true },
        cli: { valid: false, error: 'Missing server instructions' },
      },
    },
  ],
};

function api(overrides: Partial<AdminApiClient> = {}): AdminApiClient {
  const mutationResponse = { ok: true as const, operationId: 'op_1', result: {} };
  return {
    listInstructionTemplates: vi.fn(async () => store),
    previewInstructionTemplate: vi.fn(async () => ({
      surface: 'cli',
      rendered: 'rendered output',
      effectiveServers: [],
      unresolvedTemplates: [],
    })),
    validateInstructionTemplate: vi.fn(async ({ identity }) => ({
      identity,
      expectedConfigFingerprint: 'config_1',
      previewFingerprint: 'preview_1',
    })),
    saveInstructionTemplate: vi.fn(async () => mutationResponse),
    activateInstructionTemplate: vi.fn(async () => mutationResponse),
    cloneInstructionTemplate: vi.fn(async () => mutationResponse),
    importLegacyInstructionTemplate: vi.fn(async () => mutationResponse),
    previewInstructionTemplateDelete: vi.fn(async () => ({ previewFingerprint: 'delete_1' })),
    deleteInstructionTemplate: vi.fn(async () => mutationResponse),
    ...overrides,
  } as AdminApiClient;
}

const confirm = vi.fn(async () => true);

describe('useInstructionTemplates', () => {
  it('discards a pending template load after logout', async () => {
    let resolveLoad!: (value: AdminInstructionTemplateStore) => void;
    const pendingLoad = new Promise<AdminInstructionTemplateStore>((resolve) => {
      resolveLoad = resolve;
    });
    const adminApi = api({ listInstructionTemplates: vi.fn(() => pendingLoad) });
    const { result, rerender } = renderHook(
      ({ csrfToken }) => useInstructionTemplates({ api: adminApi, active: true, csrfToken, confirm }),
      { initialProps: { csrfToken: 'csrf_1' as string | undefined } },
    );
    await waitFor(() => expect(adminApi.listInstructionTemplates).toHaveBeenCalledOnce());

    rerender({ csrfToken: undefined });
    await act(async () => resolveLoad(store));

    expect(result.current.items).toEqual([]);
    expect(result.current.activeIdentity).toBeUndefined();
    expect(result.current.busy).toBe(false);
  });

  it('discards an old-session load and refreshes after token replacement', async () => {
    let resolveOldLoad!: (value: AdminInstructionTemplateStore) => void;
    const oldLoad = new Promise<AdminInstructionTemplateStore>((resolve) => {
      resolveOldLoad = resolve;
    });
    const replacementStore = { ...store, activeIdentity: 'focused' };
    const listInstructionTemplates = vi.fn().mockReturnValueOnce(oldLoad).mockResolvedValueOnce(replacementStore);
    const adminApi = api({ listInstructionTemplates });
    const { result, rerender } = renderHook(
      ({ csrfToken }) => useInstructionTemplates({ api: adminApi, active: true, csrfToken, confirm }),
      { initialProps: { csrfToken: 'csrf_old' } },
    );
    await waitFor(() => expect(listInstructionTemplates).toHaveBeenCalledOnce());

    rerender({ csrfToken: 'csrf_new' });
    await waitFor(() => expect(listInstructionTemplates).toHaveBeenCalledTimes(2));
    await act(async () => resolveOldLoad(store));

    expect(result.current.activeIdentity).toBe('focused');
  });

  it('loads only when the instructions workspace becomes active', async () => {
    const adminApi = api();
    const { rerender } = renderHook(
      ({ active }) => useInstructionTemplates({ api: adminApi, active, csrfToken: 'csrf_1', confirm }),
      { initialProps: { active: false } },
    );

    expect(adminApi.listInstructionTemplates).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(adminApi.listInstructionTemplates).toHaveBeenCalledOnce());
  });

  it('invalidates a one-shot preview after any rendering input changes', async () => {
    const adminApi = api();
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.select('focused'));
    await act(async () => result.current.previewDraft());
    expect(result.current.preview?.rendered).toBe('rendered output');

    act(() => result.current.changeVariant('cli', 'changed after preview'));
    expect(result.current.preview).toBeNull();
    expect(result.current.previewStale).toBe(true);

    act(() => result.current.changeSelection({ mode: 'tags', tags: ['filesystem'] }));
    expect(result.current.preview).toBeNull();
  });

  it('saves an invalid draft without requiring validation to pass', async () => {
    const adminApi = api();
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.saveDraft());

    expect(adminApi.saveInstructionTemplate).toHaveBeenCalledWith({
      action: 'update',
      draft: {
        identity: 'focused',
        variants: { initialization: 'init focused', cli: 'cli focused' },
      },
      expectedConfigFingerprint: 'config_1',
      csrfToken: 'csrf_1',
      idempotencyKey: expect.stringMatching(/^admin-console-instruction-template-/),
    });
  });

  it('activates only with the fresh validation fingerprint and expires it on context changes', async () => {
    const adminApi = api();
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('default'));

    await act(async () => result.current.validateDraft());
    expect(result.current.activationValidation?.previewFingerprint).toBe('preview_1');
    await act(async () => result.current.activate());
    expect(adminApi.activateInstructionTemplate).toHaveBeenCalledWith({
      identity: 'default',
      expectedConfigFingerprint: 'config_1',
      previewFingerprint: 'preview_1',
      csrfToken: 'csrf_1',
      idempotencyKey: expect.stringMatching(/^admin-console-instruction-template-/),
    });

    await act(async () => result.current.validateDraft());
    act(() => result.current.changeRequestContext('{"project":{"name":"other"}}'));
    expect(result.current.activationValidation).toBeNull();
  });

  it('sends no context by default and a complete explicit context when enabled', async () => {
    const adminApi = api();
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.previewDraft());
    expect(adminApi.previewInstructionTemplate).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ requestContext: expect.anything() }),
    );

    act(() =>
      result.current.changeRequestContext(
        JSON.stringify({ project: { name: 'docs' }, user: { name: 'operator' }, environment: { prefixes: ['CI'] } }),
      ),
    );
    await act(async () => result.current.previewDraft());
    expect(adminApi.previewInstructionTemplate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requestContext: {
          project: { name: 'docs' },
          user: { name: 'operator' },
          environment: { prefixes: ['CI'] },
        },
      }),
    );
  });

  it('reuses a mutation idempotency key after failure and rotates it after success', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValue({ ok: true, operationId: 'op_1', result: {} });
    const adminApi = api({ saveInstructionTemplate: save });
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.saveDraft());
    await act(async () => result.current.saveDraft());
    expect(save.mock.calls[0][0].idempotencyKey).toBe(save.mock.calls[1][0].idempotencyKey);

    act(() => result.current.changeVariant('cli', 'next draft'));
    await act(async () => result.current.saveDraft());
    expect(save.mock.calls[2][0].idempotencyKey).not.toBe(save.mock.calls[1][0].idempotencyKey);
  });

  it('rotates a failed mutation key after refresh changes the config fingerprint', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('stale request'))
      .mockResolvedValue({ ok: true, operationId: 'op_2', result: {} });
    const list = vi
      .fn()
      .mockResolvedValueOnce(store)
      .mockResolvedValueOnce({ ...store, configFingerprint: 'config_2' });
    const adminApi = api({ listInstructionTemplates: list, saveInstructionTemplate: save });
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.configFingerprint).toBe('config_1'));
    act(() => result.current.select('focused'));

    await act(async () => result.current.saveDraft());
    await act(async () => result.current.load());
    expect(result.current.configFingerprint).toBe('config_2');
    await act(async () => result.current.saveDraft());

    expect(save.mock.calls[0][0]).toMatchObject({ expectedConfigFingerprint: 'config_1' });
    expect(save.mock.calls[1][0]).toMatchObject({ expectedConfigFingerprint: 'config_2' });
    expect(save.mock.calls[1][0].idempotencyKey).not.toBe(save.mock.calls[0][0].idempotencyKey);
  });

  it('retains activation validation and its idempotency key for a failed retry', async () => {
    const activate = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValue({ ok: true, operationId: 'op_1', result: {} });
    const adminApi = api({ activateInstructionTemplate: activate });
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('default'));
    await act(async () => result.current.validateDraft());

    await act(async () => result.current.activate());
    expect(result.current.activationValidation).not.toBeNull();
    await act(async () => result.current.activate());

    expect(activate.mock.calls[0][0].idempotencyKey).toBe(activate.mock.calls[1][0].idempotencyKey);
    expect(result.current.activationValidation).toBeNull();
  });

  it('confirms a permitted delete preview before mutation and keeps reload failures visible', async () => {
    const confirmation = vi.fn(async () => true);
    const deleteTemplate = vi.fn(async () => ({
      ok: true as const,
      operationId: 'op_delete',
      result: { reload: { status: 'failed', error: 'reload timed out' } },
    }));
    const adminApi = api({
      previewInstructionTemplateDelete: vi.fn(async () => ({
        identity: 'focused',
        allowed: true,
        expectedConfigFingerprint: 'config_1',
        previewFingerprint: 'delete_1',
      })),
      deleteInstructionTemplate: deleteTemplate,
    });
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm: confirmation }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.deleteSelected());

    expect(confirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete focused?',
        tone: 'danger',
        details: expect.arrayContaining([{ label: 'Template', value: 'focused' }]),
      }),
    );
    expect(deleteTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ previewFingerprint: 'delete_1', idempotencyKey: expect.any(String) }),
    );
    expect(result.current.reloadWarning).toContain('reload timed out');
  });

  it('does not delete when the operator cancels the delete preview confirmation', async () => {
    const deleteTemplate = vi.fn();
    const adminApi = api({
      previewInstructionTemplateDelete: vi.fn(async () => ({
        identity: 'focused',
        allowed: true,
        expectedConfigFingerprint: 'config_1',
        previewFingerprint: 'delete_1',
      })),
      deleteInstructionTemplate: deleteTemplate,
    });
    const { result } = renderHook(() =>
      useInstructionTemplates({
        api: adminApi,
        active: true,
        csrfToken: 'csrf_1',
        confirm: vi.fn(async () => false),
      }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.deleteSelected());

    expect(deleteTemplate).not.toHaveBeenCalled();
  });

  it('reports a failed delete preview through the hook error path', async () => {
    const adminApi = api({
      previewInstructionTemplateDelete: vi.fn(async () => {
        throw new TypeError('network unavailable');
      }),
    });
    const { result } = renderHook(() =>
      useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1', confirm }),
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => result.current.select('focused'));

    await act(async () => result.current.deleteSelected());

    expect(result.current.error).toBe('network unavailable');
  });
});
