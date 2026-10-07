import { Client } from '@modelcontextprotocol/client';
import { createMockInboundConnection, createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { setOutboundNotificationHandler } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { registerModernSubscriptions } from '@src/sdk/legacy/client/runtime/modernSubscriptions.js';
import {
  CancelledNotificationSchema,
  LoggingMessageNotificationSchema,
  ProgressNotificationSchema,
} from '@src/sdk/legacy/types.js';

import { describe, expect, it, vi } from 'vitest';

import { setupClientToServerNotifications } from './notificationHandlers.js';

vi.mock('@src/core/capabilities/capabilityPagination.js', () => ({
  registerCapabilityPaginationNotifications: vi.fn(),
}));
vi.mock('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js')>()),
  setOutboundNotificationHandler: vi.fn(),
}));
vi.mock('./requestInteractionScope.js', () => ({
  forwardScopedNotification: vi.fn(),
  ownsActiveInteraction: vi.fn(),
  registerLegacyNotificationOwner: vi.fn(),
}));
vi.mock('./resourceSubscriptions.js', () => ({
  enqueueOwnedCatalogNotification: vi.fn(),
  registerOwnedCatalogConnection: vi.fn(),
  setupOwnedResourceNotifications: vi.fn(),
}));

describe('modern catalog coverage for legacy connections', () => {
  it('leaves the SDK progress demultiplexer installed while registering logging and cancellation', async () => {
    vi.mocked(setOutboundNotificationHandler).mockClear();
    await setupClientToServerNotifications(new Map(), createMockInboundConnection());
    const { connections } = fixture();
    await setupClientToServerNotifications(connections, createMockInboundConnection());
    expect(setOutboundNotificationHandler).not.toHaveBeenCalledWith(
      expect.anything(),
      ProgressNotificationSchema,
      expect.anything(),
    );
    expect(setOutboundNotificationHandler).toHaveBeenCalledWith(
      expect.anything(),
      LoggingMessageNotificationSchema,
      expect.anything(),
    );
    expect(setOutboundNotificationHandler).toHaveBeenCalledWith(
      expect.anything(),
      CancelledNotificationSchema,
      expect.anything(),
    );
  });
  function fixture() {
    const connection = createMockOutboundConnection({
      name: 'modern-peer',
      adapter: { protocol: { era: 'modern', revision: '2026-07-28' } },
      capabilities: { tools: { listChanged: true }, resources: { listChanged: true, subscribe: true } },
    });
    const coverage = vi.fn(async () => ({ toolsListChanged: true }));
    registerModernSubscriptions(
      connection.adapter,
      new Client({ name: 'test', version: '1' }),
      {
        start: async () => {},
        close: async () => {},
        send: async () => {},
      },
      coverage,
    );
    return { connection, coverage, connections: new Map([['modern-peer', connection]]) };
  }

  it('downgrades declined catalog kinds while retaining accepted coverage and resource operations', async () => {
    const { connection, connections } = fixture();
    await expect(setupClientToServerNotifications(connections, createMockInboundConnection())).resolves.toBeUndefined();
    expect(connection.capabilities).toEqual({
      tools: { listChanged: true },
      resources: { listChanged: false, subscribe: true },
    });
  });

  it('does not request unselected catalog coverage for a resource-only bridge', async () => {
    const { coverage, connections } = fixture();
    await setupClientToServerNotifications(connections, createMockInboundConnection({ subscriptionListKinds: [] }));
    expect(coverage).not.toHaveBeenCalled();
  });

  it('does not apply a delayed acknowledgement to a replacement adapter', async () => {
    const { connection, coverage, connections } = fixture();
    let accept!: (filter: { toolsListChanged: boolean }) => void;
    coverage.mockReturnValueOnce(
      new Promise((resolve) => {
        accept = resolve;
      }),
    );
    const connecting = setupClientToServerNotifications(connections, createMockInboundConnection());
    const replacement = fixture().connection;
    Object.assign(connection, { adapter: replacement.adapter, capabilities: replacement.capabilities });
    accept({ toolsListChanged: true });
    await expect(connecting).rejects.toThrow('Catalog subscription coverage changed');
    expect(connection.capabilities).toBe(replacement.capabilities);
  });
});
