import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError } from './api/adminApi';
import type { AdminApiClient } from './api/adminApi';
import { createAdminConsoleController } from './controller';

const session = {
  authenticated: true,
  account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
  csrfToken: 'csrf_123',
  expiresAt: '2026-07-07T01:00:00.000Z',
} as const;

const status = {
  ok: true,
  runtime: {
    identityProtocolVersion: '1',
    runtimeScopeId: 'scope_123',
    runtimeVersion: '1.2.3',
  },
  session: {
    authenticated: true,
    account: { id: 'acct_1', username: 'operator', role: 'full-admin' },
    expiresAt: '2026-07-07T01:00:00.000Z',
  },
  oauth: { status: 'ready', services: [] },
  audit: { facts: [] },
} as const;

describe('admin console controller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns to login and clears console state when a refresh sees an expired session', async () => {
    const root = { innerHTML: '' };
    const api: AdminApiClient = {
      getSession: vi.fn(async () => session),
      getStatus: vi
        .fn()
        .mockResolvedValueOnce(status)
        .mockRejectedValueOnce(new AdminApiError(401, { authenticated: false }, 'Unauthorized')),
      listConfiguredServers: vi.fn(async () => [
        {
          id: 'filesystem',
          source: 'mcpServers',
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ]),
      login: vi.fn(),
      logout: vi.fn(),
      setConfiguredServerEnabled: vi.fn(),
    };
    const clearTimeout = vi.fn();
    const controller = createAdminConsoleController({
      root,
      api,
      documentRef: documentStub(),
      windowRef: {
        setTimeout: vi.fn(() => 1),
        clearTimeout,
      },
    });

    await controller.loadSession();
    expect(controller.getState().view).toBe('console');
    expect(root.innerHTML).toContain('Runtime operations');

    await controller.refreshConsole('');

    expect(controller.getState()).toMatchObject({
      view: 'login',
      session: null,
      status: null,
      configuredServers: [],
      serverMutations: {},
    });
    expect(root.innerHTML).toContain('id="login-form"');
    expect(root.innerHTML).not.toContain('Runtime operations');
    expect(clearTimeout).toHaveBeenCalled();
  });

  it('ignores stale refresh results after logout clears the active session', async () => {
    const root = { innerHTML: '' };
    const statusRefresh = deferred<typeof status>();
    const serversRefresh = deferred([
      {
        id: 'filesystem',
        source: 'mcpServers' as const,
        enabled: true,
        transport: { type: 'stdio' },
        secretInputs: [],
      },
    ]);
    const logoutButton = new FakeElement();
    const documentRef = interactiveDocumentStub({
      '#logout-button': logoutButton,
    });
    const api: AdminApiClient = {
      getSession: vi.fn(async () => session),
      getStatus: vi.fn(() => statusRefresh.promise),
      listConfiguredServers: vi.fn(() => serversRefresh.promise),
      login: vi.fn(),
      logout: vi.fn(async () => ({ ok: true })),
      setConfiguredServerEnabled: vi.fn(),
    };
    const controller = createAdminConsoleController({
      root,
      api,
      documentRef,
      windowRef: {
        setTimeout: vi.fn(() => 1),
        clearTimeout: vi.fn(),
      },
    });

    const loadSession = controller.loadSession();
    await flushPromises();
    expect(controller.getState().view).toBe('console');

    logoutButton.dispatch('click');
    await flushPromises();
    expect(controller.getState().view).toBe('login');

    statusRefresh.resolve(status);
    serversRefresh.resolve([
      {
        id: 'filesystem',
        source: 'mcpServers',
        enabled: true,
        transport: { type: 'stdio' },
        secretInputs: [],
      },
    ]);
    await loadSession;

    expect(controller.getState().view).toBe('login');
    expect(controller.getState().session).toBeNull();
    expect(root.innerHTML).toContain('id="login-form"');
    expect(root.innerHTML).not.toContain('Runtime operations');
  });

  it('wires login, refresh, visibility polling, and server action controls', async () => {
    vi.stubGlobal('HTMLFormElement', FakeFormElement);
    const root = { innerHTML: '' };
    const loginForm = new FakeFormElement();
    const refreshButton = new FakeElement();
    const disableButton = new FakeElement({ action: 'disable', name: 'filesystem' });
    const documentRef = interactiveDocumentStub({
      '#login-form': loginForm,
      '#refresh-button': refreshButton,
      '[data-action][data-name]': [disableButton],
    });
    const api: AdminApiClient = {
      getSession: vi.fn(),
      getStatus: vi.fn(async () => status),
      listConfiguredServers: vi.fn(async () => [
        {
          id: 'filesystem',
          source: 'mcpServers',
          enabled: true,
          transport: { type: 'stdio' },
          secretInputs: [],
        },
      ]),
      login: vi.fn(async () => session),
      logout: vi.fn(),
      setConfiguredServerEnabled: vi.fn(async () => ({ ok: true })),
    };
    const setTimeout = vi.fn(() => 1);
    const clearTimeout = vi.fn();
    const controller = createAdminConsoleController({
      root,
      api,
      documentRef,
      windowRef: {
        setTimeout,
        clearTimeout,
      },
      formData: () =>
        new Map<string, string>([
          ['username', 'operator'],
          ['password', 'correct horse battery staple'],
        ]) as unknown as FormData,
    });

    controller.render();
    loginForm.dispatch('submit');
    await flushPromises();

    expect(api.login).toHaveBeenCalledWith({
      username: 'operator',
      password: 'correct horse battery staple',
    });
    expect(root.innerHTML).toContain('Runtime operations');

    const refreshCountAfterLogin = vi.mocked(api.getStatus).mock.calls.length;
    refreshButton.dispatch('click');
    await flushPromises();
    expect(api.getStatus).toHaveBeenCalledTimes(refreshCountAfterLogin + 1);

    disableButton.dispatch('click');
    await flushPromises();
    expect(api.setConfiguredServerEnabled).toHaveBeenCalledWith({
      name: 'filesystem',
      enabled: false,
      csrfToken: 'csrf_123',
    });

    documentRef.emitVisibilityChange();
    expect(clearTimeout).toHaveBeenCalled();
    expect(setTimeout).toHaveBeenCalled();
  });
});

