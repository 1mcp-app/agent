import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AdminApiError } from '../api/adminApi';
import type {
  AdminApiClient,
  AdminPresetDraft,
  AdminPresetListItem,
  AdminPresetPreview,
  AdminPresetTarget,
  AdminSession,
} from '../api/adminApi';
import { AdminConsoleApp } from '../components/AdminConsoleApp';
import { ConfirmationDialogProvider, useConfirmationDialog } from '../components/ConfirmationDialogProvider';
import { useConfiguredServerCreate } from '../configuredServerCreate/useConfiguredServerCreate';
import { useConfiguredServerEdit } from '../configuredServerEdit/useConfiguredServerEdit';
import { useInstructionTemplates } from '../instructionTemplates/useInstructionTemplates';
import { type AdminConsoleAction, createInitialState, reduceAdminConsoleState } from '../state/adminConsoleState';
import { pollingDelayForVisibility, shouldPollConsole } from '../state/polling';
import type {
  AdminConsoleRoute,
  AdminConsoleSessionModel,
  OAuthAdminAction,
  OAuthFeedback,
} from './AdminConsoleSessionModel';
import { useBackendLogs } from './useBackendLogs';

const OAUTH_CALLBACK_MESSAGES: Readonly<Record<string, string>> = {
  access_denied: 'OAuth authorization was denied.',
  missing_code: 'The OAuth provider callback did not include an authorization code.',
  callback_failed: 'The runtime could not complete the OAuth provider callback.',
  runtime_unavailable: 'The OAuth runtime became unavailable during the callback.',
};

function failureMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.failure.message;
  throw error;
}

interface AdminConsoleDocument {
  visibilityState: string;
  addEventListener?: Document['addEventListener'];
  removeEventListener?: Document['removeEventListener'];
}

interface AdminConsoleWindow {
  setTimeout: Window['setTimeout'];
  clearTimeout: Window['clearTimeout'];
  location?: Pick<Location, 'pathname' | 'search' | 'assign'>;
  history?: Pick<History, 'pushState' | 'replaceState'>;
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
  return (
    <ConfirmationDialogProvider>
      <AdminConsoleSessionRoot api={api} documentRef={documentRef} windowRef={windowRef} nowLabel={nowLabel} />
    </ConfirmationDialogProvider>
  );
}

function AdminConsoleSessionRoot({
  api,
  documentRef,
  windowRef,
  nowLabel,
}: Required<Omit<AdminConsoleRootProps, 'nowLabel'>> & Pick<AdminConsoleRootProps, 'nowLabel'>) {
  const confirm = useConfirmationDialog();
  const session = useAdminConsoleSession({ api, documentRef, windowRef, nowLabel, confirm });

  return <AdminConsoleApp session={session} />;
}

