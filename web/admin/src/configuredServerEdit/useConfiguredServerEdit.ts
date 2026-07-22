import { useCallback, useEffect, useReducer, useRef } from 'react';

import { AdminApiError, createConfiguredServerApplyIdempotencyKey } from '../api/adminApi';
import type { AdminApiClient, AdminSession } from '../api/adminApi';
import type { ConfirmationRequest } from '../components/ConfirmationDialogProvider';
import { type SecretDraftState, selectedTransportType } from './configuredServerEditDraft';
import {
  configuredServerEditDraft,
  type ConfiguredServerEditState,
  createConfiguredServerEditState,
  reduceConfiguredServerEditState,
} from './configuredServerEditState';

export interface ConfiguredServerEditBrowser {
  pathname(): string;
  push(pathname: string): void;
  replace(pathname: string): void;
  confirm(request: ConfirmationRequest): Promise<boolean>;
  subscribePopState(listener: () => void): () => void;
}

export interface ConfiguredServerEditModel {
  state: ConfiguredServerEditState;
  open(serverId: string): void | Promise<void>;
  close(pathname?: string): Promise<boolean>;
  changeField(fieldPath: string[], value: unknown): void;
  changeSecret(fieldPath: string[], value: SecretDraftState[string]): void;
  changeTransportOverride(key: string, clear: boolean): void;
  preview(connectivityCheck?: 'auto' | 'manual'): void | Promise<void>;
  apply(): void | Promise<void>;
}

