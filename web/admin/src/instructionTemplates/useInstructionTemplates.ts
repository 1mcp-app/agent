import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  AdminInstructionTemplateDraft,
  AdminInstructionTemplateListItem,
  AdminInstructionTemplatePreview,
  AdminInstructionTemplateStore,
  AdminInstructionTemplateValidationPreview,
  InstructionTemplateSelection,
  InstructionTemplateSurface,
} from '../api/adminApi';
import { createInstructionTemplateIdempotencyKey } from '../api/adminApi';
import type { ConfirmationRequest } from '../components/ConfirmationDialogProvider';

const EMPTY_DRAFT: AdminInstructionTemplateDraft = {
  identity: '',
  variants: { initialization: '', cli: '' },
};

export interface InstructionTemplatesModel {
  items: AdminInstructionTemplateListItem[];
  activeIdentity?: string;
  selectionExplicit: boolean;
  configFingerprint: string;
  legacyAvailable: boolean;
  renderFailures: AdminInstructionTemplateStore['renderFailures'];
  selectedIdentity?: string;
  draft: AdminInstructionTemplateDraft;
  surface: InstructionTemplateSurface;
  selection: InstructionTemplateSelection;
  requestContext: string;
  preview: AdminInstructionTemplatePreview | null;
  activationValidation: AdminInstructionTemplateValidationPreview | null;
  previewStale: boolean;
  dirty: boolean;
  busy: boolean;
  error: string | null;
  reloadWarning: string | null;
  select(identity?: string): void;
  newDraft(): void;
  changeIdentity(identity: string): void;
  changeVariant(surface: InstructionTemplateSurface, value: string): void;
  changeSurface(surface: InstructionTemplateSurface): void;
  changeSelection(selection: InstructionTemplateSelection): void;
  changeRequestContext(value: string): void;
  load(): Promise<void>;
  saveDraft(): Promise<boolean>;
  previewDraft(): Promise<void>;
  validateDraft(): Promise<void>;
  activate(): Promise<void>;
  clone(identity: string): Promise<void>;
  importLegacy(identity: string): Promise<void>;
  deleteSelected(): Promise<void>;
}