export function useAdminConsoleSession({
  api,
  documentRef,
  windowRef,
  nowLabel,
  confirm,
}: Required<Omit<AdminConsoleRootProps, 'nowLabel'>> &
  Pick<AdminConsoleRootProps, 'nowLabel'> & {
    confirm: ReturnType<typeof useConfirmationDialog>;
  }): AdminConsoleSessionModel {
  const [state, setState] = useState(createInitialState);
  const [loginBusy, setLoginBusy] = useState(false);
  const [route, setRoute] = useState(() => adminRoute(windowRef.location?.pathname ?? '/admin'));
  const [oauthBusy, setOAuthBusy] = useState<{ serviceId: string; action: OAuthAdminAction } | null>(null);
  const [oauthCallbackFeedback] = useState<OAuthFeedback | null>(() => {
    const feedback = oauthCallbackOutcome(windowRef.location?.search ?? '');
    if (feedback) windowRef.history?.replaceState(null, '', '/admin/oauth');
    return feedback;
  });
  const [oauthOperationFeedback, setOAuthOperationFeedback] = useState<OAuthFeedback | null>(null);
  const [presets, setPresets] = useState<AdminPresetListItem[]>([]);
  const [presetTargets, setPresetTargets] = useState<AdminPresetTarget[]>([]);
  const [presetRevision, setPresetRevision] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<Window['setTimeout']> | null>(null);
  const configuredServerAppliedRef = useRef<() => void | Promise<void>>();
  const configuredServerCreatedRef = useRef<() => void | Promise<void>>();
  const presetSaveBusyRef = useRef(false);
  const presetDeleteBusyRef = useRef(false);
  const oauthOperationBusyRef = useRef(false);
  const oauthOperationRequestRef = useRef(0);
  const formatNow = useCallback(() => nowLabel?.() ?? new Date().toLocaleTimeString(), [nowLabel]);

  const dispatch = useCallback((action: AdminConsoleAction) => {
    const next = reduceAdminConsoleState(stateRef.current, action);
    stateRef.current = next;
    setState(next);
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

  const resetOAuthOperation = useCallback(() => {
    oauthOperationRequestRef.current += 1;
    oauthOperationBusyRef.current = false;
    setOAuthBusy(null);
    setOAuthOperationFeedback(null);
  }, []);

  const invalidateAdminSession = useCallback(
    (adminStatus: 'setupRequired' | 'loginRequired') => {
      clearPoll();
      resetOAuthOperation();
      dispatch({ type: 'sessionUnauthenticated', adminStatus });
    },
    [clearPoll, dispatch, resetOAuthOperation],
  );

  const handleUnauthenticated = useCallback(
    (error: unknown) => {
      const failure = error instanceof AdminApiError ? error.failure : null;
      if (failure?.kind !== 'unauthenticated') return false;
      invalidateAdminSession(failure.adminStatus);
      return true;
    },
    [invalidateAdminSession],
  );

  const configuredServerEditBrowser = useMemo(
    () => ({
      pathname: () => windowRef.location?.pathname ?? '/admin',
      push: (pathname: string) => windowRef.history?.pushState(null, '', pathname),
      replace: (pathname: string) => windowRef.history?.replaceState(null, '', pathname),
      confirm,
      subscribePopState: (listener: () => void) => {
        windowRef.addEventListener?.('popstate', listener);
        return () => windowRef.removeEventListener?.('popstate', listener);
      },
    }),
    [confirm, windowRef],
  );

  const commitBrowserPath = useCallback((path: string) => {
    setRoute(adminRoute(path));
  }, []);

  const configuredServerEdit = useConfiguredServerEdit({
    api,
    session: state.session,
    browser: configuredServerEditBrowser,
    onUnauthenticated: invalidateAdminSession,
    onApplied: () => configuredServerAppliedRef.current?.(),
    onPathCommitted: commitBrowserPath,
  });
  const configuredServerCreate = useConfiguredServerCreate({
    api,
    session: state.session,
    browser: configuredServerEditBrowser,
    onUnauthenticated: invalidateAdminSession,
    onCreated: () => configuredServerCreatedRef.current?.(),
    onOpenCreated: configuredServerEdit.open,
    onPathCommitted: commitBrowserPath,
  });
  const backendLogs = useBackendLogs({
    api,
    active: route === 'logs',
    authenticated: Boolean(state.session),
    onUnauthenticated: () => invalidateAdminSession('loginRequired'),
  });
  const instructionTemplates = useInstructionTemplates({
    api,
    active: route === 'instructions',
    csrfToken: state.session?.csrfToken,
    onUnauthenticated: invalidateAdminSession,
  });

  const isCurrentSession = useCallback((sessionKey: string) => stateRef.current.session?.csrfToken === sessionKey, []);

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

  useEffect(() => {
    if (route === 'presets' && state.session) void loadPresets();
  }, [loadPresets, route, state.session]);

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
      if (presetSaveBusyRef.current) return false;
      presetSaveBusyRef.current = true;
      try {
        const csrfToken = stateRef.current.session?.csrfToken;
        if (!csrfToken) return false;
        const confirmed = await confirm({
          title: `${presetActionLabel(input.action)} ${input.preview.draft.name}?`,
          message: 'The preview must still match the current preset store when this change is saved.',
          confirmLabel: `${presetActionLabel(input.action)} preset`,
          details: [
            { label: 'Preset', value: input.preview.draft.name },
            { label: 'Current matches', value: String(input.preview.matchCount) },
            ...(input.preview.matchCount === 0
              ? [{ label: 'Attention', value: 'This preset currently matches no configured servers.' }]
              : []),
          ],
        });
        if (!confirmed) return false;
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
        return true;
      } finally {
        presetSaveBusyRef.current = false;
      }
    },
    [api, confirm, loadPresets],
  );

  const deletePreset = useCallback(
    async (name: string) => {
      if (presetDeleteBusyRef.current) return;
      presetDeleteBusyRef.current = true;
      try {
        const csrfToken = stateRef.current.session?.csrfToken;
        if (!csrfToken) return;
        const preview = await api.previewPresetDelete({ name, revision: presetRevision, csrfToken });
        const matches = preview.matches.filter((match) => match.matched).map((match) => match.name);
        const confirmed = await confirm({
          title: `Delete ${name}?`,
          message: 'This removes the preset from the current Runtime Scope.',
          confirmLabel: 'Delete preset',
          tone: 'danger',
          details: [
            { label: 'Preset', value: name },
            { label: 'Current matches', value: matches.join(', ') || 'none' },
            { label: 'Consequence', value: preview.consequence },
          ],
        });
        if (!confirmed) return;
        await api.deletePreset({
          name,
          revision: presetRevision,
          previewFingerprint: preview.previewFingerprint,
          csrfToken,
        });
        await loadPresets();
      } finally {
        presetDeleteBusyRef.current = false;
      }
    },
    [api, confirm, loadPresets, presetRevision],
  );

  const navigate = useCallback(
    async (nextRoute: AdminConsoleRoute) => {
      const pathname = adminRoutePath(nextRoute);
      if (configuredServerCreate.state.status !== 'idle') {
        if (!(await configuredServerCreate.close(pathname))) return;
        setRoute(nextRoute);
        return;
      }
      if (!(await configuredServerEdit.close(pathname))) return;
      setRoute(nextRoute);
    },
    [configuredServerCreate, configuredServerEdit],
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
          dispatch({ type: 'refreshFailed', message: `${errorPrefix}${failureMessage(error)}` });
        }
      }
    },
    [api, dispatch, formatNow, handleUnauthenticated, isCurrentSession],
  );
  configuredServerAppliedRef.current = () => refreshConsole('');
  configuredServerCreatedRef.current = () => refreshConsole('');

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
      if (!session.authenticated) {
        invalidateAdminSession(session.adminStatus ?? 'loginRequired');
        return;
      }
      dispatch({ type: 'sessionLoaded', session });
      await refreshConsole('Session loaded, but refresh failed: ', session);
    } catch (error) {
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `Session check failed: ${failureMessage(error)}` });
      }
    } finally {
      schedulePoll();
    }
  }, [api, dispatch, handleUnauthenticated, invalidateAdminSession, refreshConsole, schedulePoll]);

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
        dispatch({ type: 'loginFailed', message: `Login failed: ${failureMessage(error)}` });
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
            message: `Server ${action} failed: ${failureMessage(error)}`,
          });
        }
      }
    },
    [api, dispatch, handleUnauthenticated, isCurrentSession, refreshConsole],
  );

  const operateOAuth = useCallback(
    async (serviceId: string, action: OAuthAdminAction) => {
      if (oauthOperationBusyRef.current) return;
      const activeSession = stateRef.current.session;
      if (!activeSession) return;
      oauthOperationBusyRef.current = true;
      const requestId = oauthOperationRequestRef.current + 1;
      oauthOperationRequestRef.current = requestId;
      const sessionKey = activeSession.csrfToken;
      setOAuthBusy({ serviceId, action });
      setOAuthOperationFeedback(null);
      try {
        const result =
          action === 'authorize'
            ? await api.authorizeOAuthService({ serviceId, csrfToken: sessionKey })
            : await api.restartOAuthService({ serviceId, csrfToken: sessionKey });
        if (!isCurrentSession(sessionKey)) return;
        setOAuthOperationFeedback({
          kind: 'success',
          message: `${action === 'authorize' ? 'Authorization' : 'Authorization restart'} started. Opening the provider.`,
        });
        windowRef.location?.assign(result.redirectUrl);
      } catch (error) {
        if (!isCurrentSession(sessionKey)) return;
        if (!handleUnauthenticated(error)) {
          setOAuthOperationFeedback({ kind: 'error', message: failureMessage(error) });
        }
      } finally {
        if (oauthOperationRequestRef.current === requestId) {
          oauthOperationBusyRef.current = false;
          if (isCurrentSession(sessionKey)) setOAuthBusy(null);
        }
      }
    },
    [api, handleUnauthenticated, isCurrentSession, windowRef],
  );

  const logout = useCallback(async () => {
    const csrfToken = stateRef.current.session?.csrfToken;
    try {
      if (csrfToken) {
        await api.logout(csrfToken);
      }
    } finally {
      clearPoll();
      resetOAuthOperation();
      dispatch({ type: 'logoutSucceeded' });
    }
  }, [api, clearPoll, dispatch, resetOAuthOperation]);

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
    refresh: () => refreshConsole('Manual refresh failed: '),
    navigation: { route, navigate },
    configuredServers: {
      create: {
        ...configuredServerCreate,
        open: async () => {
          if (configuredServerCreate.state.status !== 'idle') {
            await configuredServerCreate.open();
            return;
          }
          if (!(await configuredServerEdit.close('/admin/servers'))) return;
          await configuredServerCreate.open();
        },
      },
      edit: configuredServerEdit,
      mutate: mutateServer,
      copy: copyText,
    },
    oauth: {
      busy: oauthBusy,
      callbackFeedback: oauthCallbackFeedback,
      operationFeedback: oauthOperationFeedback,
      operate: operateOAuth,
    },
    logs: backendLogs,
    presets: {
      items: presets,
      targets: presetTargets,
      revision: presetRevision,
      busy: presetBusy,
      load: loadPresets,
      preview: previewPreset,
      save: savePreset,
      delete: deletePreset,
    },
    instructions: instructionTemplates,
  };
}

