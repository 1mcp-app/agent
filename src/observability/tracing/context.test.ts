import { context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';

import { connect } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootstrapTracing } from './bootstrap.js';
import {
  captureTraceContext,
  getActiveTraceCorrelation,
  injectTraceContext,
  stripBaggage,
  withMcpTraceContext,
} from './context.js';

const parent = '00-12345678901234567890123456789012-1234567890123456-01';
const other = '00-abcdefabcdefabcdefabcdefabcdefab-abcdefabcdefabcd-00';
const params = { _meta: { traceparent: parent, tracestate: 'vendor=opaque', baggage: 'credential=never-retain' } };
vi.mock('node:net', async (original) => ({ ...(await original()), connect: vi.fn() }));
bootstrapTracing();
afterEach(() => vi.unstubAllEnvs());

describe('propagation without signal activation', () => {
  it('installs W3C-only propagation independently of disabled SDK and creates no valid local span', async () => {
    vi.stubEnv('OTEL_SDK_DISABLED', 'true');
    bootstrapTracing();
    expect(propagation.fields()).toEqual(['traceparent', 'tracestate']);
    const span = trace.getTracer('test').startSpan('no-provider');
    expect(span.spanContext().traceId).toBe('00000000000000000000000000000000');
    await withMcpTraceContext(params, async () => {
      await Promise.resolve();
      expect(getActiveTraceCorrelation()).toEqual({
        trace_id: '12345678901234567890123456789012',
        span_id: '1234567890123456',
        trace_flags: '01',
      });
      expect(propagation.getBaggage(context.active())).toBeUndefined();
      expect(injectTraceContext(undefined)).toEqual({ _meta: { traceparent: parent, tracestate: 'vendor=opaque' } });
    });
    expect(connect).not.toHaveBeenCalled();
    expect(getActiveTraceCorrelation()).toBeUndefined();
  });

  it.each([
    undefined,
    null,
    [],
    {},
    '',
    'credential=never-retain',
    [parent, other],
    `${parent},${other}`,
    '00-00000000000000000000000000000000-1234567890123456-01',
    '00-12345678901234567890123456789012-0000000000000000-01',
    other.toUpperCase(),
    `${parent}-extension`,
    ` ${parent}`,
    `${parent}\n`,
    'f'.repeat(100_000),
  ])('ignores invalid parent %# without changing results or adopting ambient context', async (traceparent) => {
    await withMcpTraceContext(params, async () => {
      expect(
        await withMcpTraceContext({ _meta: { traceparent } }, async () => {
          expect(getActiveTraceCorrelation()).toBeUndefined();
          expect(injectTraceContext({ value: 1, _meta: { baggage: 'credential', traceparent } })).toEqual({
            value: 1,
            _meta: {},
          });
          return 'ok';
        }),
      ).toBe('ok');
      expect(getActiveTraceCorrelation()?.trace_id).toBe('12345678901234567890123456789012');
    });
  });

  it.each([
    'a=one,a=two',
    'a=one\nb=two',
    '\na=one',
    'a=one\r',
    '\u00a0a=one',
    'a=☃',
    'a=' + 'v'.repeat(257),
    'a=one,,b=two',
    'a=one=b',
  ])('drops invalid state %#', async (tracestate) => {
    await withMcpTraceContext({ _meta: { traceparent: parent, tracestate } }, async () => {
      expect(injectTraceContext(undefined)).toEqual({ _meta: { traceparent: parent } });
    });
  });

  it('does not invoke accessors or proxy traps and does not retain baggage', async () => {
    const getter = vi.fn(() => {
      throw new Error('raw-carrier');
    });
    const metadata = Object.defineProperty({}, 'traceparent', { get: getter });
    for (const value of [{ _meta: metadata }, new Proxy({}, { get: getter, getOwnPropertyDescriptor: getter })]) {
      await withMcpTraceContext(value, async () => expect(getActiveTraceCorrelation()).toBeUndefined());
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it('injects without executing parameter getters or proxy traps', async () => {
    const getter = vi.fn(() => {
      throw new Error('raw-carrier');
    });
    await withMcpTraceContext(params, async () => {
      const hostile = Object.defineProperties(
        { value: 1 },
        { _meta: { enumerable: true, get: getter }, secret: { enumerable: true, get: getter } },
      );
      expect(injectTraceContext(hostile)).toEqual({
        value: 1,
        _meta: { traceparent: parent, tracestate: 'vendor=opaque' },
      });
      expect(injectTraceContext(new Proxy({}, { ownKeys: getter, get: getter }))).toBeUndefined();
    });
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps concurrent operations independent and clears context after failure or cancellation', async () => {
    const controller = new AbortController();
    await Promise.all(
      [parent, other].map((traceparent) =>
        withMcpTraceContext({ _meta: { traceparent } }, async () => {
          await new Promise((resolve) => setImmediate(resolve));
          expect(injectTraceContext(undefined)).toEqual({ _meta: { traceparent } });
        }),
      ),
    );
    await expect(
      withMcpTraceContext(params, async () => {
        throw new Error('failure');
      }),
    ).rejects.toThrow('failure');
    await withMcpTraceContext(
      params,
      async () => {
        controller.abort();
        expect(getActiveTraceCorrelation()).toBeUndefined();
      },
      controller.signal,
    );
    expect(getActiveTraceCorrelation()).toBeUndefined();
  });

  it('expires detached work but lets an explicitly owned continuation live until its own completion', async () => {
    let detached!: () => void;
    let release!: () => void;
    let continuation!: Promise<void>;
    let late!: Promise<void>;
    await withMcpTraceContext(params, async () => {
      late = new Promise<void>((resolve) => {
        detached = resolve;
      }).then(() => {
        expect(getActiveTraceCorrelation()).toBeUndefined();
      });
      const run = captureTraceContext();
      continuation = run(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        expect(injectTraceContext(undefined)).toEqual({ _meta: { traceparent: parent, tracestate: 'vendor=opaque' } });
      });
    });
    detached();
    release();
    await Promise.all([late, continuation]);
    expect(getActiveTraceCorrelation()).toBeUndefined();
  });

  it('takes valid remote reverse context only within its already-owned interaction', async () => {
    await withMcpTraceContext(params, async () => {
      const owned = captureTraceContext();
      await owned(
        async () => {
          expect(injectTraceContext(undefined)).toEqual({ _meta: { traceparent: other } });
        },
        undefined,
        { _meta: { traceparent: other, baggage: 'forbidden' } },
      );
      expect(getActiveTraceCorrelation()?.trace_id).toBe('12345678901234567890123456789012');
    });
  });

  it('removes reserved response baggage without altering application content or other metadata', () => {
    const result = { _meta: { baggage: 'forbidden', other: 'preserved' }, structuredContent: { baggage: 'legit' } };
    expect(stripBaggage(result)).toEqual({ _meta: { other: 'preserved' }, structuredContent: { baggage: 'legit' } });
    expect(result._meta.baggage).toBe('forbidden');
  });

  it('uses MCP context independently of valid ambient HTTP span and never copies HTTP baggage', async () => {
    const http = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: 'abcdefabcdefabcdefabcdefabcdefab',
      spanId: 'abcdefabcdefabcd',
      traceFlags: 1,
    });
    await context.with(
      propagation.setBaggage(http, propagation.createBaggage({ secret: { value: 'http-secret' } })),
      async () => {
        await withMcpTraceContext(params, async () => {
          expect(injectTraceContext(undefined)).toEqual({
            _meta: { traceparent: parent, tracestate: 'vendor=opaque' },
          });
          expect(propagation.getBaggage(context.active())).toBeUndefined();
        });
        expect(getActiveTraceCorrelation()?.trace_id).toBe('abcdefabcdefabcdefabcdefabcdefab');
      },
    );
  });
});
