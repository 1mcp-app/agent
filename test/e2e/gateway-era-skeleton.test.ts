import {
  createEffectiveRequestAuthority,
  createGatewayRequestEnvelope,
  GatewayDispatcher,
  type GatewayRequestEnvelope,
  GatewaySession,
  type ImmutableJsonValue,
  type InboundEraAdapter,
  type InboundGatewayEvent,
  type InboundGatewayResponse,
  LegacyInboundEraAdapter,
  LegacyOutboundEraAdapter,
  ModernInboundEraAdapter,
  ModernOutboundEraAdapter,
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

const toolList = { tools: [{ name: 'fixture-tool', inputSchema: { type: 'object' } }] };

function isPending(params: unknown): boolean {
  if (typeof params !== 'object' || params === null) return false;
  if ('pending' in params && params.pending === true) return true;
  return 'params' in params && isPending(params.params);
}

function legacySdkAdapter(observed: LegacySdkRequest[], cancellations: string[]): LegacySdkAdapter {
  let resolvePending: ((value: typeof toolList) => void) | undefined;
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
      if (isPending(request.params)) return new Promise((resolve) => (resolvePending = resolve));
      return toolList;
    },
    async cancel(requestId: LegacyRequestId) {
      cancellations.push(requestId);
      resolvePending?.(toolList);
    },
    async notify(_notification: LegacySdkNotification) {},
    async close() {},
  };
}

function createOutbound(era: ProtocolEra, observed: unknown[]) {
  const cancellations: string[] = [];
  if (era === 'legacy') {
    return {
      adapter: new LegacyOutboundEraAdapter(legacySdkAdapter(observed as LegacySdkRequest[], cancellations), pin(era), {
        now: () => 1_000,
      }),
      cancellations,
    };
  }
  let resolvePending: ((value: typeof toolList) => void) | undefined;
  return {
    adapter: new ModernOutboundEraAdapter({
      revision: revisionByEra.modern,
      now: () => 1_000,
      async request(frame) {
        observed.push(frame);
        if (isPending(frame)) return new Promise((resolve) => (resolvePending = resolve));
        return toolList;
      },
      async cancel(requestId) {
        cancellations.push(requestId);
        resolvePending?.(toolList);
      },
    }),
    cancellations,
  };
}

function frame(request: GatewayRequestEnvelope): ImmutableJsonValue {
  return toImmutableJsonValue({
    type: 'request',
    correlationId: `wire-${request.requestId}`,
    operation: request.operation,
    ...(request.params === undefined ? {} : { params: request.params }),
  });
}

function createInbound(
  era: ProtocolEra,
  request: GatewayRequestEnvelope,
  responses: unknown[],
  cancellation = false,
): InboundEraAdapter {
  if (era === 'legacy') {
    const events: InboundGatewayEvent[] = [
      Object.freeze({ type: 'request', request }),
      ...(cancellation ? [Object.freeze({ type: 'cancel' as const, requestId: request.requestId })] : []),
      Object.freeze({ type: 'closed' }),
    ];
    return new LegacyInboundEraAdapter(
      {
        async nextEvent(): Promise<InboundGatewayEvent> {
          return events.shift()!;
        },
        async respond(response) {
          responses.push(response);
        },
        async close() {},
      },
      pin(era),
    );
  }

  const frames: unknown[] = [
    frame(request),
    ...(cancellation ? [{ type: 'cancel', correlationId: `wire-${request.requestId}` }] : []),
    undefined,
  ];
  return new ModernInboundEraAdapter({
    revision: revisionByEra.modern,
    async receive() {
      return frames.shift();
    },
    async requestContext(correlationId) {
      expect(correlationId).toBe(`wire-${request.requestId}`);
      return {
        requestId: request.requestId,
        targetConnectionId: request.targetConnectionId,
        authority: request.authority,
        outbound: request.outbound,
        deadlineUnixMs: request.deadlineUnixMs,
      };
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
    const dispatcher = new GatewayDispatcher({ resolveOutbound: () => outbound.adapter, now: () => 1_000 });

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
    if (outboundEra === 'legacy') {
      expect(observed[0]).toMatchObject({
        id: request.requestId,
        method: 'tools/list',
        params: { cursor: 'fixture' },
        timeoutMs: 1_000,
      });
    } else {
      expect(observed[0]).toMatchObject({
        requestId: request.requestId,
        operation: 'tools/list',
        params: { cursor: 'fixture' },
        authority: { connectionIds: ['fixture-backend'], provenance: ['gateway-era-skeleton'] },
        deadlineUnixMs: 2_000,
      });
    }
    expect(responses).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(responses[0]))).toEqual(responses[0]);
  });

  it.each(ERA_CELLS)('propagates cancellation through the %s-%s gateway era cell', async (inboundEra, outboundEra) => {
    const observed: unknown[] = [];
    const responses: unknown[] = [];
    const request = createGatewayRequestEnvelope({
      requestId: `cancel-${inboundEra}-${outboundEra}`,
      operation: 'tools/list',
      targetConnectionId: 'fixture-backend',
      params: { pending: true },
      authority: createEffectiveRequestAuthority({ connectionIds: ['fixture-backend'] }),
      inbound: pin(inboundEra),
      outbound: pin(outboundEra),
      deadlineUnixMs: 2_000,
    });
    const inbound = createInbound(inboundEra, request, responses, true);
    const outbound = createOutbound(outboundEra, observed);
    const session = new GatewaySession(
      new GatewayDispatcher({ resolveOutbound: () => outbound.adapter, now: () => 1_000 }),
    );

    await session.run(inbound);

    expect(outbound.cancellations).toEqual([request.requestId]);
    expect(observed).toHaveLength(1);
    expect(responses).toHaveLength(1);
  });
});
