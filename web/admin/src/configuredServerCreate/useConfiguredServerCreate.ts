import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  type AdminApiClient,
  AdminApiError,
  type AdminSession,
  type ConfiguredServerTargetIdentity,
  createConfiguredServerCreateIdempotencyKey,
} from '../api/adminApi';
import type { ConfirmationRequest } from '../components/ConfirmationDialogProvider';
import { useConfiguredServerMutationLifecycle } from '../configuredServerMutation/useConfiguredServerMutationLifecycle';
import {
  configuredServerCreateDraft,
  type ConfiguredServerCreateSecretDraft,
  createConfiguredServerCreateState,
  reduceConfiguredServerCreateState,
} from './configuredServerCreateState';

export interface ConfiguredServerCreateBrowser {
  pathname(): string;
  push(pathname: string): void;
  replace(pathname: string): void;
  confirm(request: ConfirmationRequest): Promise<boolean>;
  subscribePopState(listener: () => void): () => void;
}

export interface ConfiguredServerCreateModel {
  state: ReturnType<typeof createConfiguredServerCreateState> | ReturnType<typeof reduceConfiguredServerCreateState>;
  open(): void | Promise<void>;
  close(destination?: string): Promise<boolean>;
  editExisting(serverId: string): void | Promise<void>;
  changeField(fieldPath: string[], value: unknown): void;
  addSecret(secret: ConfiguredServerCreateSecretDraft): void;
  changeSecret(secret: ConfiguredServerCreateSecretDraft): void;
  removeSecret(id: string): void;
  preview(connectivityCheck?: 'auto' | 'manual'): void | Promise<void>;
  apply(): void | Promise<void>;
}

