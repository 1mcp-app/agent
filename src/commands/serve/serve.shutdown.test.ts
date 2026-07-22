import { ClientManager } from '@src/core/client/clientManager.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { setupGracefulShutdown } from './serve.js';

vi.mock('@src/core/client/clientManager.js', () => ({
  ClientManager: {
    shutdownCurrent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@src/domains/preset/manager/presetManager.js', () => ({
  PresetManager: {
    getInstance: vi.fn(() => ({ cleanup: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock('@src/core/server/pidFileManager.js', () => ({
  cleanupPidFileOnExit: vi.fn(),
  registerPidFileCleanup: vi.fn(),
  writePidFile: vi.fn(),
}));

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('serve graceful shutdown', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops backend clients before exiting and coalesces repeated signals', async () => {
    let finishServerCleanup!: () => void;
    const serverCleanup = new Promise<void>((resolve) => {
      finishServerCleanup = resolve;
    });
    const handlers = new Map<string, () => Promise<void>>();
    vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => Promise<void>) => {
      handlers.set(event, listener);
      return process;
    }) as typeof process.on);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const loadingManager = { shutdown: vi.fn() };
    const serverManager = {
      cleanup: vi.fn(() => serverCleanup),
      getTransports: vi.fn(() => new Map()),
    };

    setupGracefulShutdown(serverManager as never, loadingManager as never);
    const shutdown = handlers.get('SIGTERM');
    expect(shutdown).toBeDefined();

    const firstShutdown = shutdown!();
    const repeatedShutdown = shutdown!();

    await vi.waitFor(() => expect(serverManager.cleanup).toHaveBeenCalledTimes(1));
    expect(exit).not.toHaveBeenCalled();

    finishServerCleanup();
    await Promise.all([firstShutdown, repeatedShutdown]);

    expect(loadingManager.shutdown).toHaveBeenCalledTimes(1);
    expect(ClientManager.shutdownCurrent).toHaveBeenCalledTimes(1);
    expect(serverManager.cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(vi.mocked(ClientManager.shutdownCurrent).mock.invocationCallOrder[0]).toBeLessThan(
      exit.mock.invocationCallOrder[0],
    );
  });
});
