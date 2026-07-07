import type { AdminApiClient } from './api/adminApi';
import { AdminApiError } from './api/adminApi';
import { renderApp } from './components/render';
import {
  type AdminConsoleAction,
  type AdminConsoleState,
  createInitialState,
  reduceAdminConsoleState,
} from './state/adminConsoleState';
import { pollingDelayForVisibility, shouldPollConsole } from './state/polling';

interface AdminConsoleRoot {
  innerHTML: string;
}

interface AdminConsoleDocument {
  visibilityState: string;
  querySelector<T extends Element = Element>(selectors: string): T | null;
  querySelectorAll<T extends Element = Element>(selectors: string): { forEach(callback: (value: T) => void): void };
  addEventListener(type: string, listener: () => void): void;
}

interface AdminConsoleWindow {
  setTimeout(handler: () => void, timeout?: number): number;
  clearTimeout(handle?: number): void;
}

interface AdminConsoleControllerOptions {
  root: AdminConsoleRoot;
  api: AdminApiClient;
  documentRef: AdminConsoleDocument;
  windowRef: AdminConsoleWindow;
  nowLabel?: () => string;
  formData?: (form: HTMLFormElement) => FormData;
}

export function createAdminConsoleController(options: AdminConsoleControllerOptions) {
  const nowLabel = options.nowLabel ?? (() => new Date().toLocaleTimeString());
  const formData = options.formData ?? ((form: HTMLFormElement) => new FormData(form));
  let state = createInitialState();
  let pollTimer = 0;

  function dispatch(action: AdminConsoleAction): void {
    state = reduceAdminConsoleState(state, action);
    render();
  }

  function render(): void {
    options.root.innerHTML = renderApp(state);
    bindControls();
  }

  function bindControls(): void {
    options.documentRef.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit', handleLogin);
    options.documentRef.querySelector<HTMLButtonElement>('#refresh-button')?.addEventListener('click', () => {
      void refreshConsole('Manual refresh failed: ');
    });
    options.documentRef.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', () => {
      void logout();
    });
    options.documentRef.querySelectorAll<HTMLButtonElement>('[data-action][data-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action === 'disable' ? 'disable' : 'enable';
        const name = button.dataset.name ?? '';
        void mutateServer(name, action);
      });
    });
  }

  async function loadSession(): Promise<void> {
    try {
      const session = await options.api.getSession();
      dispatch({ type: 'sessionLoaded', session });
      await refreshConsole('Session loaded, but refresh failed: ');
    } catch (error) {
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `Session check failed: ${errorMessage(error)}` });
      }
    } finally {
      schedulePoll();
    }
  }

  async function handleLogin(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const fields = formData(form);

    try {
      const session = await options.api.login({
        username: String(fields.get('username') ?? ''),
        password: String(fields.get('password') ?? ''),
      });
      dispatch({ type: 'sessionLoaded', session });
      await refreshConsole('Login succeeded, but refresh failed: ');
    } catch (error) {
      dispatch({ type: 'loginFailed', message: `Login failed: ${errorMessage(error)}` });
    } finally {
      schedulePoll();
    }
  }

  async function refreshConsole(errorPrefix: string): Promise<void> {
    if (!state.session) {
      return;
    }
    const sessionKey = state.session.csrfToken;

    try {
      const [status, configuredServers] = await Promise.all([
        options.api.getStatus(),
        options.api.listConfiguredServers(),
      ]);
      if (!isCurrentSession(sessionKey)) {
        return;
      }
      dispatch({
        type: 'refreshSucceeded',
        status,
        configuredServers,
        updatedAt: nowLabel(),
      });
    } catch (error) {
      if (!isCurrentSession(sessionKey)) {
        return;
      }
      if (!handleUnauthenticated(error)) {
        dispatch({ type: 'refreshFailed', message: `${errorPrefix}${errorMessage(error)}` });
      }
    }
  }

  async function mutateServer(name: string, action: 'enable' | 'disable'): Promise<void> {
    if (!state.session) {
      return;
    }
    const sessionKey = state.session.csrfToken;

    dispatch({ type: 'mutationStarted', serverId: name, action });
    try {
      await options.api.setConfiguredServerEnabled({
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
  }

  async function logout(): Promise<void> {
    const csrfToken = state.session?.csrfToken;
    if (!csrfToken) {
      dispatch({ type: 'logoutSucceeded' });
      return;
    }

    try {
      await options.api.logout(csrfToken);
    } finally {
      options.windowRef.clearTimeout(pollTimer);
      dispatch({ type: 'logoutSucceeded' });
    }
  }

  function schedulePoll(): void {
    options.windowRef.clearTimeout(pollTimer);
    if (!shouldPollConsole(state)) {
      return;
    }

    pollTimer = options.windowRef.setTimeout(() => {
      void refreshConsole('').finally(schedulePoll);
    }, pollingDelayForVisibility(options.documentRef.visibilityState));
  }

  function handleUnauthenticated(error: unknown): boolean {
    if (!(error instanceof AdminApiError) || error.status !== 401) {
      return false;
    }

    options.windowRef.clearTimeout(pollTimer);
    dispatch({ type: 'sessionUnauthenticated', adminStatus: readAdminStatus(error.body) });
    return true;
  }

  function isCurrentSession(sessionKey: string): boolean {
    return state.session?.csrfToken === sessionKey;
  }

  options.documentRef.addEventListener('visibilitychange', schedulePoll);

  return {
    getState: (): AdminConsoleState => state,
    render,
    loadSession,
    refreshConsole,
    schedulePoll,
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
  return error instanceof Error ? error.message : 'Admin Console request failed';
}
