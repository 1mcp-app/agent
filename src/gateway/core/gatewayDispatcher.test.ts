import { describe, expect, it, vi } from 'vitest';

import {
  createEffectiveRequestAuthority,
  createGatewayFailure,
  createGatewayRequestEnvelope,
  type ImmutableJsonValue,
  type ProtocolEraPin,
} from '../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../ports/index.js';
import { GatewayDispatcher } from './gatewayDispatcher.js';

function adapter(pin: ProtocolEraPin, response: ImmutableJsonValue = { tools: [] }) {
  const requests: OutboundGatewayRequest[] = [];
  const cancellations: string[] = [];
  let resolveRequest: ((value: ImmutableJsonValue) => void) | undefined;
  const port: OutboundEraAdapter = {
    role: 'outbound',
    pin,
    async request(request) {
      requests.push(request);
      if (request.params === 'pending') return new Promise((resolve) => (resolveRequest = resolve));
      return response;
    },
    async cancel(requestId) {
      cancellations.push(requestId);
      resolveRequest?.(response);
    },
    async close() {},
  };
  return { port, requests, cancellations };
}

function request(
  outbound: ProtocolEraPin,
  overrides: Partial<Parameters<typeof createGatewayRequestEnvelope>[0]> = {},
) {
  return createGatewayRequestEnvelope({
    requestId: 'request-1',
    operation: 'tools/list',
    targetConnectionId: 'backend',
    authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
    inbound: Object.freeze({ era: 'legacy', revision: '2025-11-25' }),
    outbound,
    deadlineUnixMs: 2_000,
    ...overrides,
  });
}

describe('GatewayDispatcher', () => {
  it('dispatches a frozen read-only request without extending its absolute deadline', async () => {
    const fixture = adapter(Object.freeze({ era: 'modern', revision: '2026-07-28' }));
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 });

    const result = await dispatcher.dispatch(request(fixture.port.pin));

    expect(result).toEqual({ ok: true, value: { tools: [] } });
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0].deadlineUnixMs).toBe(2_000);
    expect(Object.isFrozen(fixture.requests[0])).toBe(true);
  });

  it('rejects unauthorized, expired, and mismatched requests before outbound dispatch', async () => {
    const fixture = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 2_000 });

    await expect(
      dispatcher.dispatch(
        request(fixture.port.pin, { authority: createEffectiveRequestAuthority({ connectionIds: [] }) }),
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'gateway_target_not_authorized' } });
    await expect(dispatcher.dispatch(request(fixture.port.pin))).resolves.toMatchObject({
      ok: false,
      failure: { code: 'gateway_deadline_exceeded' },
    });
    await expect(
      new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 }).dispatch(
        request(Object.freeze({ era: 'modern', revision: '2026-07-28' })),
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'gateway_outbound_pin_mismatch' } });
    expect(fixture.requests).toHaveLength(0);
  });

  it('propagates cancellation by gateway request id', async () => {
    const fixture = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 });
    const pending = dispatcher.dispatch(request(fixture.port.pin, { params: 'pending' }));

    await vi.waitFor(() => expect(fixture.requests).toHaveLength(1));
    await expect(dispatcher.cancel('request-1')).resolves.toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(fixture.cancellations).toEqual(['request-1']);
    await expect(dispatcher.cancel('request-1')).resolves.toBe(false);
  });

  it('converts foreign adapter errors to plain gateway failure data', async () => {
    class ForeignError extends Error {
      code = -32_601;
      data = { safe: true };
    }
    const fixture = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    fixture.port.request = async () => {
      throw new ForeignError('foreign');
    };
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 });

    const result = await dispatcher.dispatch(request(fixture.port.pin));
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'transport', code: '-32601', message: 'Gateway transport failure' },
    });
    if (!result.ok) expect(Object.getPrototypeOf(result.failure)).toBe(Object.prototype);
  });

  it('preserves a validated plain failure raised at the outbound boundary', async () => {
    const fixture = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    fixture.port.request = async () => {
      throw createGatewayFailure({
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'expired at edge',
      });
    };
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 });

    await expect(dispatcher.dispatch(request(fixture.port.pin))).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'expired at edge',
      },
    });
  });

  it('does not trust foreign failure kinds or accessors', async () => {
    const fixture = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    fixture.port.request = async () => {
      const foreign = { kind: 'authorization', code: 'foreign' };
      Object.defineProperty(foreign, 'message', { get: () => Promise.reject(new Error('getter ran')) });
      throw foreign;
    };
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1_000 });

    await expect(dispatcher.dispatch(request(fixture.port.pin))).resolves.toEqual({
      ok: false,
      failure: { kind: 'transport', code: 'gateway_transport_error', message: 'Gateway transport failure' },
    });
  });

  it('rejects concurrent duplicate ids without replacing cancellation ownership', async () => {
    const first = adapter(Object.freeze({ era: 'legacy', revision: '2025-11-25' }));
    const second = adapter(Object.freeze({ era: 'modern', revision: '2026-07-28' }));
    const dispatcher = new GatewayDispatcher({
      resolveOutbound: (connectionId) => (connectionId === 'backend' ? first.port : second.port),
      now: () => 1_000,
    });
    const pending = dispatcher.dispatch(request(first.port.pin, { params: 'pending' }));
    await vi.waitFor(() => expect(first.requests).toHaveLength(1));

    await expect(
      dispatcher.dispatch(
        request(second.port.pin, {
          targetConnectionId: 'other',
          authority: createEffectiveRequestAuthority({ connectionIds: ['other'] }),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, failure: { code: 'gateway_request_already_active' } });
    await expect(dispatcher.cancel('request-1')).resolves.toBe(true);
    await pending;
    expect(first.cancellations).toEqual(['request-1']);
    expect(second.requests).toHaveLength(0);
  });
});

