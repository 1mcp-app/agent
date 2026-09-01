import type {
  LegacyConnectionId,
  LegacyRequestId,
  LegacySdkAdapter,
  LegacySdkAdapterEvents,
  LegacySdkNotification,
  LegacySdkRequest,
} from './legacySdkAdapter.js';

describe('LegacySdkAdapter contract', () => {
  it('supports request, notification, lifecycle, and failure contracts with local values', async () => {
    const connectionId = 'legacy-connection' as LegacyConnectionId;
    const requestId = 'legacy-request' as LegacyRequestId;
    const events: LegacySdkAdapterEvents = {
      onClose: vi.fn(),
      onFailure: vi.fn(),
      onNotification: vi.fn(),
    };
    const request: LegacySdkRequest = { id: requestId, method: 'tools/list', params: { cursor: null } };
    const notification: LegacySdkNotification = { method: 'notifications/initialized' };
    const adapter: LegacySdkAdapter = {
      close: vi.fn(async () => undefined),
      connectionId,
      notify: vi.fn(async () => undefined),
      request: vi.fn(async () => ({ tools: [] })),
      start: vi.fn(async () => undefined),
      state: 'idle',
    };

    await adapter.start(events);
    await expect(adapter.request(request)).resolves.toEqual({ tools: [] });
    await adapter.notify(notification);
    await adapter.close();

    expect(adapter.start).toHaveBeenCalledWith(events);
    expect(adapter.request).toHaveBeenCalledWith(request);
    expect(adapter.notify).toHaveBeenCalledWith(notification);
    expect(adapter.close).toHaveBeenCalledOnce();
  });
});
