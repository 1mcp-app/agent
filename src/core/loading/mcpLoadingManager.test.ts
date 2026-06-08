/**
 * Unit tests for McpLoadingManager — focusing on the per-server operation
 * abort signal introduced to fix three confirmed race conditions:
 *
 *   A. loadServer → unloadServer while retry-loop is sleeping
 *      → loop must stop immediately; server must NOT be re-inserted into
 *        outboundConns or the tracker after removal.
 *
 *   B. Two concurrent loadServer('X') calls (TOCTOU on tracker check)
 *      → second call must cancel the first; only one final connection exists.
 *
 *   C. performBackgroundRetry (fire-and-forget) + concurrent unloadServer
 *      → background loadSingleServer must not re-add an orphaned connection
 *        after the server is removed.
 *
 * Mock strategy
 * ─────────────
 * • ClientManager — constructor arg, hand-crafted Partial<ClientManager> with vi.fn().
 *   createSingleClient is the primary control point: we resolve / reject it manually
 *   via a deferred promise to simulate slow or never-completing connections.
 * • transportFactory.createTransports — vi.mock'd at module level; returns a fake
 *   transport by default, can be overridden per-test.
 * • LoadingStateTracker — NOT mocked; we verify through manager.getStateTracker()
 *   so the real state-transition logic is exercised.
 * • No fake timers — sleep / timeout are made fast by setting very low config values.
 */
// ── Helpers ───────────────────────────────────────────────────────────────────
import { createTransports } from '@src/transport/transportFactory.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoadingState } from './loadingStateTracker.js';
import { McpLoadingEvent, McpLoadingManager } from './mcpLoadingManager.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@src/transport/transportFactory.js', () => ({
  createTransports: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  debugIf: vi.fn(),
}));

const mockCreateTransports = vi.mocked(createTransports);

/** A fake transport that satisfies the AuthProviderTransport interface. */
const makeFakeTransport = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  send: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  onclose: undefined,
  onerror: undefined,
  onmessage: undefined,
});

/** Deferred helper — lets a test control when createSingleClient resolves. */
function makeDeferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Yield to the microtask / timer queue so queued async work can run. */
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

/** Build a ClientManager mock. `createSingleClient` is controlled by the caller. */
function makeClientManagerMock(createSingleClientImpl?: () => Promise<void>) {
  const outboundConns = new Map();
  const transports: Record<string, unknown> = {};

  return {
    getClients: vi.fn().mockReturnValue(outboundConns),
    getTransport: vi.fn((name: string) => transports[name]),
    createSingleClient: vi.fn(
      createSingleClientImpl ??
        (() => {
          // Default: resolve immediately (successful connection)
          outboundConns.set('__last__', {});
          return Promise.resolve();
        }),
    ),
    removeClient: vi.fn(async (name: string) => {
      outboundConns.delete(name);
      delete transports[name];
    }),
    setInstructionAggregator: vi.fn(),
    // Expose so tests can inspect / manipulate
    _outboundConns: outboundConns,
    _transports: transports,
  };
}

/** Fast loading config to avoid 30 s timeouts and 2 s retry delays in tests. */
const FAST_CONFIG = {
  serverTimeoutMs: 200,
  maxRetries: 2,
  retryDelayMs: 10,
  maxConcurrentLoads: 5,
  continueOnFailure: true,
  enableBackgroundRetry: false, // disabled by default; override per test
  backgroundRetryIntervalMs: 100,
};

/** Minimal MCPServerParams for a stdio server. */
const makeServerConfig = (overrides: Record<string, unknown> = {}) =>
  ({
    command: 'echo',
    args: [],
    disabled: false,
    ...overrides,
  }) as Parameters<McpLoadingManager['loadServer']>[1];

// ── Test suite ────────────────────────────────────────────────────────────────

