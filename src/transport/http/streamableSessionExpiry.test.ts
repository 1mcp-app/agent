import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FileStorageService } from '@src/auth/storage/fileStorageService.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import { StreamableSessionRepository } from '@src/transport/http/storage/streamableSessionRepository.js';
import { StreamableSessionLifecycle, StreamableSessionStatus } from '@src/transport/http/streamableSessionLifecycle.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe.each([false, true])('Streamable idle expiry (persistence=%s)', (sessionPersistence) => {
  let directory: string;
  let storage: FileStorageService;
  let repository: StreamableSessionRepository;
  let lifecycle: StreamableSessionLifecycle;
  const transports = new Map();
  const disconnect = vi.fn();
  const connect = vi.fn();
  let shutdown: () => Promise<void>;
  const sessionId = 'stream-01234567-1234-4234-8234-0123456789ab';

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    vi.spyOn(AgentConfigManager.getInstance(), 'getSessionTtlMinutes').mockReturnValue(1);
    const originalGet = AgentConfigManager.getInstance().get.bind(AgentConfigManager.getInstance());
    vi.spyOn(AgentConfigManager.getInstance(), 'get').mockImplementation((key) => {
      if (key === 'features') return { ...originalGet('features'), sessionPersistence };
      return originalGet(key);
    });
    directory = mkdtempSync(join(tmpdir(), '1mcp-expiry-'));
    storage = new FileStorageService(directory, 'transport', { manageLifecycle: false });
    repository = new StreamableSessionRepository(storage);
    transports.clear();
    disconnect.mockReset().mockImplementation(async (id) => {
      const transport = transports.get(id);
      transports.delete(id);
      transport?.onclose?.();
    });
    connect.mockReset().mockImplementation(async (transport, id) => {
      transports.set(id, transport);
    });
    const manager = {
      getTransport: (id: string) => transports.get(id),
      getServer: () => undefined,
      connectTransport: connect,
      registerCleanup: (cleanup: () => Promise<void>) => {
        shutdown = cleanup;
      },
      disconnectTransport: disconnect,
    } as unknown as ServerManager;
    lifecycle = new StreamableSessionLifecycle(manager, repository, undefined, {
      createTransport: ((id: string) => ({ sessionId: id })) as never,
      isStreamableTransport: (() => true) as never,
    });
    await lifecycle.createSession({}, undefined, sessionId);
  });

  afterEach(() => {
    repository.stopPeriodicFlush();
    vi.restoreAllMocks();
    vi.useRealTimers();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reclaims abandoned live, cached, and disk state on the background sweep', async () => {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
    expect(transports.has(sessionId)).toBe(false);
    expect(repository.getSessionData(sessionId)).toBeNull();
    const restarted = new StreamableSessionRepository(storage);
    expect(restarted.getSessionData(sessionId)).toBeNull();
    restarted.stopPeriodicFlush();
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
  });

  it('rejects expired cache hits before the next sweep and cannot restore an expired disk record', async () => {
    vi.setSystemTime(Date.now() + 60_001);
    expect(repository.getSessionData(sessionId)).toBeNull();
    expect(repository.get(sessionId)).toBeNull();
    const restarted = new StreamableSessionRepository(storage);
    expect(restarted.getSessionData(sessionId)).toBeNull();
    restarted.stopPeriodicFlush();
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
  });

  it('renews authorized activity but rejects other bindings without extending the deadline', async () => {
    vi.setSystemTime(Date.now() + 40_000);
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Active);
    vi.setSystemTime(Date.now() + 40_000);
    expect((await lifecycle.resolveExistingSession(sessionId, null)).status).toBe(StreamableSessionStatus.Missing);
    await lifecycle.expireIdleSessions();
    expect(disconnect).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 20_000);
    await lifecycle.expireIdleSessions();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('protects overlapping long requests and silent streams until all protection ends', async () => {
    const finishRequest = lifecycle.protectSession(sessionId);
    const closeStream = lifecycle.protectSession(sessionId);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(repository.getSessionData(sessionId)).not.toBeNull();
    expect(disconnect).not.toHaveBeenCalled();
    finishRequest();
    finishRequest();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(disconnect).not.toHaveBeenCalled();
    closeStream();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
  });

  it('does not renew rejected work and retires once when a request races DELETE and expiry', async () => {
    const rejectRequest = lifecycle.protectSession(sessionId);
    vi.setSystemTime(Date.now() + 60_000);
    rejectRequest(false);
    let finishCleanup!: () => void;
    disconnect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const sweep = lifecycle.expireIdleSessions();
    const deletion = lifecycle.completeExplicitDelete(sessionId);
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
    expect(() => lifecycle.protectSession(sessionId)).toThrow('no longer active');
    finishCleanup();
    await Promise.all([sweep, deletion]);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
  });
  it('keeps failed cleanup retired without accepting work on an unresolved transport', async () => {
    vi.setSystemTime(Date.now() + 60_000);
    disconnect.mockRejectedValue(new Error('upstream cleanup unresolved'));
    await lifecycle.expireIdleSessions();
    expect(transports.has(sessionId)).toBe(true);
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
    expect(() => lifecycle.protectSession(sessionId)).toThrow('no longer active');
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('protects and serializes restoration while the idle sweep runs', async () => {
    repository.storeInitializeResponse(sessionId, {
      protocolVersion: '2025-11-25',
      capabilities: {},
      serverInfo: { name: 'test', version: '1' },
    });
    transports.delete(sessionId);
    let finish!: () => void;
    connect.mockImplementation(async (transport, id) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      transports.set(id, transport);
    });
    const first = lifecycle.resolveExistingSession(sessionId);
    const second = lifecycle.resolveExistingSession(sessionId);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(disconnect).not.toHaveBeenCalled();
    finish();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status)).toEqual([
      StreamableSessionStatus.Restored,
      StreamableSessionStatus.Restored,
    ]);
    expect(connect).toHaveBeenCalledTimes(2); // Initial creation plus one shared restoration.
    expect(repository.getSessionData(sessionId)).not.toBeNull();
  });

  it('closes admission on shutdown while a sweep settles without double release', async () => {
    vi.setSystemTime(Date.now() + 60_000);
    const sweep = lifecycle.expireIdleSessions();
    await shutdown();
    await sweep;
    expect(disconnect).toHaveBeenCalledOnce();
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
    await expect(lifecycle.createSession({})).rejects.toThrow('admission is closed');
  });
  it('does not let an old response renew or disconnect a replacement session with the same ID', async () => {
    const oldTransport = transports.get(sessionId);
    const finishOld = lifecycle.protectSession(sessionId);
    await lifecycle.completeExplicitDelete(sessionId);
    await lifecycle.createSession({}, undefined, sessionId);
    vi.setSystemTime(Date.now() + 60_000);
    finishOld();
    oldTransport.onclose();
    await lifecycle.expireIdleSessions();
    expect(disconnect).toHaveBeenCalledTimes(2); // DELETE of the old generation and expiry of its replacement.
    expect(transports.has(sessionId)).toBe(false);
  });
  it('shares transport-close cleanup with a racing DELETE and rejects initialization until settlement', async () => {
    let finish!: () => void;
    disconnect.mockImplementation(async (id) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      transports.delete(id);
    });
    const closing = lifecycle.handleAbnormalDisconnect(sessionId);
    const deletion = lifecycle.completeExplicitDelete(sessionId);
    await Promise.resolve();
    const result = await lifecycle.resolvePostSession({
      sessionId,
      isInitializeRequest: true,
      createSessionData: () => ({ config: {} }),
    });
    expect(result.status).toBe(StreamableSessionStatus.Missing);
    expect(connect).toHaveBeenCalledOnce();
    finish();
    await Promise.all([closing, deletion]);
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(repository.getSessionData(sessionId)).toBeNull();
  });
  it.each([false, true])(
    'keeps protected disk state restorable, then restores idle expiry (accepted=%s)',
    async (accepted) => {
      const close = lifecycle.protectSession(sessionId);
      await vi.advanceTimersByTimeAsync(360_000);
      storage.cleanupExpiredData();
      const restartedWhileProtected = new StreamableSessionRepository(storage);
      const persisted = restartedWhileProtected.getSessionData(sessionId);
      if (sessionPersistence) expect(persisted?.expires).toBeGreaterThan(Date.now());
      else expect(persisted).toBeNull();
      restartedWhileProtected.stopPeriodicFlush();
      expect(disconnect).not.toHaveBeenCalled();
      close(accepted);
      const restartedAfterClose = new StreamableSessionRepository(storage);
      const afterClose = restartedAfterClose.getSessionData(sessionId);
      if (sessionPersistence && accepted) expect(afterClose?.expires).toBe(Date.now() + 60_000);
      else expect(afterClose).toBeNull();
      restartedAfterClose.stopPeriodicFlush();
      if (accepted) await vi.advanceTimersByTimeAsync(60_000);
      await lifecycle.expireIdleSessions();
      expect(disconnect).toHaveBeenCalledOnce();
    },
  );

  if (sessionPersistence) {
    it('keeps deletion retired when a valid disk restoration record cannot be removed', async () => {
      repository.storeInitializeResponse(sessionId, {
        protocolVersion: '2025-11-25',
        capabilities: {},
        serverInfo: { name: 'test', version: '1' },
      });
      vi.spyOn(storage, 'deleteData').mockImplementation(() => {
        throw new Error('disk deletion denied');
      });
      await expect(lifecycle.completeExplicitDelete(sessionId)).rejects.toThrow('disk deletion denied');
      expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
      const restarted = new StreamableSessionRepository(storage);
      expect(restarted.getSessionData(sessionId)).not.toBeNull(); // The valid file actually remains.
      restarted.stopPeriodicFlush();
      expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
      expect(connect).toHaveBeenCalledOnce();
    });
  }

  it('treats already absent disk state as a successful idempotent deletion', async () => {
    if (sessionPersistence) storage.deleteData(AUTH_CONFIG.SERVER.STREAMABLE_SESSION.FILE_PREFIX, sessionId);
    await expect(lifecycle.completeExplicitDelete(sessionId)).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledExactlyOnceWith(sessionId, true);
    expect((await lifecycle.resolveExistingSession(sessionId)).status).toBe(StreamableSessionStatus.Missing);
  });

  it.each([0, -1, NaN, 0.000001])('bounds the background cadence for tiny or invalid TTL %s', async (ttl) => {
    vi.mocked(AgentConfigManager.getInstance().getSessionTtlMinutes).mockReturnValue(ttl);
    const guarded = new StreamableSessionRepository(storage);
    const sweeps = vi.spyOn(guarded, 'getExpiredSessionIds');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweeps.mock.calls.length).toBeLessThanOrEqual(60);
    expect(sweeps).toHaveBeenCalled();
    guarded.stopPeriodicFlush();
  });
});
