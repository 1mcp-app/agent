import {
  createEffectiveRequestAuthority,
  createGatewayFailure,
  createGatewayRequestEnvelope,
  type ProtocolEraPin,
} from '../../contracts/index.js';
import type { InboundGatewayEvent, InboundGatewayResponse } from '../../ports/index.js';
import { type LegacyInboundChannel, LegacyInboundEraAdapter } from './legacyInboundEraAdapter.js';

const LEGACY_PIN = Object.freeze({ era: 'legacy', revision: '2025-11-25' }) satisfies ProtocolEraPin;

function channel(event: InboundGatewayEvent) {
  const responses: InboundGatewayResponse[] = [];
  const value: LegacyInboundChannel = {
    nextEvent: vi.fn().mockResolvedValue(event),
    respond: vi.fn(async (response) => void responses.push(response)),
    close: vi.fn(),
  };
  return { value, responses };
}

describe('LegacyInboundEraAdapter', () => {
  it('copies inbound requests and outbound responses through immutable JSON boundaries', async () => {
    const original = createGatewayRequestEnvelope({
      requestId: 'request-1',
      operation: 'tools/list',
      targetConnectionId: 'backend',
      params: { cursor: 'next' },
      authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
      inbound: LEGACY_PIN,
      outbound: LEGACY_PIN,
      deadlineUnixMs: 2_000,
    });
    const fixture = channel(Object.freeze({ type: 'request', request: original }));
    const adapter = new LegacyInboundEraAdapter(fixture.value, LEGACY_PIN);

    const event = await adapter.nextEvent();
    expect(event).toEqual({ type: 'request', request: original });
    if (event.type !== 'request') throw new Error('Expected request event');
    expect(event.request).not.toBe(original);

    const result = { tools: [{ name: 'echo' }] };
    await adapter.respond({ type: 'success', requestId: 'request-1', result });
    expect(fixture.responses).toEqual([{ type: 'success', requestId: 'request-1', result }]);
    if (fixture.responses[0]?.type !== 'success') throw new Error('Expected success response');
    expect(fixture.responses[0].result).not.toBe(result);
    expect(Object.isFrozen(fixture.responses[0])).toBe(true);
  });

  it('copies plain failure events and responses without exposing transport objects', async () => {
    const failure = createGatewayFailure({
      kind: 'protocol',
      code: 'legacy_failure',
      message: 'Legacy request failed',
      data: { safe: true },
    });
    const fixture = channel(Object.freeze({ type: 'failure', failure }));
    const adapter = new LegacyInboundEraAdapter(fixture.value, LEGACY_PIN);

    await expect(adapter.nextEvent()).resolves.toEqual({ type: 'failure', failure });
    await adapter.respond({ type: 'failure', requestId: 'request-1', failure });

    expect(fixture.responses).toEqual([{ type: 'failure', requestId: 'request-1', failure }]);
    expect(Object.getPrototypeOf(fixture.responses[0])).toBe(Object.prototype);
  });

  it('rejects an event that conflicts with the inbound legacy pin', async () => {
    const event = Object.freeze({
      type: 'request' as const,
      request: createGatewayRequestEnvelope({
        requestId: 'request-1',
        operation: 'tools/list',
        targetConnectionId: 'backend',
        authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
        inbound: Object.freeze({ era: 'legacy', revision: '2025-06-18' }),
        outbound: LEGACY_PIN,
        deadlineUnixMs: 2_000,
      }),
    });
    const fixture = channel(event);
    const adapter = new LegacyInboundEraAdapter(fixture.value, LEGACY_PIN);

    await expect(adapter.nextEvent()).rejects.toMatchObject({ code: 'gateway_inbound_pin_mismatch' });
  });

  it('converts foreign channel errors to plain gateway failure data', async () => {
    class ForeignError extends Error {
      code = 503;
    }
    const fixture = channel(Object.freeze({ type: 'closed' }));
    vi.mocked(fixture.value.nextEvent).mockRejectedValue(new ForeignError('Unavailable'));
    const adapter = new LegacyInboundEraAdapter(fixture.value, LEGACY_PIN);

    const failure = await adapter.nextEvent().catch((error: unknown) => error);
    expect(failure).toEqual({ kind: 'transport', code: '503', message: 'Unavailable' });
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
  });

  it('accepts only an immutable legacy protocol pin', () => {
    const fixture = channel(Object.freeze({ type: 'closed' }));
    const adapter = new LegacyInboundEraAdapter(fixture.value, { ...LEGACY_PIN });

    expect(Object.isFrozen(adapter.pin)).toBe(true);
    expect(() => new LegacyInboundEraAdapter(fixture.value, { era: 'modern', revision: '2026-07-28' })).toThrow(
      'require a legacy protocol era pin',
    );
  });
});
