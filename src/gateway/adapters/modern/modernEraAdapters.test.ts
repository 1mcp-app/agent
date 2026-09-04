import { describe, expect, it, vi } from 'vitest';

import type { GatewayFailure, ImmutableJsonValue } from '../../contracts/index.js';
import { ModernInboundEraAdapter } from './modernInboundEraAdapter.js';
import { ModernOutboundEraAdapter } from './modernOutboundEraAdapter.js';

const MODERN_REVISION = '2026-07-28';

function outbound(overrides: Partial<ConstructorParameters<typeof ModernOutboundEraAdapter>[0]> = {}) {
  return new ModernOutboundEraAdapter({
    revision: MODERN_REVISION,
    now: () => 1_000,
    request: async () => ({ tools: [] }),
    cancel: async () => undefined,
    ...overrides,
  });
}

function inbound(
  frames: unknown[],
  requestContext: ConstructorParameters<typeof ModernInboundEraAdapter>[0]['requestContext'] = async () => ({
    requestId: 'gateway-request-1',
    targetConnectionId: 'trusted-server',
    authority: { connectionIds: ['trusted-server'], provenance: ['trusted-context'] },
    outbound: { era: 'legacy', revision: '2025-11-25' },
    deadlineUnixMs: 2_000_000_000_000,
  }),
) {
  const responses: ImmutableJsonValue[] = [];
  const adapter = new ModernInboundEraAdapter({
    revision: MODERN_REVISION,
    receive: async () => frames.shift(),
    requestContext,
    respond: async (response) => {
      responses.push(response);
    },
  });
  return { adapter, responses };
}

