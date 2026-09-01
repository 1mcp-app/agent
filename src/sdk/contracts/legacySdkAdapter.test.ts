import type {
  LegacyConnectionId,
  LegacyRequestId,
  LegacySdkAdapter,
  LegacySdkEvent,
  LegacySdkNotification,
  LegacySdkRequest,
  LegacySdkResponse,
} from './legacySdkAdapter.js';
import { OneMcpProtocolError } from './oneMcpProtocolError.js';

function expectNoFunctions(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    expect(typeof value).not.toBe('function');
    return;
  }
  for (const property of Object.values(value)) expectNoFunctions(property);
}

describe('LegacySdkAdapter contract', () => {
  it('supports pull-based inbound events and explicit responses with local values', async () => {
    const connectionId = 'legacy-connection' as LegacyConnectionId;
    const requestId = 'legacy-request' as LegacyRequestId;
    const request: LegacySdkRequest = { id: requestId, method: 'tools/list', params: { cursor: null } };
    const notification: LegacySdkNotification = { method: 'notifications/initialized' };
    const events: LegacySdkEvent[] = [
      { type: 'request', request },
      { type: 'notification', notification },
      {
        type: 'failure',
        failure: { error: new OneMcpProtocolError(-32_603, 'legacy failure'), phase: 'notification' },
      },
      { type: 'closed' },
    ];
    let nextEventIndex = 0;
    const adapter: LegacySdkAdapter = {
      close: vi.fn(async () => undefined),
      connectionId,
      nextEvent: vi.fn(async () => events[nextEventIndex++] as LegacySdkEvent),
      notify: vi.fn(async () => undefined),
      request: vi.fn(async () => ({ tools: [] })),
      respond: vi.fn(async () => undefined),
      start: vi.fn(async () => undefined),
      state: 'idle',
    };

    await adapter.start();
    for (const expectedEvent of events) {
      const event = await adapter.nextEvent();
      expect(event).toBe(expectedEvent);
      expectNoFunctions(event);
    }

    const responses: LegacySdkResponse[] = [
      { type: 'success', requestId, result: { tools: [] } },
      { type: 'error', requestId, error: new OneMcpProtocolError(-32_601, 'Method not found') },
    ];
    for (const response of responses) {
      expectNoFunctions(response);
      await adapter.respond(response);
    }

    await expect(adapter.request(request)).resolves.toEqual({ tools: [] });
    await adapter.notify(notification);
    await adapter.close();

    expect(adapter.start).toHaveBeenCalledWith();
    expect(adapter.nextEvent).toHaveBeenCalledTimes(events.length);
    expect(adapter.respond).toHaveBeenNthCalledWith(1, responses[0]);
    expect(adapter.respond).toHaveBeenNthCalledWith(2, responses[1]);
    expect(adapter.request).toHaveBeenCalledWith(request);
    expect(adapter.notify).toHaveBeenCalledWith(notification);
    expect(adapter.close).toHaveBeenCalledOnce();
  });
});
