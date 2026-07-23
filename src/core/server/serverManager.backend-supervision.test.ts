import logger from '@src/logger/logger.js';

import { describe, expect, it, vi } from 'vitest';

import { ServerManager } from './serverManager.js';

vi.mock('@src/logger/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  debugIf: vi.fn(),
}));

describe('ServerManager backend supervision notifications', () => {
  it('isolates refresh and per-client notification failures', async () => {
    const refreshCapabilities = vi.fn().mockRejectedValue(new Error('refresh failed'));
    const failingNotification = vi.fn().mockRejectedValue(new Error('client disconnected'));
    const healthyNotification = vi.fn().mockResolvedValue(undefined);
    const manager = Object.create(ServerManager.prototype) as {
      lazyLoadingOrchestrator: { refreshCapabilities: typeof refreshCapabilities };
      connectionManager: {
        getInboundConnections: () => Map<string, unknown>;
      };
    };
    manager.lazyLoadingOrchestrator = { refreshCapabilities };
    manager.connectionManager = {
      getInboundConnections: () =>
        new Map([
          ['disconnected', { server: { transport: {}, notification: failingNotification } }],
          ['healthy', { server: { transport: {}, notification: healthyNotification } }],
        ]),
    };

    await expect(ServerManager.prototype.notifyBackendCapabilityListsChanged.call(manager)).resolves.toBeUndefined();

    expect(refreshCapabilities).toHaveBeenCalledTimes(1);
    expect(failingNotification).toHaveBeenCalledTimes(3);
    expect(healthyNotification).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith('Failed to refresh lazy backend capabilities: refresh failed');
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to send notifications/tools/list_changed to an inbound client: client disconnected',
    );
  });
});