describe('McpLoadingManager', () => {
  let clientManager: ReturnType<typeof makeClientManagerMock>;
  let manager: McpLoadingManager;

  beforeEach(() => {
    vi.clearAllMocks();
    clientManager = makeClientManagerMock();
    // Default transport factory: return one fake transport
    mockCreateTransports.mockImplementation((cfg) => {
      const result: Record<string, ReturnType<typeof makeFakeTransport>> = {};
      for (const name of Object.keys(cfg)) {
        result[name] = makeFakeTransport();
      }
      return result as ReturnType<typeof createTransports>;
    });
    manager = new McpLoadingManager(clientManager as never, FAST_CONFIG);
  });

  afterEach(() => {
    manager.shutdown();
  });

  // ── static .current ─────────────────────────────────────────────────────────

  describe('static current', () => {
    it('is set to the most recently constructed instance', () => {
      expect(McpLoadingManager.current).toBe(manager);
    });

    it('throws if no instance has been constructed', () => {
      // Access private static via bracket notation for test isolation
      const saved = (McpLoadingManager as unknown as { _current: unknown })._current;
      (McpLoadingManager as unknown as { _current: unknown })._current = undefined;
      expect(() => McpLoadingManager.current).toThrow('McpLoadingManager not initialized');
      (McpLoadingManager as unknown as { _current: unknown })._current = saved;
    });
  });

  // ── loadServer — happy path ─────────────────────────────────────────────────

  describe('loadServer — happy path', () => {
    it('tracks server through Pending → Loading → Ready', async () => {
      await manager.loadServer('my-server', makeServerConfig());

      const state = manager.getStateTracker().getServerState('my-server');
      expect(state?.state).toBe(LoadingState.Ready);
    });

    it('emits ServerLoaded event on success', async () => {
      const spy = vi.fn();
      manager.on(McpLoadingEvent.ServerLoaded, spy);

      await manager.loadServer('my-server', makeServerConfig());

      expect(spy).toHaveBeenCalledWith('my-server', expect.objectContaining({ success: true }));
    });

    it('skips disabled server and calls unloadServer to clear stale state', async () => {
      // First load a server so there is state to clear
      await manager.loadServer('srv', makeServerConfig());
      expect(manager.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Ready);

      // Now disable it
      await manager.loadServer('srv', makeServerConfig({ disabled: true }));

      expect(manager.getStateTracker().getServerState('srv')).toBeUndefined();
      expect(clientManager.removeClient).toHaveBeenCalledWith('srv');
    });

    it('marks server as Failed when transport factory throws', async () => {
      mockCreateTransports.mockImplementationOnce(() => {
        throw new Error('bad config');
      });

      await manager.loadServer('srv', makeServerConfig());

      const state = manager.getStateTracker().getServerState('srv');
      expect(state?.state).toBe(LoadingState.Failed);
      expect(state?.error?.message).toMatch('bad config');
    });

    it('copies OAuth authorization URL into loading tracker when authorization is required', async () => {
      const authorizationUrl = 'https://auth.example.com/authorize?client_id=abc';
      const oauthTransport = {
        ...makeFakeTransport(),
        oauthProvider: {
          getAuthorizationUrl: vi.fn().mockReturnValue(authorizationUrl),
        },
      };
      const oauthRequired = new Error('OAuth authorization required for srv');
      oauthRequired.name = 'OAuthRequiredError';

      mockCreateTransports.mockImplementationOnce(
        () => ({ srv: oauthTransport }) as unknown as ReturnType<typeof createTransports>,
      );
      clientManager.createSingleClient.mockRejectedValueOnce(oauthRequired);

      const oauthRequiredSpy = vi.fn();
      manager.on(McpLoadingEvent.OAuthRequired, oauthRequiredSpy);

      await manager.loadServer('srv', makeServerConfig({ type: 'http', url: 'https://mcp.example.com' }));

      const state = manager.getStateTracker().getServerState('srv');
      expect(state?.state).toBe(LoadingState.AwaitingOAuth);
      expect(state?.authorizationUrl).toBe(authorizationUrl);
      expect(oauthRequiredSpy).toHaveBeenCalledWith('srv', authorizationUrl);
    });

    it('skips silently when transport factory returns undefined for server', async () => {
      mockCreateTransports.mockImplementationOnce(() => ({}) as ReturnType<typeof createTransports>);

      await manager.loadServer('srv', makeServerConfig());

      // Server should not appear in tracker at all (transport was missing)
      expect(manager.getStateTracker().getServerState('srv')).toBeUndefined();
    });
  });

  // ── loadServer — idempotent reload ──────────────────────────────────────────

  describe('loadServer — idempotent reload', () => {
    it('unloads existing server before reloading (functional modify)', async () => {
      await manager.loadServer('srv', makeServerConfig());
      expect(manager.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Ready);

      await manager.loadServer('srv', makeServerConfig({ env: { KEY: 'new' } }));

      // removeClient called at least once for the reload
      expect(clientManager.removeClient).toHaveBeenCalledWith('srv');
      // Final state: Ready again
      expect(manager.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Ready);
    });

    it('old tracker entry is cleared before new load registers', async () => {
      await manager.loadServer('srv', makeServerConfig());

      const statesBefore: LoadingState[] = [];
      manager.getStateTracker().on('server-state-changed', (_name, info) => {
        if (_name === 'srv') statesBefore.push(info.state);
      });

      await manager.loadServer('srv', makeServerConfig({ env: { K: 'v' } }));

      // registerServer sets Pending as the initial value but does NOT emit
      // ServerStateChanged (it emits LoadingProgress). The first real state
      // transition observable via ServerStateChanged is Loading → Ready.
      // We verify the sequence ends with Ready and goes through Loading.
      expect(statesBefore).toContain(LoadingState.Loading);
      expect(statesBefore[statesBefore.length - 1]).toBe(LoadingState.Ready);
    });
  });

  // ── unloadServer ────────────────────────────────────────────────────────────

  describe('unloadServer', () => {
    it('removes server from tracker', async () => {
      await manager.loadServer('srv', makeServerConfig());
      expect(manager.getStateTracker().getServerState('srv')).toBeDefined();

      await manager.unloadServer('srv');

      expect(manager.getStateTracker().getServerState('srv')).toBeUndefined();
    });

    it('calls clientManager.removeClient', async () => {
      await manager.loadServer('srv', makeServerConfig());
      await manager.unloadServer('srv');

      expect(clientManager.removeClient).toHaveBeenCalledWith('srv');
    });

    it('is a no-op for an unknown server (does not throw)', async () => {
      await expect(manager.unloadServer('nonexistent')).resolves.toBeUndefined();
    });
  });

  // ── Race A: unloadServer cancels in-flight retry sleep ─────────────────────

  describe('Race A — unloadServer cancels in-flight load', () => {
    it('aborts retry sleep immediately: no state written after removal', async () => {
      // Make createSingleClient always fail so the retry loop runs
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('conn refused')));
      const mgr = new McpLoadingManager(
        failingManager as never,
        { ...FAST_CONFIG, maxRetries: 3, retryDelayMs: 5000 }, // long retry delay
      );

      // Start loading without awaiting — it will hang in the first retry sleep
      const loadPromise = mgr.loadServer('srv', makeServerConfig());

      // Yield so loadSingleServer enters its first retry sleep
      await yieldToEventLoop();
      await yieldToEventLoop();

      // Unload while the retry sleep is in progress
      await mgr.unloadServer('srv');

      // The loadServer promise should resolve cleanly (no throw)
      await expect(loadPromise).resolves.toBeUndefined();

      // Server must NOT be in the tracker — the retry loop stopped cleanly
      expect(mgr.getStateTracker().getServerState('srv')).toBeUndefined();

      mgr.shutdown();
    });

    it('does not mark server as Failed when cancelled mid-retry', async () => {
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('conn refused')));
      const mgr = new McpLoadingManager(failingManager as never, {
        ...FAST_CONFIG,
        maxRetries: 3,
        retryDelayMs: 5000,
      });

      const serverFailedSpy = vi.fn();
      mgr.on(McpLoadingEvent.ServerFailed, serverFailedSpy);

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();
      await yieldToEventLoop();

      await mgr.unloadServer('srv');
      await loadPromise;

      // ServerFailed must NOT have been emitted — cancellation is intentional
      expect(serverFailedSpy).not.toHaveBeenCalled();

      mgr.shutdown();
    });

    it('aborts active connection attempt when unloadServer is called', async () => {
      // createSingleClient hangs until we abort it
      const deferred = makeDeferred();
      const blockingManager = makeClientManagerMock(() => deferred.promise);
      const mgr = new McpLoadingManager(blockingManager as never, FAST_CONFIG);

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();

      // Unload while connection is in-flight
      await mgr.unloadServer('srv');

      // Resolve the deferred AFTER unload to simulate late network reply
      deferred.resolve();
      await loadPromise;

      // Server must not appear in tracker
      expect(mgr.getStateTracker().getServerState('srv')).toBeUndefined();

      mgr.shutdown();
    });
  });

  // ── Race B: concurrent loadServer calls ─────────────────────────────────────

  describe('Race B — concurrent loadServer calls cancel each other correctly', () => {
    it('second loadServer cancels first; final state is Ready from second', async () => {
      // First call: connection hangs indefinitely
      const deferred = makeDeferred();
      let callCount = 0;
      const controlledManager = makeClientManagerMock(() => {
        callCount++;
        if (callCount === 1) return deferred.promise; // first call hangs
        return Promise.resolve(); // second call succeeds
      });

      const mgr = new McpLoadingManager(controlledManager as never, FAST_CONFIG);

      // Start first load (will hang)
      const first = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();

      // Start second load concurrently — should cancel the first
      const second = mgr.loadServer('srv', makeServerConfig({ env: { v: '2' } }));

      // Unblock the first deferred (simulating late network response)
      deferred.resolve();

      await Promise.all([first, second]);

      // Only one tracker entry should exist (Ready from the second load)
      expect(mgr.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Ready);
      // removeClient should have been called to clean up the first attempt
      expect(controlledManager.removeClient).toHaveBeenCalledWith('srv');

      mgr.shutdown();
    });

    it('two loadServer calls for different servers do not interfere', async () => {
      await Promise.all([
        manager.loadServer('srv-a', makeServerConfig()),
        manager.loadServer('srv-b', makeServerConfig()),
      ]);

      expect(manager.getStateTracker().getServerState('srv-a')?.state).toBe(LoadingState.Ready);
      expect(manager.getStateTracker().getServerState('srv-b')?.state).toBe(LoadingState.Ready);
    });
  });

  // ── Race C: background retry + unloadServer ─────────────────────────────────

  describe('Race C — performBackgroundRetry does not orphan connections after unload', () => {
    it('background retry is cancelled by unloadServer before it can re-add connection', async () => {
      // Set up a manager with background retry enabled
      const deferred = makeDeferred();
      let callCount = 0;
      const controlledManager = makeClientManagerMock(async () => {
        callCount++;
        if (callCount === 1) {
          // First call (initial load): fail so server goes to Failed state
          throw new Error('initial failure');
        }
        // Subsequent calls (background retry): hang until deferred resolves
        return deferred.promise;
      });
      // Give background retry a transport to work with
      controlledManager.getTransport.mockImplementation(() => makeFakeTransport());

      const mgr = new McpLoadingManager(controlledManager as never, {
        ...FAST_CONFIG,
        continueOnFailure: true,
        enableBackgroundRetry: true,
        backgroundRetryIntervalMs: 50,
      });

      // Load once — will fail, server goes to Failed
      await mgr.loadServer('srv', makeServerConfig());
      expect(mgr.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Failed);

      // Wait for background retry to start (50 ms interval)
      await new Promise((r) => setTimeout(r, 80));
      await yieldToEventLoop();

      // Now unload while background retry's loadSingleServer is hanging
      await mgr.unloadServer('srv');

      // Unblock the deferred (simulates network response arriving late)
      deferred.resolve();
      await yieldToEventLoop();
      await yieldToEventLoop();

      // Server must NOT be in tracker — background retry was cancelled
      expect(mgr.getStateTracker().getServerState('srv')).toBeUndefined();
      // removeClient should have been called
      expect(controlledManager.removeClient).toHaveBeenCalledWith('srv');

      mgr.shutdown();
    });
  });

  // ── shutdown cancels all operations ─────────────────────────────────────────

  describe('shutdown', () => {
    it('aborts all in-flight server op controllers', async () => {
      // loadServer with a hanging connection
      const deferred = makeDeferred();
      const blockingManager = makeClientManagerMock(() => deferred.promise);
      const mgr = new McpLoadingManager(blockingManager as never, FAST_CONFIG);

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();

      mgr.shutdown();
      deferred.resolve(); // unblock after shutdown
      await loadPromise;

      // Server should not be in Ready state after shutdown aborted the load
      const state = mgr.getStateTracker().getServerState('srv');
      // Either undefined (removed) or not Ready
      expect(state?.state).not.toBe(LoadingState.Ready);
    });

    it('marks pending/loading servers as Cancelled', async () => {
      // Use a very slow createSingleClient so server stays Loading during shutdown
      const deferred = makeDeferred();
      const blockingManager = makeClientManagerMock(() => deferred.promise);
      const mgr = new McpLoadingManager(blockingManager as never, {
        ...FAST_CONFIG,
        serverTimeoutMs: 60000, // long timeout so it stays Loading
      });

      // Start loading; don't await
      mgr.startAsyncLoading({ srv: makeFakeTransport() as never });
      await yieldToEventLoop();

      mgr.shutdown();
      deferred.resolve();
      await yieldToEventLoop();

      const state = mgr.getStateTracker().getServerState('srv');
      expect(state?.state).toBe(LoadingState.Cancelled);
    });
  });

  // ── cancelServerOperation is idempotent ─────────────────────────────────────

  describe('cancelServerOperation (via public surface)', () => {
    it('calling unloadServer twice does not throw', async () => {
      await manager.loadServer('srv', makeServerConfig());
      await expect(manager.unloadServer('srv')).resolves.toBeUndefined();
      // Second call on already-removed server
      await expect(manager.unloadServer('srv')).resolves.toBeUndefined();
    });
  });

  // ── cancelServerLoading / cancelAllLoading — public cancel APIs ──────────────

  describe('cancelServerLoading', () => {
    it('cancels a server sleeping between retries (not in abortControllers)', async () => {
      // Server always fails so it enters retry sleep
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('conn refused')));
      const mgr = new McpLoadingManager(failingManager as never, {
        ...FAST_CONFIG,
        maxRetries: 5,
        retryDelayMs: 5000, // long sleep so it stays there
      });

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      // Yield past the first failure so the retry sleep begins
      await yieldToEventLoop();
      await yieldToEventLoop();

      // Server is sleeping between retries — abortControllers will be empty,
      // only serverOpAbortControllers has an entry.
      mgr.cancelServerLoading('srv');
      await loadPromise;

      // Must be Cancelled, not Loading/Failed/Ready
      const state = mgr.getStateTracker().getServerState('srv');
      expect(state?.state).toBe(LoadingState.Cancelled);

      mgr.shutdown();
    });

    it('cancels a server mid-connection-attempt (in abortControllers)', async () => {
      const deferred = makeDeferred();
      const blockingManager = makeClientManagerMock(() => deferred.promise);
      const mgr = new McpLoadingManager(blockingManager as never, FAST_CONFIG);

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();

      mgr.cancelServerLoading('srv');
      deferred.resolve();
      await loadPromise;

      const state = mgr.getStateTracker().getServerState('srv');
      expect(state?.state).toBe(LoadingState.Cancelled);

      mgr.shutdown();
    });

    it('warns and is a no-op for an unknown / already-finished server', () => {
      // Should not throw
      expect(() => manager.cancelServerLoading('nonexistent')).not.toThrow();
    });
  });

  describe('cancelAllLoading', () => {
    it('cancels initial async-loading servers sleeping between retries', async () => {
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('initial fail')));
      const mgr = new McpLoadingManager(failingManager as never, {
        ...FAST_CONFIG,
        maxRetries: 5,
        retryDelayMs: 500,
      });

      try {
        mgr.startAsyncLoading({ srv: makeFakeTransport() as never });
        await yieldToEventLoop();
        await yieldToEventLoop();

        expect(mgr.getCancellableServers()).toContain('srv');

        mgr.cancelAllLoading();
        await yieldToEventLoop();

        expect(mgr.getStateTracker().getServerState('srv')?.state).toBe(LoadingState.Cancelled);
      } finally {
        mgr.shutdown();
      }
    });

    it('cancels servers sleeping between retries (not visible in old abortControllers only)', async () => {
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('fail')));
      const mgr = new McpLoadingManager(failingManager as never, {
        ...FAST_CONFIG,
        maxRetries: 5,
        retryDelayMs: 5000,
      });

      const p1 = mgr.loadServer('srv-a', makeServerConfig());
      const p2 = mgr.loadServer('srv-b', makeServerConfig());
      await yieldToEventLoop();
      await yieldToEventLoop();

      // Both servers are sleeping in retry — cancelAllLoading must reach them
      mgr.cancelAllLoading();
      await Promise.all([p1, p2]);

      expect(mgr.getStateTracker().getServerState('srv-a')?.state).toBe(LoadingState.Cancelled);
      expect(mgr.getStateTracker().getServerState('srv-b')?.state).toBe(LoadingState.Cancelled);

      mgr.shutdown();
    });
  });

  describe('getCancellableServers', () => {
    it('includes servers sleeping between retries, not just mid-connection ones', async () => {
      const failingManager = makeClientManagerMock(() => Promise.reject(new Error('fail')));
      const mgr = new McpLoadingManager(failingManager as never, {
        ...FAST_CONFIG,
        maxRetries: 5,
        retryDelayMs: 5000,
      });

      const loadPromise = mgr.loadServer('srv', makeServerConfig());
      await yieldToEventLoop();
      await yieldToEventLoop();

      // Server is in retry sleep — must appear in getCancellableServers
      expect(mgr.getCancellableServers()).toContain('srv');

      mgr.cancelAllLoading();
      await loadPromise;
      mgr.shutdown();
    });
  });

  // ── setupBackgroundRetry idempotency ─────────────────────────────────────────

  describe('setupBackgroundRetry idempotency', () => {
    it('installs only one interval even after multiple LoadingComplete events from hot-reload cycles', async () => {
      // Enable background retry so the timer is actually installed
      const mgr = new McpLoadingManager(clientManager as never, {
        ...FAST_CONFIG,
        enableBackgroundRetry: true,
        backgroundRetryIntervalMs: 60000,
      });

      // Track how many times setInterval is called
      const originalSetInterval = globalThis.setInterval;
      let intervalCallCount = 0;
      const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation((...args) => {
        intervalCallCount++;
        return originalSetInterval(...(args as Parameters<typeof setInterval>));
      });

      // Load a server → triggers LoadingComplete (1st)
      await mgr.loadServer('srv-a', makeServerConfig());
      // Load another → triggers LoadingComplete again (2nd)
      await mgr.loadServer('srv-b', makeServerConfig());
      // Unload one → all remaining ready → LoadingComplete again (3rd)
      await mgr.unloadServer('srv-a');

      // Despite multiple LoadingComplete events only one interval should exist
      expect(intervalCallCount).toBe(1);

      spy.mockRestore();
      mgr.shutdown();
    });
  });
});
