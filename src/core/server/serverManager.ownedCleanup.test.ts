import { ServerManager } from '@src/core/server/serverManager.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

function fixture() {
  const connectionCleanup = vi.fn(async () => undefined);
  const templateShutdown = vi.fn(async () => undefined);
  const manager = Object.create(ServerManager.prototype) as ServerManager;
  Object.assign(manager, {
    cleanupCallbacks: new Set(),
    ownedCleanupCallbacks: new Set(),
    connectionManager: { cleanup: connectionCleanup },
    templateServerManager: { shutdown: templateShutdown },
    templateConfigurationManager: { cleanup: vi.fn() },
    filterCache: new Map(),
  });
  return { manager, connectionCleanup, templateShutdown };
}

afterEach(() => vi.useRealTimers());

describe('owned runtime cleanup', () => {
  it('awaits a two-second owned process termination while preserving the one-second unrelated callback limit', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let ownedSettled = false;
    f.manager.registerOwnedCleanup(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      ownedSettled = true;
    });
    f.manager.registerCleanup(() => new Promise(() => undefined));
    let finished = false;
    const cleanup = f.manager.cleanup().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.connectionCleanup).toHaveBeenCalledOnce();
    expect(f.templateShutdown).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    expect(ownedSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    await cleanup;
    expect(ownedSettled).toBe(true);
    expect(finished).toBe(true);
  });
  it('runs remaining owned settlement and connection cleanup before reporting an owned failure', async () => {
    const f = fixture();
    let settled = false;
    f.manager.registerOwnedCleanup(async () => {
      throw new Error('owned process shutdown failed');
    });
    f.manager.registerOwnedCleanup(async () => {
      settled = true;
    });
    await expect(f.manager.cleanup()).rejects.toBeInstanceOf(AggregateError);
    expect(settled).toBe(true);
    expect(f.connectionCleanup).toHaveBeenCalledOnce();
    expect(f.templateShutdown).toHaveBeenCalledOnce();
  });
  it('supports unregistering an owned callback without changing ordinary cleanup registration', async () => {
    const f = fixture();
    const callback = vi.fn(async () => undefined);
    f.manager.registerOwnedCleanup(callback)();
    const ordinary = vi.fn(async () => undefined);
    f.manager.registerCleanup(ordinary);
    await f.manager.cleanup();
    expect(callback).not.toHaveBeenCalled();
    expect(ordinary).toHaveBeenCalledOnce();
  });
});
