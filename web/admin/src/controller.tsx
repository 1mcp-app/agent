import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminApiError } from './api/adminApi';
import type { AdminApiClient, AdminSession } from './api/adminApi';
import { AdminConsoleApp } from './components/AdminConsoleApp';
import { type AdminConsoleAction, createInitialState, reduceAdminConsoleState } from './state/adminConsoleState';
import { pollingDelayForVisibility, shouldPollConsole } from './state/polling';

interface AdminConsoleDocument {
  visibilityState: string;
  addEventListener?: Document['addEventListener'];
  removeEventListener?: Document['removeEventListener'];
}

interface AdminConsoleWindow {
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout'];
}

export interface AdminConsoleRootProps {
  api: AdminApiClient;
  documentRef?: AdminConsoleDocument;
  windowRef?: AdminConsoleWindow;
  nowLabel?: () => string;
}

export function AdminConsoleRoot({ api, documentRef = document, windowRef = window, nowLabel }: AdminConsoleRootProps) {
  const controller = useAdminConsoleController({ api, documentRef, windowRef, nowLabel });

  return (
    <AdminConsoleApp
      state={controller.state}
      onLogin={controller.login}
      onLogout={controller.logout}
      onRefresh={() => controller.refreshConsole('Manual refresh failed: ')}
      onServerAction={controller.mutateServer}
      onCopyText={controller.copyText}
      loginBusy={controller.loginBusy}
    />
  );
}

function useAdminConsoleController({
  api,
  documentRef,
  windowRef,
  nowLabel,
}: Required<Omit<AdminConsoleRootProps, 'nowLabel'>> & Pick<AdminConsoleRootProps, 'nowLabel'>) {
  const [state, setState] = useState(createInitialState);
  const [loginBusy, setLoginBusy] = useState(false);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<Window['setTimeout']> | null>(null);
  const formatNow = useCallback(() => nowLabel?.() ?? new Date().toLocaleTimeString(), [nowLabel]);

  const dispatch = useCallback((action: AdminConsoleAction) => {
    setState((current) => {
      const next = reduceAdminConsoleState(current, action);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const clearPoll = useCallback(() => {
    if (timerRef.current !== null) {
      windowRef.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [windowRef]);

  const handleUnauthenticated = useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminApiError) || error.status !== 401) {
        return false;
      }

      clearPoll();
      dispatch({ type: 'sessionUnauthenticated', adminStatus: readAdminStatus(error.body) });
      return true;
    },
    [clearPoll, dispatch],
  );

  const isCurrentSession = useCallback((sessionKey: string) => stateRef.current.session?.csrfToken === sessionKey, []);

  const refreshConsole = useCallback(
    async (errorPrefix: string, sessionOverride?: AdminSession) => {
      const activeSession = sessionOverride ?? stateRef.current.session;
      if (!activeSession) {
        return;
      }
      const sessionKey = activeSession.csrfToken;

      try {
        const [status, configuredServers] = await Promise.all([api.getStatus(), api.listConfiguredServers()]);
        if (!isCurrentSession(sessionKey)) {
          return;
        }
        dispatch({
          type: 'refreshSucceeded',
          status,
          configuredServers,
          updatedAt: formatNow(),
        });
      } catch (error) {
        if (!isCurrentSession(sessionKey)) {
          return;
        }
        if (!handleUnauthenticated(error)) {
          dispatch({ type: 'refreshFailed', message: `${errorPrefix}${errorMessage(error)}` });
        }
      }
    },
    [api, dispatch, formatNow, handleUnauthenticated, isCurrentSession],
  );

  const schedulePoll = useCallback(() => {
    clearPoll();
    if (!shouldPollConsole(stateRef.current)) {
      return;
    }

    timerRef.current = windowRef.setTimeout(() => {
      void refreshConsole('').finally(schedulePoll);
    }, pollingDelayForVisibility(documentRef.visibilityState));
  }, [clearPoll, documentRef, refreshConsole, windowRef]);

  const loadSession = useCallback(async () => {
    try {
      const session = await api.getSession();
      dispatch({ type: 'sessionLoaded', session });
      await refreshConsole('Session loaded, but refresh failed: ', session);
    } catch (error) {
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `Session check failed: ${errorMessage(error)}` });
      }
    } finally {
      schedulePoll();
    }
  }, [api, dispatch, handleUnauthenticated, refreshConsole, schedulePoll]);

  const login = useCallback(
    async (input: { username: string; password: string }) => {
      if (loginBusy) {
        return;
      }
      setLoginBusy(true);
      try {
        const session = await api.login(input);
        dispatch({ type: 'sessionLoaded', session });
        await refreshConsole('Login succeeded, but refresh failed: ', session);
      } catch (error) {
        dispatch({ type: 'loginFailed', message: `Login failed: ${errorMessage(error)}` });
      } finally {
        setLoginBusy(false);
        schedulePoll();
      }
    },
    [api, dispatch, loginBusy, refreshConsole, schedulePoll],
  );

  const mutateServer = useCallback(
    async (name: string, action: 'enable' | 'disable') => {
      const activeSession = stateRef.current.session;
      if (!activeSession) {
        return;
      }
      const sessionKey = activeSession.csrfToken;

      dispatch({ type: 'mutationStarted', serverId: name, action });
      try {
        await api.setConfiguredServerEnabled({
          name,
          enabled: action === 'enable',
          csrfToken: sessionKey,
        });
        if (!isCurrentSession(sessionKey)) {
          return;
        }
        dispatch({ type: 'mutationSucceeded', serverId: name, action });
        await refreshConsole('');
      } catch (error) {
        if (!isCurrentSession(sessionKey)) {
          return;
        }
        if (!handleUnauthenticated(error)) {
          dispatch({
            type: 'mutationFailed',
            serverId: name,
            action,
            message: `Server ${action} failed: ${errorMessage(error)}`,
          });
        }
      }
    },
    [api, dispatch, handleUnauthenticated, isCurrentSession, refreshConsole],
  );

  const logout = useCallback(async () => {
    const csrfToken = stateRef.current.session?.csrfToken;
    try {
      if (csrfToken) {
        await api.logout(csrfToken);
      }
    } finally {
      clearPoll();
      dispatch({ type: 'logoutSucceeded' });
    }
  }, [api, clearPoll, dispatch]);

  const copyText = useCallback(async (_label: string, value: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard_unavailable');
    }
    await navigator.clipboard.writeText(value);
  }, []);

  useEffect(() => {
    void loadSession();
    return clearPoll;
  }, [clearPoll, loadSession]);

  useEffect(() => {
    const listener = () => schedulePoll();
    documentRef.addEventListener?.('visibilitychange', listener);
    return () => documentRef.removeEventListener?.('visibilitychange', listener);
  }, [documentRef, schedulePoll]);

  return {
    state,
    loginBusy,
    login,
    logout,
    refreshConsole,
    mutateServer,
    copyText,
  };
}