function documentStub() {
  return {
    visibilityState: 'visible',
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
  };
}

class FakeElement {
  readonly dataset: Record<string, string>;
  private readonly listeners = new Map<
    string,
    (event: { currentTarget: FakeElement; preventDefault: () => void }) => void
  >();

  constructor(dataset: Record<string, string> = {}) {
    this.dataset = dataset;
  }

  addEventListener(
    type: string,
    listener: (event: { currentTarget: FakeElement; preventDefault: () => void }) => void,
  ): void {
    this.listeners.set(type, listener);
  }

  dispatch(type: string): void {
    this.listeners.get(type)?.({
      currentTarget: this,
      preventDefault: vi.fn(),
    });
  }
}

class FakeFormElement extends FakeElement {}

function interactiveDocumentStub(elements: Record<string, FakeElement | FakeElement[]>) {
  let visibilityListener = () => {};
  const querySelector = vi.fn((selector: string) => {
    const value = elements[selector];
    return Array.isArray(value) ? null : (value ?? null);
  });
  const querySelectorAll = vi.fn((selector: string) => {
    const value = elements[selector];
    return Array.isArray(value) ? value : [];
  });
  const addEventListener = vi.fn((type: string, listener: () => void) => {
    if (type === 'visibilitychange') {
      visibilityListener = listener;
    }
  });

  return {
    visibilityState: 'visible',
    querySelector,
    querySelectorAll,
    addEventListener,
    emitVisibilityChange: () => visibilityListener(),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
