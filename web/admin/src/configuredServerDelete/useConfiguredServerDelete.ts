import { useCallback, useReducer, useRef } from 'react';

import {
  type AdminApiClient,
  AdminApiError,
  type AdminSession,
  type ConfiguredServerDeleteResponse,
  type ConfiguredServerTargetIdentity,
  createConfiguredServerDeleteIdempotencyKey,
} from '../api/adminApi';
import {
  type ConfiguredServerDeleteState,
  createConfiguredServerDeleteState,
  reduceConfiguredServerDeleteState,
} from './configuredServerDeleteState';

export interface ConfiguredServerDeleteModel {
  state: ConfiguredServerDeleteState;
  preview(target: ConfiguredServerTargetIdentity): void | Promise<void>;
  changeConfirmation(value: string): void;
  apply(target: ConfiguredServerTargetIdentity): void | Promise<void>;
  reset(): void;
}

export function useConfiguredServerDelete({
  api,
  session,
  onUnauthenticated,
  onDeleted,
}: {
  api: Pick<AdminApiClient, 'previewConfiguredServerDelete' | 'deleteConfiguredServer'>;
  session: AdminSession | null;
  onUnauthenticated(adminStatus: 'setupRequired' | 'loginRequired'): void;
  onDeleted(
    target: ConfiguredServerTargetIdentity,
    result: ConfiguredServerDeleteResponse['result'],
  ): void | Promise<void>;
}): ConfiguredServerDeleteModel {
  const [state, dispatch] = useReducer(reduceConfiguredServerDeleteState, undefined, createConfiguredServerDeleteState);
  const stateRef = useRef(state);
  const requestRef = useRef(0);
  const applyAttemptRef = useRef<{ previewFingerprint: string; idempotencyKey: string }>();
  stateRef.current = state;

  const reset = useCallback(() => {
    requestRef.current += 1;
    applyAttemptRef.current = undefined;
    dispatch({ type: 'reset' });
  }, []);

  const handleError = useCallback(
    (error: unknown, prefix: string, clearPreview = false) => {
      if (error instanceof AdminApiError && error.failure.kind === 'unauthenticated') {
        reset();
        onUnauthenticated(error.failure.adminStatus);
        return;
      }
      const message = error instanceof AdminApiError ? error.failure.message : String(error);
      dispatch({ type: 'applyFailed', message: `${prefix}: ${message}`, clearPreview });
    },
    [onUnauthenticated, reset],
  );

  const preview = useCallback(
    async (target: ConfiguredServerTargetIdentity) => {
      if (!session || stateRef.current.previewBusy || stateRef.current.applyBusy) return;
      const requestId = ++requestRef.current;
      dispatch({ type: 'previewStarted' });
      try {
        const response = await api.previewConfiguredServerDelete({ target, csrfToken: session.csrfToken });
        if (requestId !== requestRef.current) return;
        applyAttemptRef.current = undefined;
        dispatch({ type: 'previewSucceeded', preview: response.preview });
      } catch (error) {
        if (requestId !== requestRef.current) return;
        if (error instanceof AdminApiError && error.failure.kind === 'unauthenticated') {
          reset();
          onUnauthenticated(error.failure.adminStatus);
          return;
        }
        dispatch({
          type: 'previewFailed',
          message: `Delete preview failed: ${error instanceof AdminApiError ? error.failure.message : String(error)}`,
        });
      }
    },
    [api, onUnauthenticated, reset, session],
  );

  const changeConfirmation = useCallback((value: string) => {
    dispatch({ type: 'confirmationChanged', value });
  }, []);

  const apply = useCallback(
    async (target: ConfiguredServerTargetIdentity) => {
      const current = stateRef.current;
      if (!session || !current.preview || current.applyBusy || current.confirmation !== current.preview.qualifiedId)
        return;
      const attempt =
        applyAttemptRef.current?.previewFingerprint === current.preview.previewFingerprint
          ? applyAttemptRef.current
          : {
              previewFingerprint: current.preview.previewFingerprint,
              idempotencyKey: createConfiguredServerDeleteIdempotencyKey(current.preview.qualifiedId),
            };
      applyAttemptRef.current = attempt;
      dispatch({ type: 'applyStarted' });
      try {
        const response = await api.deleteConfiguredServer({
          target,
          csrfToken: session.csrfToken,
          idempotencyKey: attempt.idempotencyKey,
          previewFingerprint: current.preview.previewFingerprint,
          confirmedIdentity: current.confirmation,
        });
        applyAttemptRef.current = undefined;
        dispatch({ type: 'applySucceeded', result: response.result });
        await onDeleted(target, response.result);
      } catch (error) {
        const stale =
          error instanceof AdminApiError &&
          error.failure.kind === 'rejected' &&
          [
            'configured_server_stale_preview',
            'configured_server_already_removed',
            'configured_server_source_changed',
          ].includes(error.failure.code);
        if (stale) applyAttemptRef.current = undefined;
        handleError(error, 'Delete failed', stale);
      }
    },
    [api, handleError, onDeleted, reset, session],
  );

  return { state, preview, changeConfirmation, apply, reset };
}
