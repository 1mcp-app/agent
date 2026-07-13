import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminApiError } from './api/adminApi';
import type {
  AdminApiClient,
  AdminPresetDraft,
  AdminPresetListItem,
  AdminPresetPreview,
  AdminPresetTarget,
  AdminSession,
  ConfiguredServerEditDraft,
} from './api/adminApi';
import { AdminConsoleApp, type ConfiguredServerDetailPanelState } from './components/AdminConsoleApp';
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
  location?: Pick<Location, 'pathname'>;
  history?: Pick<History, 'pushState' | 'replaceState'>;
  confirm?: Window['confirm'];
  addEventListener?: Window['addEventListener'];
  removeEventListener?: Window['removeEventListener'];
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
      onOpenServerDetail={controller.openServerDetail}
      onCloseServerDetail={controller.closeServerDetail}
      onServerDetailDirtyChange={controller.setServerDetailDirty}
      onPreviewServerEdit={controller.previewServerEdit}
      onCopyText={controller.copyText}
      serverDetail={controller.serverDetail}
      loginBusy={controller.loginBusy}
      route={controller.route}
      onNavigate={controller.navigate}
      presets={controller.presets}
      presetTargets={controller.presetTargets}
      presetRevision={controller.presetRevision}
      presetBusy={controller.presetBusy}
      onLoadPresets={controller.loadPresets}
      onPreviewPreset={controller.previewPreset}
      onSavePreset={controller.savePreset}
      onDeletePreset={controller.deletePreset}
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
  const [serverDetail, setServerDetail] = useState<ConfiguredServerDetailPanelState>({ status: 'list' });
  const [loginBusy, setLoginBusy] = useState(false);
  const [route, setRoute] = useState(() => adminRoute(windowRef.location?.pathname ?? '/admin'));
  const [presets, setPresets] = useState<AdminPresetListItem[]>([]);
  const [presetTargets, setPresetTargets] = useState<AdminPresetTarget[]>([]);
  const [presetRevision, setPresetRevision] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const stateRef = useRef(state);
  const serverDetailRef = useRef(serverDetail);
  const timerRef = useRef<ReturnType<Window['setTimeout']> | null>(null);
  const detailRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const detailDirtyRef = useRef(false);
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

  useEffect(() => {
    serverDetailRef.current = serverDetail;
  }, [serverDetail]);

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
      detailRequestRef.current += 1;
      previewRequestRef.current += 1;
      detailDirtyRef.current = false;
      setServerDetail({ status: 'list' });
      dispatch({ type: 'sessionUnauthenticated', adminStatus: readAdminStatus(error.body) });
      return true;
    },
    [clearPoll, dispatch],
  );

  const isCurrentSession = useCallback((sessionKey: string) => stateRef.current.session?.csrfToken === sessionKey, []);

  const loadServerDetail = useCallback(
    async (serverId: string) => {
      const activeSession = stateRef.current.session;
      if (!activeSession) {
        return;
      }
      const sessionKey = activeSession.csrfToken;
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      previewRequestRef.current += 1;
      detailDirtyRef.current = false;

      setServerDetail({ status: 'loading', serverId });
      try {
        const detail = await api.getConfiguredServerDetail(serverId);
        if (!isCurrentSession(sessionKey) || requestId !== detailRequestRef.current) {
          return;
        }
        setServerDetail({ status: 'loaded', serverId, detail, previewBusy: false });
      } catch (error) {
        if (!isCurrentSession(sessionKey) || requestId !== detailRequestRef.current) {
          return;
        }
        if (handleUnauthenticated(error)) {
          return;
        }
        if (isConfiguredServerNotFound(error)) {
          setServerDetail({ status: 'missing', serverId });
          return;
        }
        setServerDetail({ status: 'failed', serverId, message: `Server detail failed: ${errorMessage(error)}` });
      }
    },
    [api, handleUnauthenticated, isCurrentSession],
  );

  const loadRouteDetail = useCallback(async () => {
    setRoute(adminRoute(windowRef.location?.pathname ?? '/admin'));
    const serverId = serverIdFromAdminPath(windowRef.location?.pathname ?? '');
    if (serverId) {
      await loadServerDetail(serverId);
      return;
    }
    detailRequestRef.current += 1;
    previewRequestRef.current += 1;
    detailDirtyRef.current = false;
    setServerDetail({ status: 'list' });
  }, [loadServerDetail, windowRef.location]);

  const loadPresets = useCallback(async () => {
    if (!stateRef.current.session) return;
    setPresetBusy(true);
    try {
      const result = await api.listPresets();
      setPresets(result.presets);
      setPresetTargets(result.targets ?? []);
      setPresetRevision(result.revision);
    } finally {
      setPresetBusy(false);
    }
  }, [api]);

  const previewPreset = useCallback(
    async (draft: AdminPresetDraft, sourceName?: string): Promise<AdminPresetPreview> => {
      const csrfToken = stateRef.current.session?.csrfToken;
      if (!csrfToken) throw new Error('admin_session_required');
      return api.previewPreset({ draft, sourceName, csrfToken });
    },
    [api],
  );

  const savePreset = useCallback(
    async (input: { action: 'create' | 'update' | 'duplicate'; sourceName?: string; preview: AdminPresetPreview }) => {
      const csrfToken = stateRef.current.session?.csrfToken;
      if (!csrfToken) return;
      await api.mutatePreset({
        action: input.action,
        sourceName: input.sourceName,
        draft: input.preview.draft,
        revision: input.preview.revision,
        previewFingerprint: input.preview.previewFingerprint,
        confirmations: {
          previewConfirmed: input.preview.previewFingerprint,
          ...(input.preview.matchCount === 0 ? { zeroMatchConfirmed: true } : {}),
        },
        csrfToken,
      });
      await loadPresets();
    },
    [api, loadPresets],
  );

  const deletePreset = useCallback(
    async (name: string) => {
      const csrfToken = stateRef.current.session?.csrfToken;
      if (!csrfToken) return;
      const preview = await api.previewPresetDelete({ name, revision: presetRevision, csrfToken });
      const matches = preview.matches.filter((match) => match.matched).map((match) => match.name);
      if (
        windowRef.confirm?.(
          `Confirm preset name "${name}" and delete it? Current matches: ${matches.join(', ') || 'none'}. ${preview.consequence}`,
        ) === false
      ) {
        return;
      }
      await api.deletePreset({
        name,
        revision: presetRevision,
        previewFingerprint: preview.previewFingerprint,
        csrfToken,
      });
      await loadPresets();
    },
    [api, loadPresets, presetRevision, windowRef],
  );

  const navigate = useCallback(
    (nextRoute: 'overview' | 'presets' | 'about') => {
      const pathname = nextRoute === 'overview' ? '/admin' : `/admin/${nextRoute}`;
      windowRef.history?.pushState(null, '', pathname);
      setRoute(nextRoute);
      if (nextRoute === 'presets') void loadPresets();
    },
    [loadPresets, windowRef.history],
  );

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
      await loadRouteDetail();
      if (adminRoute(windowRef.location?.pathname ?? '/admin') === 'presets') await loadPresets();
    } catch (error) {
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `Session check failed: ${errorMessage(error)}` });
      }
    } finally {
      schedulePoll();
    }
  }, [
    api,
    dispatch,
    handleUnauthenticated,
    loadPresets,
    loadRouteDetail,
    refreshConsole,
    schedulePoll,
    windowRef.location,
  ]);

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
        await loadRouteDetail();
        if (adminRoute(windowRef.location?.pathname ?? '/admin') === 'presets') await loadPresets();
      } catch (error) {
        dispatch({ type: 'loginFailed', message: `Login failed: ${errorMessage(error)}` });
      } finally {
        setLoginBusy(false);
        schedulePoll();
      }
    },
    [api, dispatch, loadPresets, loadRouteDetail, loginBusy, refreshConsole, schedulePoll, windowRef.location],
  );

  const confirmDiscardDetail = useCallback(
    (dirty: boolean) => !dirty || windowRef.confirm?.('Discard unsaved configured-server edits?') !== false,
    [windowRef],
  );

  const openServerDetail = useCallback(
    async (serverId: string) => {
      const currentDetail = serverDetailRef.current;
      if (
        currentDetail.status === 'loaded' &&
        currentDetail.serverId !== serverId &&
        !confirmDiscardDetail(detailDirtyRef.current)
      ) {
        windowRef.history?.pushState(null, '', `/admin/servers/${encodeURIComponent(currentDetail.serverId)}`);
        return;
      }
      windowRef.history?.pushState(null, '', `/admin/servers/${encodeURIComponent(serverId)}`);
      await loadServerDetail(serverId);
    },
    [confirmDiscardDetail, loadServerDetail, windowRef.history],
  );

  const closeServerDetail = useCallback(
    (dirty = false) => {
      if (!confirmDiscardDetail(dirty)) {
        return;
      }
      windowRef.history?.pushState(null, '', '/admin');
      detailRequestRef.current += 1;
      previewRequestRef.current += 1;
      detailDirtyRef.current = false;
      setServerDetail({ status: 'list' });
    },
    [confirmDiscardDetail, windowRef.history],
  );

  const setServerDetailDirty = useCallback((dirty: boolean) => {
    detailDirtyRef.current = dirty;
  }, []);

  const previewServerEdit = useCallback(
    async (serverId: string, edit: ConfiguredServerEditDraft, connectivityCheck: 'auto' | 'manual' = 'auto') => {
      const activeSession = stateRef.current.session;
      const currentDetail = serverDetailRef.current;
      if (!activeSession || currentDetail.status !== 'loaded') {
        return;
      }
      const sessionKey = activeSession.csrfToken;
      const requestId = previewRequestRef.current + 1;
      previewRequestRef.current = requestId;

      setServerDetail({ ...currentDetail, previewBusy: true, previewError: undefined });
      try {
        const response = await api.previewConfiguredServerEdit({
          name: serverId,
          csrfToken: sessionKey,
          connectivityCheck,
          edit,
        });
        if (!isCurrentSession(sessionKey) || requestId !== previewRequestRef.current) {
          return;
        }
        setServerDetail({ ...currentDetail, preview: response.preview, previewBusy: false });
      } catch (error) {
        if (!isCurrentSession(sessionKey) || requestId !== previewRequestRef.current) {
          return;
        }
        if (!handleUnauthenticated(error)) {
          setServerDetail({
            ...currentDetail,
            previewBusy: false,
            previewError: `Preview failed: ${errorMessage(error)}`,
          });
        }
      }
    },
    [api, handleUnauthenticated, isCurrentSession],
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
      detailRequestRef.current += 1;
      previewRequestRef.current += 1;
      detailDirtyRef.current = false;
      setServerDetail({ status: 'list' });
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

  useEffect(() => {
    const listener = () => {
      const currentDetail = serverDetailRef.current;
      if (currentDetail.status === 'loaded' && !confirmDiscardDetail(detailDirtyRef.current)) {
        windowRef.history?.pushState(null, '', `/admin/servers/${encodeURIComponent(currentDetail.serverId)}`);
        return;
      }
      void loadRouteDetail();
    };
    windowRef.addEventListener?.('popstate', listener);
    return () => windowRef.removeEventListener?.('popstate', listener);
  }, [confirmDiscardDetail, loadRouteDetail, windowRef]);

  return {
    state,
    loginBusy,
    login,
    logout,
    refreshConsole,
    mutateServer,
    openServerDetail,
    closeServerDetail,
    setServerDetailDirty,
    previewServerEdit,
    copyText,
    serverDetail,
    route,
    navigate,
    presets,
    presetTargets,
    presetRevision,
    presetBusy,
    loadPresets,
    previewPreset,
    savePreset,
    deletePreset,
  };
}

function adminRoute(pathname: string): 'overview' | 'presets' | 'about' {
  if (pathname.startsWith('/admin/presets')) return 'presets';
  if (pathname.startsWith('/admin/about')) return 'about';
  return 'overview';
}

function readAdminStatus(body: unknown): 'setupRequired' | 'loginRequired' {
  if (body && typeof body === 'object') {
    const adminStatus = (body as { adminStatus?: string }).adminStatus;
    return adminStatus === 'setupRequired' ? 'setupRequired' : 'loginRequired';
  }
  return 'loginRequired';
}

function serverIdFromAdminPath(pathname: string): string | null {
  const prefix = '/admin/servers/';
  if (!pathname.startsWith(prefix)) {
    return null;
  }

  const encoded = pathname.slice(prefix.length);
  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function isConfiguredServerNotFound(error: unknown): boolean {
  if (!(error instanceof AdminApiError) || error.status !== 404 || !error.body || typeof error.body !== 'object') {
    return false;
  }

  const record = error.body as Record<string, unknown>;
  return record.code === 'configured_server_not_found' || record.error === 'configured_server_not_found';
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
