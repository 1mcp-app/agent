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
import { useConfiguredServerEdit } from '../configuredServerEdit/useConfiguredServerEdit';
import { type AdminConsoleAction, createInitialState, reduceAdminConsoleState } from '../state/adminConsoleState';
import { pollingDelayForVisibility, shouldPollConsole } from '../state/polling';
import type { AdminConsoleSessionModel } from './AdminConsoleSessionModel';

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
  const session = useAdminConsoleSession({ api, documentRef, windowRef, nowLabel });

  return <AdminConsoleApp session={session} />;
}

export function useAdminConsoleSession({
  api,
  documentRef,
  windowRef,
  nowLabel,
}: Required<Omit<AdminConsoleRootProps, 'nowLabel'>> &
  Pick<AdminConsoleRootProps, 'nowLabel'>): AdminConsoleSessionModel {
  const [state, setState] = useState(createInitialState);
  const [loginBusy, setLoginBusy] = useState(false);
  const [route, setRoute] = useState(() => adminRoute(windowRef.location?.pathname ?? '/admin'));
  const [presets, setPresets] = useState<AdminPresetListItem[]>([]);
  const [presetTargets, setPresetTargets] = useState<AdminPresetTarget[]>([]);
  const [presetRevision, setPresetRevision] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<Window['setTimeout']> | null>(null);
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

  const invalidateAdminSession = useCallback(
    (adminStatus: 'setupRequired' | 'loginRequired') => {
      clearPoll();
      dispatch({ type: 'sessionUnauthenticated', adminStatus });
    },
    [clearPoll, dispatch],
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
      confirm: (message: string) => windowRef.confirm?.(message) !== false,
      subscribePopState: (listener: () => void) => {
        windowRef.addEventListener?.('popstate', listener);
        return () => windowRef.removeEventListener?.('popstate', listener);
      },
    }),
    [windowRef],
  );

  const configuredServerEdit = useConfiguredServerEdit({
    api,
    session: state.session,
    browser: configuredServerEditBrowser,
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
      if (!configuredServerEdit.close(pathname)) return;
      setRoute(nextRoute);
      if (nextRoute === 'presets') void loadPresets();
    },
    [configuredServerEdit, loadPresets],
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
      if (adminRoute(windowRef.location?.pathname ?? '/admin') === 'presets') await loadPresets();
    } catch (error) {
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `Session check failed: ${failureMessage(error)}` });
      }
    } finally {
      schedulePoll();
    }
  }, [api, dispatch, handleUnauthenticated, loadPresets, refreshConsole, schedulePoll, windowRef.location]);

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
        if (adminRoute(windowRef.location?.pathname ?? '/admin') === 'presets') await loadPresets();
      } catch (error) {
        dispatch({ type: 'loginFailed', message: `Login failed: ${failureMessage(error)}` });
      } finally {
        setLoginBusy(false);
        schedulePoll();
      }
    },
    [api, dispatch, loadPresets, loginBusy, refreshConsole, schedulePoll, windowRef.location],
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

  useEffect(() => {
    const listener = () => {
      const nextRoute = adminRoute(windowRef.location?.pathname ?? '/admin');
      setRoute(nextRoute);
      if (nextRoute === 'presets') void loadPresets();
    };
    windowRef.addEventListener?.('popstate', listener);
    return () => windowRef.removeEventListener?.('popstate', listener);
  }, [loadPresets, windowRef]);

  return {
    state,
    loginBusy,
    login,
    logout,
    refresh: () => refreshConsole('Manual refresh failed: '),
    navigation: { route, navigate },
    configuredServers: {
      edit: configuredServerEdit,
      mutate: mutateServer,
      copy: copyText,
    },
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
  };
}

function adminRoute(pathname: string): 'overview' | 'presets' | 'about' {
  if (pathname.startsWith('/admin/presets')) return 'presets';
  if (pathname.startsWith('/admin/about')) return 'about';
  return 'overview';
}
