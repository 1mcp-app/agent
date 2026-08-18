import { useCallback, useEffect, useReducer, useRef } from 'react';

import { AdminApiError, createConfiguredServerApplyIdempotencyKey } from '../api/adminApi';
import type { AdminApiClient, AdminSession, ConfiguredServerTargetIdentity } from '../api/adminApi';
import type { ConfirmationRequest } from '../components/ConfirmationDialogProvider';
import { useConfiguredServerMutationLifecycle } from '../configuredServerMutation/useConfiguredServerMutationLifecycle';
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
  open(server: string | ConfiguredServerTargetIdentity): void | Promise<void>;
  close(pathname?: string): Promise<boolean>;
  changeField(fieldPath: string[], value: unknown): void;
  changeSecret(fieldPath: string[], value: SecretDraftState[string]): void;
  changeTransportOverride(key: string, clear: boolean): void;
  changeInstructionOverride(mode: 'upstream' | 'replace' | 'suppress', value?: string): void;
  changeTool(name: string, change: { enabled?: boolean; descriptionOverride?: string }): void;
  changeVisibleTools(names: string[], enabled: boolean): void;
  changeToolModel(model: string): void | Promise<void>;
  refreshToolInventory?(): void | Promise<void>;
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
  api: Pick<
    AdminApiClient,
    | 'getConfiguredServerDetail'
    | 'refreshConfiguredToolInventory'
    | 'previewConfiguredServerEdit'
    | 'applyConfiguredServerEdit'
  >;
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
  const toolInventoryRequestRef = useRef(0);
  const toolInventoryInteractionRef = useRef(false);
  const initialToolInventoryRefreshRef = useRef<{ target: ConfiguredServerTargetIdentity; model: string }>();
  stateRef.current = state;
  sessionRef.current = session;
  apiRef.current = api;
  onUnauthenticatedRef.current = onUnauthenticated;

  const {
    loadRequestRef: detailRequestRef,
    previewRequestRef,
    applyRequestRef,
    applyInteractionRef,
    applyAttemptRef,
    invalidatePreview,
    invalidateApply,
    reset: resetMutationLifecycle,
  } = useConfiguredServerMutationLifecycle(() => dispatch({ type: 'closed' }));

  const invalidateToolInventory = useCallback(() => {
    toolInventoryRequestRef.current += 1;
    toolInventoryInteractionRef.current = false;
    initialToolInventoryRefreshRef.current = undefined;
  }, []);

  const reset = useCallback(() => {
    invalidateToolInventory();
    resetMutationLifecycle();
  }, [invalidateToolInventory, resetMutationLifecycle]);

  const handleUnauthenticated = useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminApiError) || error.failure.kind !== 'unauthenticated') return false;
      reset();
      onUnauthenticatedRef.current(error.failure.adminStatus);
      return true;
    },
    [reset],
  );

  const refreshInventory = useCallback(
    async (target: ConfiguredServerTargetIdentity, model: string) => {
      const activeSession = sessionRef.current;
      if (!activeSession || toolInventoryInteractionRef.current) return;
      toolInventoryInteractionRef.current = true;
      const sessionKey = activeSession.csrfToken;
      const requestId = toolInventoryRequestRef.current + 1;
      toolInventoryRequestRef.current = requestId;
      dispatch({ type: 'toolInventoryRequestStarted', clearPreview: false });
      try {
        const response = await apiRef.current.refreshConfiguredToolInventory({ target, csrfToken: sessionKey, model });
        if (requestId !== toolInventoryRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        const latest = stateRef.current;
        if (latest.status !== 'loaded' || !sameConfiguredServerTarget(latest, target)) return;
        if (latest.detail.toolInventory?.generation !== response.toolInventory.generation) invalidatePreview();
        dispatch({
          type: 'toolInventoryReceived',
          inventory: response.toolInventory,
          clearPreview: 'generationChanged',
        });
      } catch (error) {
        if (requestId !== toolInventoryRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          dispatch({ type: 'toolInventoryRequestFailed', message: `Tool refresh failed: ${failureMessage(error)}` });
        }
      } finally {
        if (requestId === toolInventoryRequestRef.current) toolInventoryInteractionRef.current = false;
      }
    },
    [handleUnauthenticated, invalidatePreview],
  );

  const load = useCallback(
    async (server: string | ConfiguredServerTargetIdentity) => {
      const serverId = typeof server === 'string' ? server : server.id;
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      invalidateApply();
      invalidateToolInventory();
      const sessionKey = activeSession.csrfToken;
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      invalidatePreview();
      dispatch({ type: 'detailLoadStarted', serverId });
      try {
        const detail = await apiRef.current.getConfiguredServerDetail(server);
        if (requestId !== detailRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        initialToolInventoryRefreshRef.current = {
          target: detail.server.target,
          model: detail.toolInventory?.model ?? 'gpt-4o',
        };
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
    [handleUnauthenticated, invalidateApply, invalidatePreview, invalidateToolInventory],
  );

  const open = useCallback(
    async (server: string | ConfiguredServerTargetIdentity) => {
      const current = stateRef.current;
      if (
        current.status === 'loaded' &&
        !sameConfiguredServerTarget(current, server) &&
        current.dirty &&
        !(await confirmDiscard(browser))
      ) {
        return;
      }
      browser.push(serverPath(server));
      await load(server);
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

  const changeField = useCallback(
    (fieldPath: string[], value: unknown) => {
      invalidatePreview();
      dispatch({ type: 'fieldChanged', fieldPath, value });
    },
    [invalidatePreview],
  );

  const changeSecret = useCallback(
    (fieldPath: string[], value: SecretDraftState[string]) => {
      invalidatePreview();
      dispatch({ type: 'secretChanged', fieldPath, value });
    },
    [invalidatePreview],
  );

  const changeTransportOverride = useCallback(
    (key: string, clear: boolean) => {
      invalidatePreview();
      dispatch({ type: 'transportOverrideChanged', key, clear });
    },
    [invalidatePreview],
  );

  const changeInstructionOverride = useCallback(
    (mode: 'upstream' | 'replace' | 'suppress', value?: string) => {
      invalidatePreview();
      dispatch({ type: 'instructionOverrideChanged', mode, value });
    },
    [invalidatePreview],
  );

  const changeTool = useCallback(
    (name: string, change: { enabled?: boolean; descriptionOverride?: string }) => {
      invalidatePreview();
      dispatch({ type: 'toolChanged', name, ...change });
    },
    [invalidatePreview],
  );

  const changeVisibleTools = useCallback(
    (names: string[], enabled: boolean) => {
      invalidatePreview();
      dispatch({ type: 'toolsBulkChanged', names, enabled });
    },
    [invalidatePreview],
  );

  const changeToolModel = useCallback(
    async (model: string) => {
      const current = stateRef.current;
      if (
        current.status !== 'loaded' ||
        current.applyBusy ||
        current.toolInventoryBusy ||
        toolInventoryInteractionRef.current ||
        model === current.toolModel
      ) {
        return;
      }
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      const sessionKey = activeSession.csrfToken;
      toolInventoryInteractionRef.current = true;
      const requestId = toolInventoryRequestRef.current + 1;
      toolInventoryRequestRef.current = requestId;
      invalidatePreview();
      dispatch({ type: 'toolInventoryRequestStarted', clearPreview: true });
      try {
        const detail = await apiRef.current.getConfiguredServerDetail(configuredServerTarget(current), model);
        if (
          requestId !== toolInventoryRequestRef.current ||
          sessionRef.current?.csrfToken !== sessionKey ||
          stateRef.current.status !== 'loaded' ||
          !sameConfiguredServerTarget(stateRef.current, configuredServerTarget(current))
        ) {
          return;
        }
        if (detail.toolInventory) {
          dispatch({ type: 'toolInventoryReceived', inventory: detail.toolInventory, clearPreview: 'always' });
        } else {
          dispatch({ type: 'toolInventoryRequestFailed', message: 'Token estimate failed: inventory unavailable.' });
        }
      } catch (error) {
        if (requestId !== toolInventoryRequestRef.current || sessionRef.current?.csrfToken !== sessionKey) return;
        if (!handleUnauthenticated(error)) {
          dispatch({ type: 'toolInventoryRequestFailed', message: `Token estimate failed: ${failureMessage(error)}` });
        }
      } finally {
        if (requestId === toolInventoryRequestRef.current) toolInventoryInteractionRef.current = false;
      }
    },
    [handleUnauthenticated, invalidatePreview],
  );

  const refreshToolInventory = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== 'loaded' || current.applyBusy || current.toolInventoryBusy || applyInteractionRef.current) {
      return;
    }
    return refreshInventory(configuredServerTarget(current), current.toolModel);
  }, [refreshInventory]);

  useEffect(() => {
    if (state.status !== 'loaded') return;
    const pending = initialToolInventoryRefreshRef.current;
    if (!pending || !sameConfiguredServerTarget(state, pending.target)) return;
    initialToolInventoryRefreshRef.current = undefined;
    void refreshInventory(pending.target, pending.model);
  }, [refreshInventory, state]);

  const preview = useCallback(
    async (connectivityCheck: 'auto' | 'manual' = 'auto') => {
      const activeSession = sessionRef.current;
      const current = stateRef.current;
      if (
        !activeSession ||
        current.status !== 'loaded' ||
        current.toolInventoryBusy ||
        toolInventoryInteractionRef.current
      ) {
        return;
      }
      const sessionKey = activeSession.csrfToken;
      const serverId = current.serverId;
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;
      dispatch({ type: 'previewStarted' });
      try {
        const response = await apiRef.current.previewConfiguredServerEdit({
          target: configuredServerTarget(current),
          csrfToken: sessionKey,
          connectivityCheck,
          ...(current.detail.toolInventory ? { model: current.toolModel } : {}),
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
    if (
      !activeSession ||
      current.status !== 'loaded' ||
      !current.preview ||
      current.toolInventoryBusy ||
      toolInventoryInteractionRef.current
    ) {
      return;
    }
    if (!configuredServerApplyEligibility(current).eligible) return;
    applyInteractionRef.current = true;

    try {
      const previewResult = current.preview;
      const riskFlags = Array.from(new Set(previewResult.diff.flatMap((entry) => entry.riskFlags)));
      const overridingConnectivityFailure = previewResult.connectivityCheck.status === 'failed';
      const disablingAllTools = previewResult.toolSelection?.requiresZeroEnabledConfirmation === true;
      const confirmed = await browser.confirm({
        title: disablingAllTools
          ? `Disable all observed tools for ${previewResult.proposedTargetName}?`
          : overridingConnectivityFailure
            ? `Apply despite failed connectivity to ${previewResult.proposedTargetName}?`
            : `Apply changes to ${previewResult.proposedTargetName}?`,
        message: disablingAllTools
          ? 'No currently observed tools will remain enabled. Newly discovered tools will still be enabled by default.'
          : overridingConnectivityFailure
            ? 'The bounded connectivity check failed. Applying may make this configured server unavailable.'
            : 'This writes the validated configuration and reloads the Runtime Scope.',
        confirmLabel: disablingAllTools
          ? 'Disable all tools'
          : overridingConnectivityFailure
            ? 'Apply despite failure'
            : 'Apply changes',
        tone: disablingAllTools || overridingConnectivityFailure ? 'danger' : undefined,
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
      const confirmedState = stateRef.current;
      if (
        confirmedState.status !== 'loaded' ||
        confirmedState.toolInventoryBusy ||
        toolInventoryInteractionRef.current ||
        confirmedState.preview?.previewFingerprint !== previewResult.previewFingerprint
      ) {
        return;
      }

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
          target: configuredServerTarget(current),
          csrfToken: sessionKey,
          idempotencyKey: attempt.idempotencyKey,
          edit: configuredServerEditDraft(current),
          previewFingerprint: previewResult.previewFingerprint,
          ...(current.detail.toolInventory ? { model: current.toolModel } : {}),
          confirmationFacts: {
            previewConfirmed: previewResult.previewFingerprint,
            ...(previewResult.proposedTargetName !== previewResult.targetName
              ? { targetNameConfirmed: previewResult.proposedTargetName }
              : {}),
            ...(riskFlags.includes('connection_critical') ? { connectionCriticalConfirmed: true } : {}),
            ...(riskFlags.includes('secret') ? { secretChangeConfirmed: true } : {}),
            ...(overridingConnectivityFailure ? { connectivityFailureOverrideConfirmed: true } : {}),
            ...(previewResult.toolSelection?.requiresZeroEnabledConfirmation
              ? { zeroEnabledToolsConfirmed: true }
              : {}),
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
        const detail = await apiRef.current.getConfiguredServerDetail(
          current.detail.server.source === 'mcpTemplates'
            ? { source: 'mcpTemplates', id: finalName }
            : { source: 'mcpServers', id: finalName },
        );
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
    const server = serverTargetFromPath(browser.pathname());
    if (server) void load(server);
    else reset();
  }, [browser, load, reset, session?.csrfToken]);

  useEffect(
    () =>
      browser.subscribePopState(() => {
        void (async () => {
          const current = stateRef.current;
          const requestedPath = browser.pathname();
          const nextServer = serverTargetFromPath(requestedPath);
          const changingTarget = current.status === 'loaded' && !sameConfiguredServerTarget(current, nextServer);
          if (changingTarget && current.dirty) {
            browser.replace(serverPath(current.detail.server.target));
            if (!(await confirmDiscard(browser))) return;
            browser.replace(requestedPath);
          }
          if (nextServer) void load(nextServer);
          else reset();
          onPathCommitted?.(requestedPath);
        })();
      }),
    [browser, load, onPathCommitted, reset],
  );

  return {
    state,
    open,
    close,
    changeField,
    changeSecret,
    changeTransportOverride,
    changeInstructionOverride,
    changeTool,
    changeVisibleTools,
    changeToolModel,
    refreshToolInventory,
    preview,
    apply,
  };
}

export function configuredServerApplyEligibility(state: ConfiguredServerEditState): {
  eligible: boolean;
  reason?: string;
} {
  if (state.status !== 'loaded' || !state.preview) return { eligible: false, reason: 'Preview changes first.' };
  if (state.toolInventoryBusy) return { eligible: false, reason: 'Wait for the tool inventory refresh to finish.' };
  if (!state.detail.editContract.capabilities.apply.supported) {
    return { eligible: false, reason: 'This runtime does not support applying server edits.' };
  }
  if (state.preview.validation.status !== 'valid') return { eligible: false, reason: 'Resolve validation issues.' };
  if (!state.preview.configChange.changed || state.preview.diff.length === 0) {
    return { eligible: false, reason: 'The preview contains no changes.' };
  }
  if (
    state.detail.server.source === 'mcpTemplates' &&
    state.preview.diff.some((entry) => entry.fieldPath.join('.') !== 'instructionOverride')
  ) {
    return { eligible: false, reason: 'Template targets only support instruction overrides.' };
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

function configuredServerTarget(state: Extract<ConfiguredServerEditState, { status: 'loaded' }>) {
  return { source: state.detail.server.source, id: state.serverId };
}

function sameConfiguredServerTarget(
  state: Extract<ConfiguredServerEditState, { status: 'loaded' }>,
  target: string | ConfiguredServerTargetIdentity | null,
): boolean {
  if (!target) return false;
  const source = typeof target === 'string' ? 'mcpServers' : target.source;
  const id = typeof target === 'string' ? target : target.id;
  return state.serverId === id && state.detail.server.source === source;
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

function serverPath(server: string | ConfiguredServerTargetIdentity): string {
  if (typeof server === 'string') return `/admin/servers/${encodeURIComponent(server)}`;
  if (server.source === 'mcpServers') return `/admin/servers/${encodeURIComponent(server.id)}`;
  return `/admin/servers/${server.source}/${encodeURIComponent(server.id)}`;
}

function serverTargetFromPath(pathname: string): string | ConfiguredServerTargetIdentity | null {
  const prefix = '/admin/servers/';
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length).split('#', 1)[0];
  if (!encoded) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    decoded = encoded;
  }
  if (decoded === 'new') return null;
  const [source, ...nameParts] = decoded.split('/');
  if ((source === 'mcpServers' || source === 'mcpTemplates') && nameParts.length > 0) {
    return { source, id: nameParts.join('/') };
  }
  return decoded;
}
