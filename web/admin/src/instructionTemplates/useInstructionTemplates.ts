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
  const loadedRef = useRef(false);
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
    async (operation: () => Promise<unknown>) => {
      if (!csrfToken) return false;
      setBusy(true);
      setError(null);
      try {
        await operation();
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
    [csrfToken, load, reportError],
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
      const saved = await runMutation(() =>
        api.saveInstructionTemplate({
          action: selectedIdentity ? 'update' : 'create',
          draft,
          expectedConfigFingerprint: configFingerprint,
          csrfToken,
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
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Request context must be a JSON object.');
          }
          parsedContext = parsed as Record<string, unknown>;
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
      await runMutation(() =>
        api.activateInstructionTemplate({
          identity: draft.identity,
          expectedConfigFingerprint: activationValidation.expectedConfigFingerprint,
          previewFingerprint: activationValidation.previewFingerprint,
          csrfToken,
        }),
      );
      setPreview(null);
      setActivationValidation(null);
    },
    async clone(identity) {
      if (!csrfToken || !selectedIdentity) return;
      await runMutation(() =>
        api.cloneInstructionTemplate({
          sourceIdentity: selectedIdentity,
          identity,
          expectedConfigFingerprint: configFingerprint,
          csrfToken,
        }),
      );
    },
    async importLegacy(identity) {
      if (!csrfToken) return;
      await runMutation(() =>
        api.importLegacyInstructionTemplate({ identity, expectedConfigFingerprint: configFingerprint, csrfToken }),
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
      const deleted = await runMutation(() =>
        api.deleteInstructionTemplate({
          identity: selectedIdentity,
          expectedConfigFingerprint: deletePreview.expectedConfigFingerprint,
          previewFingerprint: deletePreview.previewFingerprint,
          csrfToken,
        }),
      );
      if (deleted) select(undefined);
    },
  };
}

function instructionTemplateError(error: unknown, fallback: string): string {
  if (error instanceof AdminApiError) return error.failure.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
