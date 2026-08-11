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
    saveInstructionTemplate: vi.fn(async () => ({})),
    activateInstructionTemplate: vi.fn(async () => ({})),
    cloneInstructionTemplate: vi.fn(async () => ({})),
    importLegacyInstructionTemplate: vi.fn(async () => ({})),
    previewInstructionTemplateDelete: vi.fn(async () => ({ previewFingerprint: 'delete_1' })),
    deleteInstructionTemplate: vi.fn(async () => ({})),
    ...overrides,
  } as AdminApiClient;
}

describe('useInstructionTemplates', () => {
  it('loads only when the instructions workspace becomes active', async () => {
    const adminApi = api();
    const { rerender } = renderHook(
      ({ active }) => useInstructionTemplates({ api: adminApi, active, csrfToken: 'csrf_1' }),
      { initialProps: { active: false } },
    );

    expect(adminApi.listInstructionTemplates).not.toHaveBeenCalled();
    rerender({ active: true });
    await waitFor(() => expect(adminApi.listInstructionTemplates).toHaveBeenCalledOnce());
  });

  it('invalidates a one-shot preview after any rendering input changes', async () => {
    const adminApi = api();
    const { result } = renderHook(() => useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1' }));
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
    const { result } = renderHook(() => useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1' }));
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
    });
  });

  it('activates only with the fresh validation fingerprint and expires it on context changes', async () => {
    const adminApi = api();
    const { result } = renderHook(() => useInstructionTemplates({ api: adminApi, active: true, csrfToken: 'csrf_1' }));
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
    });

    await act(async () => result.current.validateDraft());
    act(() => result.current.changeRequestContext('{"project":{"name":"other"}}'));
    expect(result.current.activationValidation).toBeNull();
  });
});
