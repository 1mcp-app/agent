import {
  createEffectiveRequestAuthority,
  createGatewayRequestEnvelope,
  GatewayDispatcher,
  type GatewayRequestEnvelope,
  type ImmutableJsonValue,
  type InboundEraAdapter,
  type InboundGatewayEvent,
  type InboundGatewayResponse,
  LegacyInboundEraAdapter,
  LegacyOutboundEraAdapter,
  ModernInboundEraAdapter,
  ModernOutboundEraAdapter,
  type OutboundEraAdapter,
  type ProtocolEra,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '@src/gateway/index.js';
import type {
  LegacyConnectionId,
  LegacyRequestId,
  LegacySdkAdapter,
  LegacySdkEvent,
  LegacySdkNotification,
  LegacySdkRequest,
  LegacySdkResponse,
} from '@src/sdk/contracts/index.js';

import { describe, expect, it } from 'vitest';

const ERA_CELLS = [
  ['legacy', 'legacy'],
  ['legacy', 'modern'],
  ['modern', 'legacy'],
  ['modern', 'modern'],
] as const satisfies ReadonlyArray<readonly [ProtocolEra, ProtocolEra]>;

const revisionByEra = {
  legacy: '2025-11-25',
  modern: '2026-07-28',
} as const;

function pin(era: ProtocolEra): ProtocolEraPin {
  return Object.freeze({ era, revision: revisionByEra[era] });
}

function legacySdkAdapter(observed: LegacySdkRequest[]): LegacySdkAdapter {
  return {
    connectionId: 'legacy-fixture' as LegacyConnectionId,
    state: 'running',
    async start() {},
    async nextEvent(): Promise<LegacySdkEvent> {
      return { type: 'closed' };
    },
    async respond(_response: LegacySdkResponse) {},
    async request(request) {
      observed.push(request);
      return { tools: [{ name: 'fixture-tool', inputSchema: { type: 'object' } }] };
    },
    async cancel(_requestId: LegacyRequestId) {},
    async notify(_notification: LegacySdkNotification) {},
    async close() {},
  };
}

function createOutbound(era: ProtocolEra, observed: unknown[]): OutboundEraAdapter {
  if (era === 'legacy') {
    return new LegacyOutboundEraAdapter(legacySdkAdapter(observed as LegacySdkRequest[]), pin(era), {
      now: () => 1_000,
    });
  }
  return new ModernOutboundEraAdapter({
    revision: revisionByEra.modern,
    async request(frame) {
      observed.push(frame);
      return { tools: [{ name: 'fixture-tool', inputSchema: { type: 'object' } }] };
    },
    async cancel() {},
  });
}

function frame(request: GatewayRequestEnvelope): ImmutableJsonValue {
  return toImmutableJsonValue({
    type: 'request',
    requestId: request.requestId,
    operation: request.operation,
    targetConnectionId: request.targetConnectionId,
    ...(request.params === undefined ? {} : { params: request.params }),
    authority: request.authority,
    outbound: request.outbound,
    deadlineUnixMs: request.deadlineUnixMs,
  });
}

function createInbound(era: ProtocolEra, request: GatewayRequestEnvelope, responses: unknown[]): InboundEraAdapter {
  if (era === 'legacy') {
    let delivered = false;
    return new LegacyInboundEraAdapter(
      {
        async nextEvent(): Promise<InboundGatewayEvent> {
          if (delivered) return Object.freeze({ type: 'closed' });
          delivered = true;
          return Object.freeze({ type: 'request', request });
        },
        async respond(response) {
          responses.push(response);
        },
        async close() {},
      },
      pin(era),
    );
  }

  let delivered = false;
  return new ModernInboundEraAdapter({
    revision: revisionByEra.modern,
    async receive() {
      if (delivered) return undefined;
      delivered = true;
      return frame(request);
    },
    async respond(response) {
      responses.push(response);
    },
  });
}

function responseFor(
  requestId: string,
  result: Awaited<ReturnType<GatewayDispatcher['dispatch']>>,
): InboundGatewayResponse {
  return result.ok
    ? Object.freeze({ type: 'success', requestId, result: result.value })
    : Object.freeze({ type: 'failure', requestId, failure: result.failure });
}

describe('gateway era skeleton', () => {
  it.each(ERA_CELLS)('dispatches tools/list through the %s-%s gateway era cell', async (inboundEra, outboundEra) => {
    const observed: unknown[] = [];
    const responses: unknown[] = [];
    const request = createGatewayRequestEnvelope({
      requestId: `${inboundEra}-${outboundEra}`,
      operation: 'tools/list',
      targetConnectionId: 'fixture-backend',
      params: { cursor: 'fixture' },
      authority: createEffectiveRequestAuthority({
        connectionIds: ['fixture-backend'],
        provenance: ['gateway-era-skeleton'],
      }),
      inbound: pin(inboundEra),
      outbound: pin(outboundEra),
      deadlineUnixMs: 2_000,
    });
    const inbound = createInbound(inboundEra, request, responses);
    const outbound = createOutbound(outboundEra, observed);
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => outbound, now: () => 1_000 });

    const event = await inbound.nextEvent();
    expect(event.type).toBe('request');
    if (event.type !== 'request') throw new Error('fixture request was not delivered');
    const result = await dispatcher.dispatch(event.request);
    await inbound.respond(responseFor(event.request.requestId, result));

    expect(result).toEqual({
      ok: true,
      value: { tools: [{ name: 'fixture-tool', inputSchema: { type: 'object' } }] },
    });
    expect(event.request.inbound).toEqual(pin(inboundEra));
    expect(event.request.outbound).toEqual(pin(outboundEra));
    expect(observed).toHaveLength(1);
    expect(responses).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(responses[0]))).toEqual(responses[0]);
  });
});
