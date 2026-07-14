import { useCallback, useEffect, useReducer, useRef } from 'react';

import { AdminApiError } from '../api/adminApi';
import type { AdminApiClient, AdminSession } from '../api/adminApi';
import type { SecretDraftState } from './configuredServerEditDraft';
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
  confirm(message: string): boolean;
  subscribePopState(listener: () => void): () => void;
}

export interface ConfiguredServerEditModel {
  state: ConfiguredServerEditState;
  open(serverId: string): void | Promise<void>;
  close(pathname?: string): boolean;
  changeField(fieldPath: string[], value: unknown): void;
  changeSecret(fieldPath: string[], value: SecretDraftState[string]): void;
  preview(connectivityCheck?: 'auto' | 'manual'): void | Promise<void>;
}

export function useConfiguredServerEdit({
  api,
  session,
  browser,
  onUnauthenticated,
}: {
  api: Pick<AdminApiClient, 'getConfiguredServerDetail' | 'previewConfiguredServerEdit'>;
  session: AdminSession | null;
  browser: ConfiguredServerEditBrowser;
  onUnauthenticated(adminStatus: 'setupRequired' | 'loginRequired'): void;
}): ConfiguredServerEditModel {
  const [state, dispatch] = useReducer(reduceConfiguredServerEditState, undefined, createConfiguredServerEditState);
  const stateRef = useRef(state);
  const sessionRef = useRef(session);
  const apiRef = useRef(api);
  const onUnauthenticatedRef = useRef(onUnauthenticated);
  const detailRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  stateRef.current = state;
  sessionRef.current = session;
  apiRef.current = api;
  onUnauthenticatedRef.current = onUnauthenticated;

  const reset = useCallback(() => {
    detailRequestRef.current += 1;
    previewRequestRef.current += 1;
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
        !browser.confirm('Discard unsaved configured-server edits?')
      ) {
        return;
      }
      browser.push(serverPath(serverId));
      await load(serverId);
    },
    [browser, load],
  );

  const close = useCallback(
    (pathname = '/admin') => {
      const current = stateRef.current;
      if (
        current.status === 'loaded' &&
        current.dirty &&
        !browser.confirm('Discard unsaved configured-server edits?')
      ) {
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
    dispatch({ type: 'fieldChanged', fieldPath, value });
  }, []);

  const changeSecret = useCallback((fieldPath: string[], value: SecretDraftState[string]) => {
    previewRequestRef.current += 1;
    dispatch({ type: 'secretChanged', fieldPath, value });
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
        const current = stateRef.current;
        const nextServerId = serverIdFromPath(browser.pathname());
        const changingTarget = current.status === 'loaded' && nextServerId !== current.serverId;
        if (changingTarget && current.dirty && !browser.confirm('Discard unsaved configured-server edits?')) {
          browser.replace(serverPath(current.serverId));
          return;
        }
        if (nextServerId) void load(nextServerId);
        else reset();
      }),
    [browser, load, reset],
  );

  return { state, open, close, changeField, changeSecret, preview };
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
  const encoded = pathname.slice(prefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