export function useConfiguredServerEdit({
  api,
  session,
  browser,
  onUnauthenticated,
  onApplied,
  onPathCommitted,
}: {
  api: Pick<AdminApiClient, 'getConfiguredServerDetail' | 'previewConfiguredServerEdit' | 'applyConfiguredServerEdit'>;
  session: AdminSession | null;
  browser: ConfiguredServerEditBrowser;
  onUnauthenticated(adminStatus: 'setupRequired' | 'loginRequired'): void;
  onApplied?(): void | Promise<void>;
  onPathCommitted?(path: string): void;
}): ConfiguredServerEditModel {
  const [state, dispatch] = useReducer(reduceConfiguredServerEditState, undefined, createConfiguredServerEditState);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const apiRef = useRef(api);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const detailRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const applyRequestRef = useRef(0);
  const applyInteractionRef = useRef(false);
  const applyAttemptRef = useRef<{ previewFingerprint: string; idempotencyKey: string }>();
  stateRef.current = state;
  sessionRef.current = session;
  apiRef.current = api;
  onUnauthenticatedRef.current = onUnauthenticated;

  const reset = useCallback(() => {
    detailRequestRef.current += 1;
    previewRequestRef.current += 1;
    applyRequestRef.current += 1;
    applyInteractionRef.current = false;
    applyAttemptRef.current = undefined;
    dispatch({ type: 'closed' });
  }, []);

  const handleUnauthenticated = useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminApiError) || error.failure.kind !== 'unauthenticated') return false;
      reset();
      onUnauthenticatedRef.current(error.failure.adminStatus);
      return true;
    },
    [reset],
  );

  const load = useCallback(
    async (serverId: string) => {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      applyRequestRef.current += 1;
      applyAttemptRef.current = undefined;
      const sessionKey = activeSession.csrfToken;
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      previewRequestRef.current += 1;
      dispatch({ type: 'detailLoadStarted', serverId });
      try {
        const detail = await apiRef.current.getConfiguredServerDetail(serverId);
        if (requestId !== detailRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        dispatch({ type: 'detailLoaded', serverId, detail });
      } catch (error) {
        if (requestId !== detailRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (handleUnauthenticated(error)) return;
        if (error instanceof AdminApiError && error.failure.kind === 'configuredServerNotFound') {
          dispatch({ type: 'detailMissing', serverId });
          return;
        }
        dispatch({ type: 'detailFailed', serverId, message: `Server detail failed: ${failureMessage(error)}` });
      }
    },
    [handleUnauthenticated],
  );

  const open = useCallback(
    async (serverId: string) => {
      const current = stateRef.current;
      if (
        current.status === 'loaded' &&
        current.serverId !== serverId &&
        current.dirty &&
        !(await confirmDiscard(browser))
      ) {
        return;
      }
      browser.push(serverPath(serverId));
      await load(serverId);
    },
    [browser, load],
  );

  const close = useCallback(
    async (pathname = '/admin') => {
      const current = stateRef.current;
      if (current.status === 'loaded' && current.dirty && !(await confirmDiscard(browser))) {
        return false;
      }
      browser.push(pathname);
      reset();
      return true;
    },
    [browser, reset],
  );

  const changeField = useCallback((fieldPath: string[], value: unknown) => {
    previewRequestRef.current += 1;
    applyAttemptRef.current = undefined;
    dispatch({ type: 'fieldChanged', fieldPath, value });
  }, []);

  const changeSecret = useCallback((fieldPath: string[], value: SecretDraftState[string]) => {
    previewRequestRef.current += 1;
    applyAttemptRef.current = undefined;
    dispatch({ type: 'secretChanged', fieldPath, value });
  }, []);

  const changeTransportOverride = useCallback((key: string, clear: boolean) => {
    previewRequestRef.current += 1;
    applyAttemptRef.current = undefined;
    dispatch({ type: 'transportOverrideChanged', key, clear });
  }, []);

  const preview = useCallback(
    async (connectivityCheck: 'auto' | 'manual' = 'auto') => {
      const activeSession = sessionRef.current;
      const current = stateRef.current;
      if (!activeSession || current.status !== 'loaded') return;
      const sessionKey = activeSession.csrfToken;
      const serverId = current.serverId;
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      dispatch({ type: 'previewStarted' });
      try {
        const response = await apiRef.current.previewConfiguredServerEdit({
          name: serverId,
          csrfToken: sessionKey,
          connectivityCheck,
          edit: configuredServerEditDraft(current),
        });
        if (requestId !== previewRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        const latest = stateRef.current;
        if (latest.status !== 'loaded' || latest.serverId !== serverId) return;
        if (applyAttemptRef.current?.previewFingerprint !== response.preview.previewFingerprint) {
          applyAttemptRef.current = undefined;
        }
        dispatch({ type: 'previewSucceeded', preview: response.preview });
      } catch (error) {
        if (requestId !== previewRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          dispatch({ type: 'previewFailed', message: `Preview failed: ${failureMessage(error)}` });
        }
      }
    },
    [handleUnauthenticated],
  );

  const apply = useCallback(async () => {
    if (applyInteractionRef.current) return;
    const activeSession = sessionRef.current;
    const current = stateRef.current;
    if (!activeSession || current.status !== 'loaded' || !current.preview) return;
    if (!configuredServerApplyEligibility(current).eligible) return;
    applyInteractionRef.current = true;

    try {
      const previewResult = current.preview;
      const riskFlags = Array.from(new Set(previewResult.diff.flatMap((entry) => entry.riskFlags)));
      const overridingConnectivityFailure = previewResult.connectivityCheck.status === 'failed';
      const confirmed = await browser.confirm({
        title: overridingConnectivityFailure
          ? `Apply despite failed connectivity to ${previewResult.proposedTargetName}?`
          : `Apply changes to ${previewResult.proposedTargetName}?`,
        message: overridingConnectivityFailure
          ? 'The bounded connectivity check failed. Applying may make this configured server unavailable.'
          : 'This writes the validated configuration and reloads the Runtime Scope.',
        confirmLabel: overridingConnectivityFailure ? 'Apply despite failure' : 'Apply changes',
        tone: overridingConnectivityFailure ? 'danger' : undefined,
        details: [
          { label: 'Current target', value: previewResult.targetName },
          { label: 'Final target', value: previewResult.proposedTargetName },
          { label: 'Changes', value: String(previewResult.diff.length) },
          { label: 'Risk flags', value: riskFlags.join(', ') || 'none' },
          { label: 'Connectivity', value: previewResult.connectivityCheck.status },
          { label: 'Backup', value: 'Created before the config write' },
        ],
      });
      if (!confirmed) return;

      const sessionKey = activeSession.csrfToken;
      const serverId = current.serverId;
      const requestId = applyRequestRef.current + 1;
      applyRequestRef.current = requestId;
      const attempt =
        applyAttemptRef.current?.previewFingerprint === previewResult.previewFingerprint
          ? applyAttemptRef.current
          : {
              previewFingerprint: previewResult.previewFingerprint,
              idempotencyKey: createConfiguredServerApplyIdempotencyKey(serverId),
            };
      applyAttemptRef.current = attempt;
      dispatch({ type: 'applyStarted' });
      let response: Awaited<ReturnType<AdminApiClient['applyConfiguredServerEdit']>>;
      try {
        response = await apiRef.current.applyConfiguredServerEdit({
          name: serverId,
          csrfToken: sessionKey,
          idempotencyKey: attempt.idempotencyKey,
          edit: configuredServerEditDraft(current),
          previewFingerprint: previewResult.previewFingerprint,
          confirmationFacts: {
            previewConfirmed: previewResult.previewFingerprint,
            ...(previewResult.proposedTargetName !== previewResult.targetName
              ? { targetNameConfirmed: previewResult.proposedTargetName }
              : {}),
            ...(riskFlags.includes('connection_critical') ? { connectionCriticalConfirmed: true } : {}),
            ...(riskFlags.includes('secret') ? { secretChangeConfirmed: true } : {}),
            ...(overridingConnectivityFailure ? { connectivityFailureOverrideConfirmed: true } : {}),
          },
        });
      } catch (error) {
        if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          const stalePreview = isStalePreviewFailure(error);
          if (stalePreview) applyAttemptRef.current = undefined;
          dispatch({
            type: 'applyFailed',
            message: `Apply failed: ${failureMessage(error)}`,
            clearPreview: stalePreview,
          });
        }
        return;
      }

      if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
      applyAttemptRef.current = undefined;
      const finalName = response.result.targetName;
      if (finalName !== serverId) browser.replace(serverPath(finalName));
      dispatch({ type: 'applyCommitted', serverId: finalName, result: response.result });
      try {
        await onApplied?.();
      } catch {
        // The session refresh owns and displays its own failure state.
      }

      try {
        const detail = await apiRef.current.getConfiguredServerDetail(finalName);
        if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        dispatch({ type: 'applySucceeded', serverId: finalName, detail, result: response.result });
      } catch (error) {
        if (requestId !== applyRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          dispatch({
            type: 'applyRefreshFailed',
            message: `Changes were applied, but server detail could not be refreshed: ${failureMessage(error)}`,
          });
        }
      }
    } finally {
      applyInteractionRef.current = false;
    }
  }, [browser, handleUnauthenticated, onApplied]);

  useEffect(() => {
    if (!session) {
      reset();
      return;
    }
    const serverId = serverIdFromPath(browser.pathname());
    if (serverId) void load(serverId);
    else reset();
  }, [browser, load, reset, session?.csrfToken]);

  useEffect(
    () =>
      browser.subscribePopState(() => {
        void (async () => {
          const current = stateRef.current;
          const requestedPath = browser.pathname();
          const nextServerId = serverIdFromPath(requestedPath);
          const changingTarget = current.status === 'loaded' && nextServerId !== current.serverId;
          if (changingTarget && current.dirty) {
            browser.replace(serverPath(current.serverId));
            if (!(await confirmDiscard(browser))) return;
            browser.replace(requestedPath);
          }
          if (nextServerId) void load(nextServerId);
          else reset();
          onPathCommitted?.(requestedPath);
        })();
      }),
    [browser, load, onPathCommitted, reset],
  );

  return { state, open, close, changeField, changeSecret, changeTransportOverride, preview, apply };
}

export function configuredServerApplyEligibility(state: ConfiguredServerEditState): {
  eligible: boolean;
  reason?: string;
} {
  if (state.status !== 'loaded' || !state.preview) return { eligible: false, reason: 'Preview changes first.' };
  if (!state.detail.editContract.capabilities.apply.supported) {
    return { eligible: false, reason: 'This runtime does not support applying server edits.' };
  }
  if (state.preview.validation.status !== 'valid') return { eligible: false, reason: 'Resolve validation issues.' };
  if (!state.preview.configChange.changed || state.preview.diff.length === 0) {
    return { eligible: false, reason: 'The preview contains no changes.' };
  }
  const connectionCritical = state.preview.diff.some((entry) => entry.riskFlags.includes('connection_critical'));
  const transportType = selectedTransportType(state.fieldDraft, state.detail.server.transport.type);
  const proposedEnabled = configuredServerEditDraft(state).enabled ?? state.detail.server.enabled;
  if (
    proposedEnabled &&
    transportType !== 'stdio' &&
    connectionCritical &&
    state.preview.connectivityCheck.status !== 'passed' &&
    state.preview.connectivityCheck.status !== 'failed'
  ) {
    return { eligible: false, reason: 'A connectivity check must run before applying these changes.' };
  }
  return { eligible: true };
}

function isStalePreviewFailure(error: unknown): boolean {
  return (
    error instanceof AdminApiError &&
    error.failure.kind === 'rejected' &&
    error.failure.code === 'configured_server_stale_preview'
  );
}

function confirmDiscard(browser: ConfiguredServerEditBrowser): Promise<boolean> {
  return browser.confirm({
    title: 'Discard unsaved changes?',
    message: 'Your configured-server draft and preview will be lost.',
    confirmLabel: 'Discard changes',
    tone: 'danger',
  });
}

function failureMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.failure.message;
  throw error;
}

function serverPath(serverId: string): string {
  return `/admin/servers/${encodeURIComponent(serverId)}`;
}

function serverIdFromPath(pathname: string): string | null {
  const prefix = '/admin/servers/';
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length).split('#', 1)[0];
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
