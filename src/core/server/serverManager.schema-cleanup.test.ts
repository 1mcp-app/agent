import {
  initializeSchemaBoundary,
  schemaBoundary,
  shutdownSchemaBoundary,
} from '@src/core/validation/schemaBoundary.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

const binding = { routeKey: 'server/tool', generation: '1' };
afterEach(async () => {
  await shutdownSchemaBoundary();
});

describe('ServerManager schema cleanup', () => {
  it('closes admission while connections drain and does not reopen it after cleanup', async () => {
    initializeSchemaBoundary();
    const boundary = schemaBoundary;
    await boundary.admit({ type: 'object' }, binding);
    let finishConnections!: () => void;
    const connectionCleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConnections = resolve;
        }),
    );
    const templateShutdown = vi.fn(async () => {
      await expect(schemaBoundary.admit({}, binding)).rejects.toThrow('schema_evaluation_unavailable');
    });
    const manager = Object.assign(Object.create(ServerManager.prototype), {
      connectionManager: { cleanup: connectionCleanup },
      templateServerManager: { shutdown: templateShutdown },
      templateConfigurationManager: { cleanup: vi.fn() },
      filterCache: { clear: vi.fn() },
    }) as ServerManager;
    const cleanup = manager.cleanup();
    expect(connectionCleanup).toHaveBeenCalledOnce();
    await expect(schemaBoundary.admit({}, binding)).rejects.toThrow('schema_evaluation_unavailable');
    finishConnections();
    await cleanup;
    expect(templateShutdown).toHaveBeenCalledOnce();
    expect(schemaBoundary).toBe(boundary);
    await expect(schemaBoundary.admit({}, binding)).rejects.toThrow('schema_evaluation_unavailable');
    // Only the explicit startup path can reopen admission.
    initializeSchemaBoundary();
    expect(schemaBoundary).not.toBe(boundary);
    await expect(schemaBoundary.admit({}, binding)).resolves.toBeDefined();
  });
});