describe('modern era adapter pins', () => {
  it('creates immutable modern-only pins', () => {
    const inboundAdapter = inbound([]).adapter;
    const outboundAdapter = outbound();

    expect(inboundAdapter.pin).toEqual({ era: 'modern', revision: MODERN_REVISION });
    expect(outboundAdapter.pin).toEqual({ era: 'modern', revision: MODERN_REVISION });
    expect(Object.isFrozen(inboundAdapter.pin)).toBe(true);
    expect(Object.isFrozen(outboundAdapter.pin)).toBe(true);
    expect(Object.isFrozen(inboundAdapter)).toBe(true);
    expect(Object.isFrozen(outboundAdapter)).toBe(true);
  });

  it.each([ModernInboundEraAdapter, ModernOutboundEraAdapter])(
    'rejects malformed modern evidence terminally from %s',
    (Adapter) => {
      let thrown: unknown;
      try {
        if (Adapter === ModernInboundEraAdapter) {
          new ModernInboundEraAdapter({
            revision: '2025-11-25',
            receive: async () => undefined,
            requestContext: async () => ({
              requestId: 'unused',
              targetConnectionId: 'unused',
              authority: { connectionIds: ['unused'], provenance: [] },
              outbound: { era: 'legacy', revision: '2025-11-25' },
              deadlineUnixMs: 1,
            }),
            respond: async () => undefined,
          });
        } else {
          new ModernOutboundEraAdapter({
            revision: '2025-11-25',
            request: async () => null,
            cancel: async () => undefined,
          });
        }
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toEqual({
        kind: 'protocol',
        code: 'modern_protocol_invalid',
        message: 'Modern protocol evidence is malformed or unsupported',
        data: { observedEra: 'modern' },
      });
      expect(Object.getPrototypeOf(thrown)).toBe(Object.prototype);
      expect(Object.isFrozen(thrown)).toBe(true);
    },
  );
});

describe('ModernInboundEraAdapter', () => {
  it('uses trusted gateway context and ignores authority, pin, id, and deadline fields on the wire frame', async () => {
    const params = { cursor: { page: 2 } };
    const frame = {
      type: 'request',
      correlationId: 'wire-1',
      operation: 'tools/list',
      params,
      requestId: 'attacker-request',
      targetConnectionId: 'attacker-server',
      authority: { connectionIds: ['attacker-server'], provenance: ['attacker'] },
      outbound: { era: 'modern', revision: MODERN_REVISION },
      deadlineUnixMs: 9_999_999_999_999,
    };
    const { adapter } = inbound([frame]);

    const event = await adapter.nextEvent();
    params.cursor.page = 99;

    expect(event).toMatchObject({
      type: 'request',
      request: {
        requestId: 'gateway-request-1',
        targetConnectionId: 'trusted-server',
        params: { cursor: { page: 2 } },
        inbound: { era: 'modern', revision: MODERN_REVISION },
        outbound: { era: 'legacy', revision: '2025-11-25' },
        authority: { connectionIds: ['trusted-server'], provenance: ['trusted-context'] },
        deadlineUnixMs: 2_000_000_000_000,
      },
    });
    expect(Object.isFrozen(event)).toBe(true);
    if (event.type !== 'request') throw new Error('expected request event');
    expect(Object.isFrozen(event.request.params)).toBe(true);
    expect(Object.isFrozen((event.request.params as { cursor: object }).cursor)).toBe(true);
    expect(JSON.stringify(event)).not.toContain('receive');
  });

  it('preserves cancellation ids and closes when the callback is exhausted', async () => {
    const { adapter } = inbound([
      { type: 'request', correlationId: 'wire-cancel', operation: 'tools/list' },
      { type: 'cancel', correlationId: 'wire-cancel' },
    ]);

    await expect(adapter.nextEvent()).resolves.toMatchObject({ type: 'request' });
    await expect(adapter.nextEvent()).resolves.toEqual({ type: 'cancel', requestId: 'gateway-request-1' });
    await expect(adapter.nextEvent()).resolves.toEqual({ type: 'closed' });
  });

  it('returns a terminal plain failure for malformed modern frames', async () => {
    class ForeignFrame {
      type = 'request';
    }
    const { adapter } = inbound([new ForeignFrame()]);

    const event = await adapter.nextEvent();

    expect(event).toEqual({
      type: 'failure',
      failure: {
        kind: 'invalid-request',
        code: 'modern_request_invalid',
        message: 'The modern request frame is malformed or unsupported',
      },
    });
    if (event.type !== 'failure') throw new Error('expected failure event');
    expect(Object.getPrototypeOf(event.failure)).toBe(Object.prototype);
  });

  it('sends only detached, frozen response values', async () => {
    const { adapter, responses } = inbound([{ type: 'request', correlationId: 'wire-2', operation: 'tools/list' }]);
    const result = { tools: [{ name: 'one' }] };

    await adapter.nextEvent();
    await adapter.respond({ type: 'success', requestId: 'gateway-request-1', result });
    result.tools[0].name = 'mutated';

    expect(responses).toEqual([{ type: 'success', correlationId: 'wire-2', result: { tools: [{ name: 'one' }] } }]);
    expect(Object.isFrozen(responses[0])).toBe(true);
    expect(Object.isFrozen((responses[0] as { result: { tools: object[] } }).result.tools[0])).toBe(true);
  });
});

describe('ModernOutboundEraAdapter', () => {
  it('detaches request and result values and preserves the absolute deadline', async () => {
    const seen: ImmutableJsonValue[] = [];
    const foreignResult = { tools: [{ name: 'modern-tool' }] };
    const adapter = outbound({
      request: async (request) => {
        seen.push(request);
        return foreignResult;
      },
    });
    const params = { cursor: { page: 4 } };

    const result = await adapter.request({
      requestId: 'request-3',
      operation: 'tools/list',
      params,
      authority: { connectionIds: ['server-a'], provenance: ['inbound'] },
      deadlineUnixMs: 2_000_000_000_123,
    });
    params.cursor.page = 9;
    foreignResult.tools[0].name = 'mutated';

    expect(seen[0]).toMatchObject({
      requestId: 'request-3',
      params: { cursor: { page: 4 } },
      deadlineUnixMs: 2_000_000_000_123,
    });
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(result).toEqual({ tools: [{ name: 'modern-tool' }] });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { tools: object[] }).tools[0])).toBe(true);
  });

  it('forwards the exact cancellation id', async () => {
    let resolveRequest!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      resolveRequest = resolve;
    });
    const cancel = vi.fn(async () => undefined);
    const adapter = outbound({ request: async () => pending, cancel });
    const request = adapter.request({
      requestId: 'request-4',
      operation: 'tools/list',
      authority: { connectionIds: ['server-a'], provenance: [] },
      deadlineUnixMs: 2_000,
    });

    await adapter.cancel('request-4');
    await adapter.cancel('request-4');
    await adapter.cancel('unknown-request');

    expect(cancel).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith('request-4');

    resolveRequest({ tools: [] });
    await request;
    await adapter.cancel('request-4');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects an expired deadline at the final callback boundary', async () => {
    const request = vi.fn(async () => ({ tools: [] }));
    const now = vi.fn(() => 5_000);
    const adapter = outbound({ request, now });

    await expect(
      adapter.request({
        requestId: 'expired-request',
        operation: 'tools/list',
        authority: { connectionIds: ['server-a'], provenance: [] },
        deadlineUnixMs: 5_000,
      }),
    ).rejects.toEqual({
      kind: 'deadline-exceeded',
      code: 'gateway_deadline_exceeded',
      message: 'The gateway request deadline has expired',
    });
    expect(now).toHaveBeenCalledOnce();
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects concurrent duplicate request ids and permits reuse after completion', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi
      .fn()
      .mockImplementationOnce(async () => first)
      .mockResolvedValue({ tools: [] });
    const adapter = outbound({ request });
    const gatewayRequest = {
      requestId: 'duplicate-request',
      operation: 'tools/list' as const,
      authority: { connectionIds: ['server-a'], provenance: [] },
      deadlineUnixMs: 2_000,
    };

    const active = adapter.request(gatewayRequest);
    await expect(adapter.request(gatewayRequest)).rejects.toMatchObject({
      kind: 'invalid-request',
      code: 'modern_outbound_duplicate_request',
    });
    expect(request).toHaveBeenCalledOnce();

    resolveFirst({ tools: [] });
    await active;
    await expect(adapter.request(gatewayRequest)).resolves.toEqual({ tools: [] });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('converts foreign callback errors into frozen plain gateway failures', async () => {
    class ForeignSdkError extends Error {
      code = -32_603;
      data = { sdk: 'v2' };
    }
    const adapter = outbound({
      request: async () => {
        throw new ForeignSdkError('foreign failure');
      },
    });

    let failure: GatewayFailure | undefined;
    try {
      await adapter.request({
        requestId: 'request-5',
        operation: 'tools/list',
        authority: { connectionIds: ['server-a'], provenance: [] },
        deadlineUnixMs: 2_000_000_000_456,
      });
    } catch (error) {
      failure = error as GatewayFailure;
    }

    expect(failure).toEqual({
      kind: 'transport',
      code: '-32603',
      message: 'foreign failure',
      data: { sdk: 'v2' },
    });
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
    expect(Object.isFrozen(failure)).toBe(true);
    expect(Object.isFrozen(failure?.data)).toBe(true);
  });
});
