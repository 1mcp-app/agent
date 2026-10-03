import {
  context,
  type Context,
  createContextKey,
  defaultTextMapGetter,
  defaultTextMapSetter,
  isSpanContextValid,
  propagation,
  ROOT_CONTEXT,
  trace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import { types } from 'node:util';

export interface TraceCorrelation {
  readonly trace_id: string;
  readonly span_id: string;
  readonly trace_flags: string;
}

const propagator = new W3CTraceContextPropagator();
const lifetimeKey = createContextKey('1mcp.operation-trace-lifetime');
let installed = false;

/** Deliberately no NodeSDK, provider, span creation, auto instrumentation or exporters. */
export function installTracingContext(): void {
  if (installed) return;
  const manager = new AsyncLocalStorageContextManager().enable();
  if (!context.setGlobalContextManager(manager)) manager.disable();
  propagation.setGlobalPropagator(propagator);
  installed = true;
}

function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function validTraceState(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512 || !value.length) return false;
  const members = value.split(',');
  if (members.length > 32) return false;
  const keys = new Set<string>();
  for (const member of members) {
    const match =
      /^[ \t]*([a-z][a-z0-9_*/-]{0,255}|[a-z0-9][a-z0-9_*/-]{0,240}@[a-z][a-z0-9_*/-]{0,13})=([\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e])[ \t]*$/.exec(
        member,
      );
    if (!match || keys.has(match[1])) return false;
    keys.add(match[1]);
  }
  return true;
}

function extract(params: unknown): Context {
  const meta = own(params, '_meta');
  const parent = own(meta, 'traceparent');
  // Only the exact MCP reserved keys are carriers. Arrays/duplicates/conflicts are invalid.
  if (typeof parent !== 'string' || parent.length > 512) return ROOT_CONTEXT;
  if (!/^(?!ff)[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}(?:-[\x21-\x7e]+)?$/.test(parent)) return ROOT_CONTEXT;
  const carrier: Record<string, string> = { traceparent: parent };
  const state = own(meta, 'tracestate');
  if (validTraceState(state)) carrier.tracestate = state;
  return propagator.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
}

function activeContext(): Context {
  const active = context.active();
  const lifetime = active.getValue(lifetimeKey) as { active: boolean } | undefined;
  return lifetime?.active === false ? ROOT_CONTEXT : active;
}

async function run<T>(parent: Context, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  installTracingContext();
  const lifetime = { active: !signal?.aborted };
  const abort = () => {
    lifetime.active = false;
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await context.with(parent.setValue(lifetimeKey, lifetime), operation);
  } finally {
    lifetime.active = false;
    signal?.removeEventListener('abort', abort);
  }
}

/** HTTP context is intentionally not an ancestor of the logical MCP operation. */
export function withMcpTraceContext<T>(params: unknown, operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return run(extract(params), operation, signal);
}

/** Capture only validated tracing facts in an opaque callback for an already-owned interaction. */
export function captureTraceContext(): <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  remoteParams?: unknown,
) => Promise<T> {
  const span = trace.getSpanContext(activeContext());
  const captured = span && isSpanContextValid(span) ? trace.setSpanContext(ROOT_CONTEXT, span) : ROOT_CONTEXT;
  return (operation, signal, remoteParams) => {
    const remote = extract(remoteParams);
    return run(trace.getSpanContext(remote) ? remote : captured, operation, signal);
  };
}

export function getActiveTraceCorrelation(): TraceCorrelation | undefined {
  const span = trace.getSpanContext(activeContext());
  if (!span || !isSpanContextValid(span)) return undefined;
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
    trace_flags: (span.traceFlags & 0xff).toString(16).padStart(2, '0'),
  };
}

/** Call only after authority/capability stripping, or on gateway-owned protocol metadata. */
export function injectTraceContext<T>(params: T): T {
  const carrier: Record<string, string> = {};
  const active = activeContext();
  const span = trace.getSpanContext(active);
  // OTel 2.2's injector expects TraceFlags (sampled bit), not arbitrary W3C reserved bits.
  const outgoing = span
    ? trace.setSpanContext(ROOT_CONTEXT, { ...span, traceFlags: span.traceFlags & 1 })
    : ROOT_CONTEXT;
  propagator.inject(outgoing, carrier, defaultTextMapSetter);
  if (params !== null && typeof params === 'object' && types.isProxy(params)) return undefined as T;
  const original = params !== null && typeof params === 'object' && !Array.isArray(params) ? params : undefined;
  const meta = own(original, '_meta');
  const cleanMeta: Record<string, unknown> = {};
  if (meta && typeof meta === 'object' && !types.isProxy(meta)) {
    for (const key of Object.keys(meta)) {
      if (['traceparent', 'tracestate', 'baggage'].includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(meta, key);
      if (descriptor && 'value' in descriptor)
        Object.defineProperty(cleanMeta, key, { value: descriptor.value, enumerable: true, configurable: true });
    }
  }
  Object.assign(cleanMeta, carrier);
  if (!Object.keys(cleanMeta).length && meta === undefined) return params;
  const result: Record<string, unknown> = {};
  if (original) {
    for (const key of Object.keys(original)) {
      if (key === '_meta') continue;
      const descriptor = Object.getOwnPropertyDescriptor(original, key);
      if (descriptor && 'value' in descriptor)
        Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
    }
  }
  return Object.assign(result, { _meta: cleanMeta }) as T;
}

/** Remove only the reserved envelope carrier; business fields named baggage are untouched. */
export function stripBaggage<T>(value: T): T {
  const meta = own(value, '_meta');
  if (meta === null || typeof meta !== 'object' || types.isProxy(meta)) return value;
  if (!Object.getOwnPropertyDescriptor(meta, 'baggage')) return value;
  const cleanMeta: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    if (key === 'baggage') continue;
    const descriptor = Object.getOwnPropertyDescriptor(meta, key);
    if (descriptor && 'value' in descriptor)
      Object.defineProperty(cleanMeta, key, { value: descriptor.value, enumerable: true });
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    if (key === '_meta') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor)
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return Object.assign(result, { _meta: cleanMeta }) as T;
}
