import { describe, expect, it, vi } from 'vitest';

import { createEffectiveRequestAuthority, createGatewayRequestEnvelope } from '../contracts/index.js';
import type { InboundEraAdapter, InboundGatewayEvent, OutboundEraAdapter } from '../ports/index.js';
import { GatewayDispatcher } from './gatewayDispatcher.js';
import { GatewaySession } from './gatewaySession.js';

describe('GatewaySession', () => {
  it('continues reading inbound events while a request is pending and forwards cancellation', async () => {
    let resolveRequest!: (value: { tools: never[] }) => void;
    const cancel = vi.fn(async () => resolveRequest({ tools: [] }));
    const outbound: OutboundEraAdapter = {
      role: 'outbound',
      pin: Object.freeze({ era: 'modern', revision: '2026-07-28' }),
      request: async () => new Promise((resolve) => (resolveRequest = resolve)),
      cancel,
      async close() {},
    };
    const request = createGatewayRequestEnvelope({
      requestId: 'request-1',
      operation: 'tools/list',
      targetConnectionId: 'backend',
      authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
      inbound: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
      outbound: outbound.pin,
      deadlineUnixMs: 2_000,
    });
    const events: InboundGatewayEvent[] = [
      Object.freeze({ type: 'request', request }),
      Object.freeze({ type: 'cancel', requestId: request.requestId }),
      Object.freeze({ type: 'closed' }),
    ];
    const respond = vi.fn(async () => undefined);
    const inbound: InboundEraAdapter = {
      role: 'inbound',
      pin: request.inbound,
      async nextEvent() {
        return events.shift()!;
      },
      respond,
      async close() {},
    };
    const session = new GatewaySession(new GatewayDispatcher({ resolveOutbound: () => outbound, now: () => 1_000 }));

    await session.run(inbound);

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith('request-1');
    expect(respond).toHaveBeenCalledWith({ type: 'success', requestId: 'request-1', result: { tools: [] } });
  });
});