function presetActionLabel(action: 'create' | 'update' | 'duplicate'): string {
  if (action === 'create') return 'Create';
  if (action === 'duplicate') return 'Duplicate';
  return 'Update';
}

function adminRoute(pathname: string): AdminConsoleRoute {
  if (pathname === '/admin/servers' || pathname.startsWith('/admin/servers/')) return 'servers';
  if (pathname === '/admin/oauth' || pathname.startsWith('/admin/oauth/')) return 'oauth';
  if (pathname === '/admin/audit' || pathname.startsWith('/admin/audit/')) return 'audit';
  if (pathname.startsWith('/admin/presets')) return 'presets';
  if (pathname.startsWith('/admin/instructions')) return 'instructions';
  if (pathname.startsWith('/admin/logs')) return 'logs';
  if (pathname.startsWith('/admin/about')) return 'about';
  return 'dashboard';
}

function adminRoutePath(route: AdminConsoleRoute): string {
  return route === 'dashboard' ? '/admin' : `/admin/${route}`;
}

function oauthCallbackOutcome(search: string): OAuthFeedback | null {
  const query = new URLSearchParams(search);
  if (query.get('success') === '1') {
    return { kind: 'success', message: 'OAuth authorization completed.' };
  }
  const error = query.get('error');
  if (!error) return null;
  const message = Object.hasOwn(OAUTH_CALLBACK_MESSAGES, error)
    ? OAUTH_CALLBACK_MESSAGES[error]
    : 'OAuth authorization did not complete.';
  return { kind: 'error', message };
}