describe('Tool dispatch ownership', () => {
  const pins: ProtocolEraPin[] = [
    { era: 'legacy', revision: '2025-11-25' },
    { era: 'modern', revision: '2026-07-28' },
  ];
  for (const inbound of pins)
    for (const outbound of pins) {
      it(`${inbound.era} -> ${outbound.era} never repeats an interrupted operation`, async () => {
        let sideEffects = 0;
        const fixture = adapter(outbound);
        fixture.port.request = vi.fn(async () => {
          sideEffects++;
          throw new Error('secret argument and credential');
        });
        const dispatcher = new GatewayDispatcher({ resolveOutbound: () => fixture.port, now: () => 1000 });
        const operation = request(outbound, { inbound, operation: 'tools/call' });
        await expect(dispatcher.dispatch(operation)).resolves.toMatchObject({
          ok: false,
          failure: { code: 'gateway_tool_outcome_unknown' },
        });
        await expect(dispatcher.dispatch(operation)).resolves.toMatchObject({
          ok: false,
          failure: { code: 'gateway_request_already_active' },
        });
        expect(sideEffects).toBe(1);
        // A new operation may reuse the completed wire ID.
        await dispatcher.dispatch(request(outbound, { inbound, operation: 'tools/call' }));
        expect(sideEffects).toBe(2);
      });
    }
  it('allows retry only when no outbound adapter was invoked and bounds active operations', async () => {
    const fixture = adapter(pins[0]);
    let ready = false;
    const dispatcher = new GatewayDispatcher({
      resolveOutbound: () => (ready ? fixture.port : undefined),
      now: () => 1000,
      maxActiveRequests: 1,
    });
    const operation = request(pins[0], { params: 'pending' });
    await expect(dispatcher.dispatch(operation)).resolves.toMatchObject({
      ok: false,
      failure: { code: 'gateway_target_unavailable' },
    });
    ready = true;
    const pending = dispatcher.dispatch(operation);
    await expect(dispatcher.dispatch(request(pins[0], { requestId: 'second' }))).resolves.toMatchObject({
      ok: false,
      failure: { code: 'gateway_overloaded' },
    });
    expect(fixture.requests).toHaveLength(1);
    await dispatcher.cancel(operation.requestId);
    await pending;
  });
});
