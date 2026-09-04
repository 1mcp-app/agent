import type { JsonValue, LegacyRequestId, LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import {
  createEffectiveRequestAuthority,
  type ImmutableJsonValue,
  type ProtocolEraPin,
} from '../../contracts/index.js';
import type { OutboundGatewayRequest } from '../../ports/index.js';
import { LegacyOutboundEraAdapter } from './legacyOutboundEraAdapter.js';

const LEGACY_PIN = Object.freeze({ era: 'legacy', revision: '2025-11-25' }) satisfies ProtocolEraPin;

function request(overrides: Partial<OutboundGatewayRequest> = {}): OutboundGatewayRequest {
  return Object.freeze({
    requestId: 'gateway-request-1',
    operation: 'tools/list',
    params: Object.freeze({ cursor: 'next' }),
    authority: createEffectiveRequestAuthority({ connectionIds: ['backend'] }),
    deadlineUnixMs: 2_000,
    ...overrides,
  });
}

function legacyAdapter(result: ImmutableJsonValue = { tools: [] }) {
  const adapter: LegacySdkAdapter = {
    connectionId: 'legacy-connection' as never,
    state: 'running',
    start: vi.fn(),
    nextEvent: vi.fn(),
    respond: vi.fn(),
    request: vi.fn().mockResolvedValue(result),
    cancel: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  return adapter;
}

describe('LegacyOutboundEraAdapter', () => {
  it('maps the gateway request id and remaining absolute deadline to the legacy adapter', async () => {
    const legacy = legacyAdapter();
    const adapter = new LegacyOutboundEraAdapter(legacy, LEGACY_PIN, { now: () => 1_250 });

    await adapter.request(request());

    expect(legacy.request).toHaveBeenCalledWith({
      id: 'gateway-request-1',
      method: 'tools/list',
      params: { cursor: 'next' },
      timeoutMs: 750,
    });
  });

  it('rejects an expired request before calling the legacy adapter', async () => {
    const legacy = legacyAdapter();
    const adapter = new LegacyOutboundEraAdapter(legacy, LEGACY_PIN, { now: () => 2_000 });

    await expect(adapter.request(request())).rejects.toEqual({
      kind: 'deadline-exceeded',
      code: 'gateway_deadline_exceeded',
      message: 'The gateway request deadline has expired',
    });
    expect(legacy.request).not.toHaveBeenCalled();
  });

  it('forwards cancellation once by the same gateway request id', async () => {
    let finish!: (value: JsonValue) => void;
    const legacy = legacyAdapter();
    vi.mocked(legacy.request).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const adapter = new LegacyOutboundEraAdapter(legacy, LEGACY_PIN, { now: () => 1_000 });

    const pending = adapter.request(request());
    await Promise.all([adapter.cancel('gateway-request-1'), adapter.cancel('gateway-request-1')]);
    finish({ tools: [] });

    await expect(pending).resolves.toEqual({ tools: [] });
    expect(legacy.cancel).toHaveBeenCalledOnce();
    expect(legacy.cancel).toHaveBeenCalledWith('gateway-request-1' as LegacyRequestId);
  });

  it('returns detached immutable data and converts failures to plain data', async () => {
    const result = { tools: [{ name: 'echo' }] };
    const legacy = legacyAdapter(result);
    const adapter = new LegacyOutboundEraAdapter(legacy, LEGACY_PIN, { now: () => 1_000 });

    const response = await adapter.request(request());
    expect(response).toEqual(result);
    expect(response).not.toBe(result);
    expect(Object.isFrozen(response)).toBe(true);

    class ForeignError extends Error {
      code = -32_601;
      data = { method: 'missing' };
    }
    vi.mocked(legacy.request).mockRejectedValueOnce(new ForeignError('Method not found'));
    const failure = await adapter.request(request({ requestId: 'gateway-request-2' })).catch((error: unknown) => error);
    expect(failure).toEqual({
      kind: 'transport',
      code: '-32601',
      message: 'Method not found',
      data: { method: 'missing' },
    });
    expect(Object.getPrototypeOf(failure)).toBe(Object.prototype);
    expect(Object.isFrozen(failure)).toBe(true);
  });

  it('accepts only an immutable legacy protocol pin', () => {
    const legacy = legacyAdapter();
    const adapter = new LegacyOutboundEraAdapter(legacy, { ...LEGACY_PIN });

    expect(adapter.pin).toEqual(LEGACY_PIN);
    expect(Object.isFrozen(adapter.pin)).toBe(true);
    expect(() => new LegacyOutboundEraAdapter(legacy, { era: 'modern', revision: '2026-07-28' })).toThrow(
      'require a legacy protocol era pin',
    );
  });
});