export function useConfiguredServerCreate({
  api,
  session,
  browser,
  onUnauthenticated,
  onCreated,
  onOpenCreated,
  onPathCommitted,
}: {
  api: AdminApiClient;
  session: AdminSession | null;
  browser: ConfiguredServerCreateBrowser;
  onUnauthenticated(status: 'setupRequired' | 'loginRequired'): void;
  onCreated?: () => void | Promise<void>;
  onOpenCreated?: (server: string | ConfiguredServerTargetIdentity) => void | Promise<void>;
  onPathCommitted?: (path: string) => void;
}): ConfiguredServerCreateModel {
  const [state, rawDispatch] = useReducer(
    reduceConfiguredServerCreateState,
    undefined,
    createConfiguredServerCreateState,
  );
  const stateRef = useRef(state);
  const apiRef = useRef(api);
  const sessionRef = useRef(session);
  const onUnauthenticatedRef = useRef(onUnauthenticated);

  apiRef.current = api;
  sessionRef.current = session;
  onUnauthenticatedRef.current = onUnauthenticated;
  const dispatch = useCallback((action: Parameters<typeof reduceConfiguredServerCreateState>[1]) => {
    const next = reduceConfiguredServerCreateState(stateRef.current, action);
    stateRef.current = next;
    rawDispatch(action);
  }, []);
  const {
    loadRequestRef: contractRequestRef,
    previewRequestRef,
    applyRequestRef,
    applyInteractionRef,
    applyAttemptRef,
    invalidatePreview,
    reset,
  } = useConfiguredServerMutationLifecycle(() => dispatch({ type: 'closed' }));

  const handleUnauthenticated = useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminApiError) || error.failure.kind !== 'unauthenticated') return false;
      reset();
      onUnauthenticatedRef.current(error.failure.adminStatus);
      return true;
    },
    [reset],
  );

  const load = useCallback(async () => {
    const activeSession = sessionRef.current;
    if (!activeSession) return;
    const requestId = contractRequestRef.current + 1;
    contractRequestRef.current = requestId;
    const sessionKey = activeSession.csrfToken;
    dispatch({ type: 'contractLoadStarted' });
    try {
      const contract = await apiRef.current.getConfiguredServerCreateContract();
      if (requestId !== contractRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
      dispatch({ type: 'contractLoaded', contract });
    } catch (error) {
      if (requestId !== contractRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
      if (!handleUnauthenticated(error)) dispatch({ type: 'contractFailed', message: failureMessage(error) });
    }
  }, [dispatch, handleUnauthenticated]);

  const open = useCallback(async () => {
    const current = stateRef.current;
    if (current.status === 'editing' && current.dirty && !(await confirmDiscard(browser))) return;
    reset();
    browser.push('/admin/servers/new');
    onPathCommitted?.('/admin/servers/new');
    await load();
  }, [browser, load, onPathCommitted, reset]);

  const close = useCallback(
    async (destination = '/admin/servers') => {
      const current = stateRef.current;
      if (current.status === 'editing' && current.dirty && !(await confirmDiscard(browser))) return false;
      reset();
      browser.push(destination);
      onPathCommitted?.(destination);
      return true;
    },
    [browser, onPathCommitted, reset],
  );

  const editExisting = useCallback(
    async (serverId: string) => {
      if (!(await close('/admin/servers'))) return;
      await onOpenCreated?.({ source: 'mcpServers', id: serverId });
    },
    [close, onOpenCreated],
  );

  const changeField = useCallback(
    (fieldPath: string[], value: unknown) => {
      invalidatePreview();
      dispatch({ type: 'fieldChanged', fieldPath, value });
    },
    [dispatch, invalidatePreview],
  );
  const addSecret = useCallback(
    (secret: ConfiguredServerCreateSecretDraft) => {
      invalidatePreview();
      dispatch({ type: 'secretAdded', secret });
    },
    [dispatch, invalidatePreview],
  );
  const changeSecret = useCallback(
    (secret: ConfiguredServerCreateSecretDraft) => {
      invalidatePreview();
      dispatch({ type: 'secretChanged', secret });
    },
    [dispatch, invalidatePreview],
  );
  const removeSecret = useCallback(
    (id: string) => {
      invalidatePreview();
      dispatch({ type: 'secretRemoved', id });
    },
    [dispatch, invalidatePreview],
  );

  const preview = useCallback(
    async (connectivityCheck: 'auto' | 'manual' = 'auto') => {
      const activeSession = sessionRef.current;
      const current = stateRef.current;
      const draft = configuredServerCreateDraft(current);
      if (!activeSession || current.status !== 'editing' || !draft) return;
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      const sessionKey = activeSession.csrfToken;
      dispatch({ type: 'previewStarted' });
      try {
        const response = await apiRef.current.previewConfiguredServerCreate({
          draft,
          csrfToken: sessionKey,
          connectivityCheck,
        });
        if (requestId !== previewRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (applyAttemptRef.current?.previewFingerprint !== response.preview.previewFingerprint) {
          applyAttemptRef.current = undefined;
        }
        dispatch({ type: 'previewSucceeded', preview: response.preview });
      } catch (error) {
        if (requestId !== previewRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error))
          dispatch({ type: 'previewFailed', message: `Preview failed: ${failureMessage(error)}` });
      }
    },
    [dispatch, handleUnauthenticated],
  );

  const apply = useCallback(async () => {
    if (applyInteractionRef.current) return;
    const activeSession = sessionRef.current;
    const current = stateRef.current;
    const draft = configuredServerCreateDraft(current);
    if (!activeSession || current.status !== 'editing' || !current.preview || !draft) return;
    const eligibility = configuredServerCreateApplyEligibility(current);
    if (!eligibility.eligible) return;
    applyInteractionRef.current = true;
    try {
      const previewResult = current.preview;
      const connectivityFailed = previewResult.connectivityCheck.status === 'failed';
      const templateDefinition = draft.source === 'mcpTemplates';
      const confirmed = await browser.confirm({
        title: connectivityFailed
          ? `Create ${draft.name} despite failed connectivity?`
          : templateDefinition
            ? `Create Template definition ${draft.name}?`
            : `Create configured server ${draft.name}?`,
        message: connectivityFailed
          ? 'The bounded connectivity check failed. Creating this target may leave it unavailable.'
          : templateDefinition
            ? 'This writes a Template Server definition and reloads the Runtime Scope. No runtime instance is created.'
            : 'This writes a new static target and reloads the Runtime Scope.',
        confirmLabel: connectivityFailed
          ? 'Create despite failure'
          : templateDefinition
            ? 'Create template'
            : 'Create server',
        tone: connectivityFailed ? 'danger' : undefined,
        details: [
          { label: 'Target', value: draft.name },
          { label: 'Transport', value: draft.transport.type },
          { label: 'Connectivity', value: previewResult.connectivityCheck.status },
          { label: 'Existing target', value: 'Must remain absent' },
        ],
      });
      if (!confirmed) return;
      const attempt =
        applyAttemptRef.current?.previewFingerprint === previewResult.previewFingerprint
          ? applyAttemptRef.current
          : {
              previewFingerprint: previewResult.previewFingerprint,
              idempotencyKey: createConfiguredServerCreateIdempotencyKey(draft.name),
            };
      applyAttemptRef.current = attempt;
      const requestId = applyRequestRef.current + 1;
      applyRequestRef.current = requestId;
      const sessionKey = activeSession.csrfToken;
      dispatch({ type: 'applyStarted' });
      try {
        const response = await apiRef.current.createConfiguredServer({
          draft,
          csrfToken: sessionKey,
          idempotencyKey: attempt.idempotencyKey,
          previewFingerprint: previewResult.previewFingerprint,
          confirmationFacts: {
            previewConfirmed: previewResult.previewFingerprint,
            targetNameConfirmed: draft.name,
            connectionCriticalConfirmed: true,
            ...(previewResult.diff.some((entry) => entry.riskFlags.includes('secret'))
              ? { secretChangeConfirmed: true }
              : {}),
            ...(connectivityFailed ? { connectivityFailureOverrideConfirmed: true } : {}),
          },
        });
        if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        applyAttemptRef.current = undefined;
        dispatch({ type: 'applySucceeded', response });
        await onCreated?.();
        await onOpenCreated?.({
          source:
            response.result.targetSource === 'mcpTemplates' ||
            response.result.configChange.target.source === 'mcpTemplates'
              ? 'mcpTemplates'
              : 'mcpServers',
          id: response.result.targetName,
        });
        if (response.result.configChange.reload.status !== 'failed') {
          dispatch({ type: 'closed' });
        }
      } catch (error) {
        if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          const stale = isStalePreview(error);
          if (stale) applyAttemptRef.current = undefined;
          dispatch({ type: 'applyFailed', message: `Create failed: ${failureMessage(error)}`, clearPreview: stale });
        }
      }
    } finally {
      applyInteractionRef.current = false;
    }
  }, [browser, dispatch, handleUnauthenticated, onCreated, onOpenCreated]);

  useEffect(() => {
    if (!session) {
      reset();
      return;
    }
    if (browser.pathname() === '/admin/servers/new') void load();
  }, [browser, load, reset, session?.csrfToken]);

  useEffect(
    () =>
      browser.subscribePopState(() => {
        void (async () => {
          const requestedPath = browser.pathname();
          const current = stateRef.current;
          if (current.status === 'editing' && current.dirty) {
            browser.replace('/admin/servers/new');
            if (!(await confirmDiscard(browser))) {
              onPathCommitted?.('/admin/servers/new');
              return;
            }
            browser.replace(requestedPath);
          }
          reset();
          onPathCommitted?.(requestedPath);
        })();
      }),
    [browser, onPathCommitted, reset],
  );

  return { state, open, close, editExisting, changeField, addSecret, changeSecret, removeSecret, preview, apply };
}