function readAdminStatus(body: unknown): 'setupRequired' | 'loginRequired' {
  if (body && typeof body === 'object') {
    const adminStatus = (body as { adminStatus?: string }).adminStatus;
    return adminStatus === 'setupRequired' ? 'setupRequired' : 'loginRequired';
  }
  return 'loginRequired';
}

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    const requestId = readRequestId(error.body);
    const message = friendlyAdminError(error);
    return requestId ? `${message} Request ID: ${requestId}` : message;
  }
  return 'The Admin Console could not reach the runtime. Check that the runtime is still available, then refresh.';
}

function friendlyAdminError(error: AdminApiError): string {
  const code = readErrorCode(error);
  switch (code) {
    case 'invalid_credentials':
      return 'Check the admin username and password, then try again.';
    case 'csrf_required':
      return 'Refresh the page to renew the admin session, then retry the action.';
    case 'admin_login_rate_limited':
      return 'Too many failed login attempts. Wait before trying again.';
    case 'idempotency_conflict':
      return 'This action was already retried with different inputs. Refresh the console and try again.';
    case 'idempotency_key_required':
      return 'Refresh the console and retry the action with a new request.';
    case 'admin_configured_servers_unavailable':
      return 'Configured-server operations are not available on this runtime.';
    case 'mutation_failed':
      return 'The runtime could not apply the server change. Refresh the console and inspect the current state.';
    case 'operation_in_progress':
      return 'Another admin operation is still running. Wait for it to finish, then refresh the console.';
    case 'operation_state_unknown':
      return 'The runtime could not confirm the operation result. Refresh the console and inspect the current state before retrying.';
    case 'admin_operation_journal_unavailable':
      return 'The runtime cannot record admin operations right now. Check runtime health before retrying.';
    case 'runtime_scope_mismatch':
      return 'The runtime identity changed. Stop using this session and verify the selected runtime before retrying.';
    case 'mutation_confirmation_required':
      return 'This operation needs an explicit confirmation flow that is not available in the console yet.';
    default:
      if (error.status === 401) {
        return 'The admin session is no longer valid. Log in again.';
      }
      if (error.status === 403) {
        return 'The admin session cannot perform this action. Refresh the page and try again.';
      }
      if (error.status === 429) {
        return 'The runtime is rate limiting this request. Wait before trying again.';
      }
      return 'The Admin Console request failed. Refresh the console and try again.';
  }
}

function readErrorCode(error: AdminApiError): string {
  if (error.body && typeof error.body === 'object') {
    const record = error.body as Record<string, unknown>;
    if (typeof record.error === 'string') {
      return record.error;
    }
    if (typeof record.code === 'string') {
      return record.code;
    }
    if (record.error && typeof record.error === 'object') {
      const nested = record.error as Record<string, unknown>;
      if (typeof nested.code === 'string') {
        return nested.code;
      }
    }
  }
  return error.message;
}

function readRequestId(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (typeof record.requestId === 'string') {
    return record.requestId;
  }
  if (record.error && typeof record.error === 'object') {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.requestId === 'string') {
      return nested.requestId;
    }
  }
  return null;
}