export function useInstructionTemplates({
  api,
  active,
  csrfToken,
  confirm,
  onUnauthenticated,
}: {
  api: Pick<
    AdminApiClient,
    | 'listInstructionTemplates'
    | 'saveInstructionTemplate'
    | 'previewInstructionTemplate'
    | 'validateInstructionTemplate'
    | 'activateInstructionTemplate'
    | 'cloneInstructionTemplate'
    | 'importLegacyInstructionTemplate'
    | 'previewInstructionTemplateDelete'
    | 'deleteInstructionTemplate'
  >;
  active: boolean;
  csrfToken?: string;
  confirm(request: ConfirmationRequest): Promise<boolean>;
  onUnauthenticated?(adminStatus: 'setupRequired' | 'loginRequired'): void;
}): InstructionTemplatesModel {
  const [items, setItems] = useState<AdminInstructionTemplateListItem[]>([]);
  const [activeIdentity, setActiveIdentity] = useState<string>();
  const [selectionExplicit, setSelectionExplicit] = useState(false);
  const [configFingerprint, setConfigFingerprint] = useState('');
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [renderFailures, setRenderFailures] = useState<AdminInstructionTemplateStore['renderFailures']>({});
  const [selectedIdentity, setSelectedIdentity] = useState<string>();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [surface, setSurfaceState] = useState<InstructionTemplateSurface>('initialize');
  const [selection, setSelectionState] = useState<InstructionTemplateSelection>({ mode: 'all' });
  const [requestContext, setRequestContextState] = useState('');
  const [preview, setPreview] = useState<AdminInstructionTemplatePreview | null>(null);
  const [activationValidation, setActivationValidation] = useState<AdminInstructionTemplateValidationPreview | null>(
    null,
  );
  const [previewStale, setPreviewStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadWarning, setReloadWarning] = useState<string | null>(null);
  const loadedRef = useRef(false);
  const mutationAttemptRef = useRef<{ signature: string; idempotencyKey: string }>();
  const reportError = useCallback(
    (operationError: unknown, fallback: string) => {
      if (operationError instanceof AdminApiError && operationError.failure.kind === 'unauthenticated') {
        loadedRef.current = false;
        onUnauthenticated?.(operationError.failure.adminStatus);
        return;
      }
      setError(instructionTemplateError(operationError, fallback));
    },
    [onUnauthenticated],
  );

  const selected = useMemo(() => items.find((item) => item.identity === selectedIdentity), [items, selectedIdentity]);
  const dirty = selected
    ? selected.identity !== draft.identity || JSON.stringify(selected.variants) !== JSON.stringify(draft.variants)
    : Boolean(draft.identity || draft.variants.initialization || draft.variants.cli);

  const invalidatePreview = useCallback(() => {
    mutationAttemptRef.current = undefined;
    setPreview((current) => {
      if (current) setPreviewStale(true);
      return null;
    });
    setActivationValidation(null);
  }, []);

  const load = useCallback(async () => {
    if (!csrfToken) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.listInstructionTemplates();
      setItems(next.templates);
      setActiveIdentity(next.activeIdentity);
      setSelectionExplicit(next.selectionExplicit);
      setConfigFingerprint(next.configFingerprint);
      setLegacyAvailable(next.legacyImportAvailable);
      setRenderFailures(next.renderFailures);
      loadedRef.current = true;
    } catch (loadError) {
      reportError(loadError, 'Instruction templates could not be loaded.');
    } finally {
      setBusy(false);
    }
  }, [api, csrfToken, reportError]);

  useEffect(() => {
    if (active && csrfToken && !loadedRef.current) void load();
  }, [active, csrfToken, load]);

  useEffect(() => {
    if (csrfToken) return;
    loadedRef.current = false;
    setItems([]);
    setSelectedIdentity(undefined);
    setDraft(EMPTY_DRAFT);
    setPreview(null);
    setActivationValidation(null);
  }, [csrfToken]);

  const select = useCallback(
    (identity?: string) => {
      setSelectedIdentity(identity);
      const item = items.find((candidate) => candidate.identity === identity);
      setDraft(item ? { identity: item.identity, variants: { ...item.variants } } : EMPTY_DRAFT);
      setPreview(null);
      setActivationValidation(null);
      setPreviewStale(false);
      setError(null);
    },
    [items],
  );

  const runMutation = useCallback(
    async (
      signature: string,
      operation: (idempotencyKey: string) => Promise<{ result: { reload?: { status: string; error?: string } } }>,
    ) => {
      if (!csrfToken) return false;
      const attempt =
        mutationAttemptRef.current?.signature === signature
          ? mutationAttemptRef.current
          : { signature, idempotencyKey: createInstructionTemplateIdempotencyKey(signature, draft.identity) };
      mutationAttemptRef.current = attempt;
      setBusy(true);
      setError(null);
      try {
        const response = await operation(attempt.idempotencyKey);
        setReloadWarning(
          response.result.reload?.status === 'failed'
            ? response.result.reload.error
              ? `Configuration was written, but runtime reload failed: ${response.result.reload.error}`
              : 'Configuration was written, but runtime reload failed. Inspect runtime health before continuing.'
            : null,
        );
        mutationAttemptRef.current = undefined;
        loadedRef.current = false;
        await load();
        return true;
      } catch (mutationError) {
        reportError(mutationError, 'Instruction template operation failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [csrfToken, draft.identity, load, reportError],
  );

  return {
    items,
    activeIdentity,
    selectionExplicit,
    configFingerprint,
    legacyAvailable,
    renderFailures,
    selectedIdentity,
    draft,
    surface,
    selection,
    requestContext,
    preview,
    activationValidation,
    previewStale,
    dirty,
    busy,
    error,
    reloadWarning,
    select,
    newDraft: () => select(undefined),
    changeIdentity: (identity) => {
      setDraft((current) => ({ ...current, identity }));
      invalidatePreview();
    },
    changeVariant: (variantSurface, value) => {
      const variant = variantSurface === 'initialize' ? 'initialization' : 'cli';
      setDraft((current) => ({ ...current, variants: { ...current.variants, [variant]: value } }));
      invalidatePreview();
    },
    changeSurface: (nextSurface) => {
      setSurfaceState(nextSurface);
      invalidatePreview();
    },
    changeSelection: (nextSelection) => {
      setSelectionState(nextSelection);
      invalidatePreview();
    },
    changeRequestContext: (value) => {
      setRequestContextState(value);
      invalidatePreview();
    },
    load,
    async saveDraft() {
      if (!csrfToken || !draft.identity.trim()) return false;
      const saved = await runMutation(
        `save:${selectedIdentity ? 'update' : 'create'}:${configFingerprint}:${JSON.stringify(draft)}`,
        (idempotencyKey) =>
          api.saveInstructionTemplate({
            action: selectedIdentity ? 'update' : 'create',
            draft,
            expectedConfigFingerprint: configFingerprint,
            csrfToken,
            idempotencyKey,
          }),
      );
      if (saved) setSelectedIdentity(draft.identity);
      return saved;
    },
    async previewDraft() {
      if (!csrfToken || !draft.identity) return;
      setBusy(true);
      setError(null);
      try {
        let parsedContext: Record<string, unknown> | undefined;
        if (requestContext.trim()) {
          const parsed: unknown = JSON.parse(requestContext);
          parsedContext = explicitRequestContext(parsed);
        }
        const result = await api.previewInstructionTemplate({
          identity: draft.identity,
          surface,
          selection,
          ...(parsedContext ? { requestContext: parsedContext } : {}),
          csrfToken,
        });
        setPreview(result);
        setPreviewStale(false);
      } catch (previewError) {
        reportError(previewError, 'Instruction template preview failed.');
      } finally {
        setBusy(false);
      }
    },
    async validateDraft() {
      if (!csrfToken || !selectedIdentity || dirty) return;
      setBusy(true);
      setError(null);
      try {
        const result = await api.validateInstructionTemplate({
          identity: selectedIdentity,
          expectedConfigFingerprint: configFingerprint,
          csrfToken,
        });
        setActivationValidation(result);
      } catch (validationError) {
        reportError(validationError, 'Instruction template validation failed.');
      } finally {
        setBusy(false);
      }
    },
    async activate() {
      if (!csrfToken || !activationValidation || activationValidation.identity !== draft.identity) return;
      const activated = await runMutation(
        `activate:${draft.identity}:${activationValidation.expectedConfigFingerprint}:${activationValidation.previewFingerprint}`,
        (idempotencyKey) =>
          api.activateInstructionTemplate({
            identity: draft.identity,
            expectedConfigFingerprint: activationValidation.expectedConfigFingerprint,
            previewFingerprint: activationValidation.previewFingerprint,
            csrfToken,
            idempotencyKey,
          }),
      );
      if (activated) {
        setPreview(null);
        setActivationValidation(null);
      }
    },
    async clone(identity) {
      if (!csrfToken || !selectedIdentity) return;
      await runMutation(`clone:${selectedIdentity}:${identity}:${configFingerprint}`, (idempotencyKey) =>
        api.cloneInstructionTemplate({
          sourceIdentity: selectedIdentity,
          identity,
          expectedConfigFingerprint: configFingerprint,
          csrfToken,
          idempotencyKey,
        }),
      );
    },
    async importLegacy(identity) {
      if (!csrfToken) return;
      await runMutation(`import:${identity}:${configFingerprint}`, (idempotencyKey) =>
        api.importLegacyInstructionTemplate({
          identity,
          expectedConfigFingerprint: configFingerprint,
          csrfToken,
          idempotencyKey,
        }),
      );
    },
    async deleteSelected() {
      if (!csrfToken || !selectedIdentity || selected?.protected) return;
      const deletePreview = await api.previewInstructionTemplateDelete({
        identity: selectedIdentity,
        expectedConfigFingerprint: configFingerprint,
        csrfToken,
      });
      if (!deletePreview.allowed) {
        setError(
          deletePreview.reason === 'active_conflict'
            ? 'Activate another template before deleting this one.'
            : 'This template cannot be deleted.',
        );
        return;
      }
      const confirmed = await confirm({
        title: `Delete ${deletePreview.identity}?`,
        message: 'This permanently removes the managed template from the current Runtime Scope.',
        confirmLabel: 'Delete template',
        tone: 'danger',
        details: [
          { label: 'Template', value: deletePreview.identity },
          { label: 'Reason', value: deletePreview.reason ?? 'Template is inactive and not protected' },
        ],
      });
      if (!confirmed) return;
      const deleted = await runMutation(
        `delete:${selectedIdentity}:${deletePreview.expectedConfigFingerprint}:${deletePreview.previewFingerprint}`,
        (idempotencyKey) =>
          api.deleteInstructionTemplate({
            identity: selectedIdentity,
            expectedConfigFingerprint: deletePreview.expectedConfigFingerprint,
            previewFingerprint: deletePreview.previewFingerprint,
            csrfToken,
            idempotencyKey,
          }),
      );
      if (deleted) select(undefined);
    },
  };
}

function explicitRequestContext(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request context must include project, user, and environment objects.');
  }
  const context = value as Record<string, unknown>;
  for (const field of ['project', 'user', 'environment']) {
    const entry = context[field];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Request context must include project, user, and environment objects.');
    }
  }
  return context;
}

function instructionTemplateError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.failure.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