export function configuredServerCreateApplyEligibility(state: ReturnType<typeof reduceConfiguredServerCreateState>): {
  eligible: boolean;
  reason?: string;
} {
  if (state.status !== 'editing' || !state.preview) return { eligible: false, reason: 'Preview this server first.' };
  if (!state.contract.createContract.capabilities.apply.supported)
    return { eligible: false, reason: 'Creation is unavailable.' };
  if (state.preview.validation.status !== 'valid') return { eligible: false, reason: 'Resolve validation issues.' };
  if (!state.preview.configChange.changed || state.preview.diff.length === 0)
    return { eligible: false, reason: 'The preview contains no changes.' };
  const draft = configuredServerCreateDraft(state);
  if (!draft) return { eligible: false, reason: 'Complete the server configuration.' };
  const connectionCritical = state.preview.diff.some((entry) => entry.riskFlags.includes('connection_critical'));
  if (
    draft.enabled &&
    draft.transport.type !== 'stdio' &&
    connectionCritical &&
    state.preview.connectivityCheck.status !== 'passed' &&
    state.preview.connectivityCheck.status !== 'failed' &&
    !(
      state.preview.connectivityCheck.status === 'skipped' &&
      state.preview.connectivityCheck.reason === 'checker_unavailable'
    )
  )
    return { eligible: false, reason: 'A connectivity check must run before creation.' };
  return { eligible: true };
}

function confirmDiscard(browser: ConfiguredServerCreateBrowser): Promise<boolean> {
  return browser.confirm({
    title: 'Discard custom server?',
    message: 'The configured-server draft, preview, and secret replacements will be lost.',
    confirmLabel: 'Discard draft',
    tone: 'danger',
  });
}

function isStalePreview(error: unknown): boolean {
  return (
    error instanceof AdminApiError &&
    error.failure.kind === 'rejected' &&
    error.failure.code === 'configured_server_stale_preview'
  );
}

function failureMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.failure.message;
  throw error;
}
