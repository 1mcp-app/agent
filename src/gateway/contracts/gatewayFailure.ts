import { z } from 'zod';

import { type ImmutableJsonValue, toImmutableJsonValue } from './immutableJson.js';

export type GatewayFailureKind =
  'protocol' | 'invalid-request' | 'authorization' | 'deadline-exceeded' | 'cancelled' | 'transport' | 'internal';

const GATEWAY_FAILURE_KINDS: readonly GatewayFailureKind[] = [
  'protocol',
  'invalid-request',
  'authorization',
  'deadline-exceeded',
  'cancelled',
  'transport',
  'internal',
];
const knownGatewayFailures = new WeakSet<object>();

export interface GatewayFailure {
  readonly kind: GatewayFailureKind;
  readonly code: string;
  readonly message: string;
  readonly data?: ImmutableJsonValue;
}

export function createGatewayFailure(input: {
  kind: GatewayFailureKind;
  code: string;
  message: string;
  data?: unknown;
}): GatewayFailure {
  if (!GATEWAY_FAILURE_KINDS.includes(input.kind)) throw new TypeError('Gateway failure kind is invalid');
  if (typeof input.code !== 'string' || !input.code || typeof input.message !== 'string' || !input.message) {
    throw new TypeError('Gateway failure code and message are required');
  }
  const failure: GatewayFailure = Object.freeze({
    kind: input.kind,
    code: input.code,
    message: input.message,
    ...(input.data === undefined ? {} : { data: toImmutableJsonValue(input.data) }),
  });
  knownGatewayFailures.add(failure);
  return failure;
}

function ownDataValue(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

export function gatewayFailureFromUnknown(error: unknown, kind: GatewayFailureKind = 'internal'): GatewayFailure {
  const record = typeof error === 'object' && error !== null ? error : undefined;
  const trustedKind = record && knownGatewayFailures.has(record) ? ownDataValue(record, 'kind') : undefined;
  const failureKind = GATEWAY_FAILURE_KINDS.includes(trustedKind as GatewayFailureKind)
    ? (trustedKind as GatewayFailureKind)
    : kind;
  const trusted = record !== undefined && knownGatewayFailures.has(record);
  const rawCode = record ? ownDataValue(record, 'code') : undefined;
  // Retain numeric protocol codes, never untrusted messages, data, or arbitrary strings.
  let code: string;
  if (trusted && typeof rawCode === 'string') {
    code = rawCode;
  } else if (
    (typeof rawCode === 'number' && Number.isSafeInteger(rawCode)) ||
    (typeof rawCode === 'string' && /^-?\d+$/.test(rawCode) && Number.isSafeInteger(Number(rawCode)))
  ) {
    code = String(rawCode);
  } else {
    code = `gateway_${failureKind.replaceAll('-', '_')}_error`;
  }
  const message = trusted ? (ownDataValue(record!, 'message') as string) : `Gateway ${failureKind} failure`;
  const data = trusted ? (ownDataValue(record!, 'data') as ImmutableJsonValue | undefined) : undefined;
  return createGatewayFailure({ kind: failureKind, code, message, ...(data === undefined ? {} : { data }) });
}

const mcpFailureProjectionSchema = z.object({
  kind: z.enum(GATEWAY_FAILURE_KINDS),
  code: z.string().max(128),
});

/** Decode our public MCP classification only at a client boundary; never trust wire diagnostics. */
export function gatewayFailureFromMcpError(error: unknown): GatewayFailure {
  const fallback = gatewayFailureFromUnknown(error, 'protocol');
  if (typeof error !== 'object' || error === null) return fallback;
  const data = ownDataValue(error, 'data');
  if (typeof data !== 'object' || data === null) return fallback;
  const parsed = mcpFailureProjectionSchema.safeParse(ownDataValue(data, 'app.1mcp/failure'));
  if (!parsed.success) return fallback;
  const { kind, code } = parsed.data;
  const safeCode =
    ['gateway_overloaded', 'gateway_target_unavailable', 'resource_not_found'].includes(code) ||
    (/^-?\d+$/.test(code) && Number.isSafeInteger(Number(code)))
      ? code
      : `gateway_${kind.replaceAll('-', '_')}_error`;
  const failure = createGatewayFailure({ kind, code: safeCode, message: `Gateway ${kind} failure` });
  const numeric = ownDataValue(error, 'code');
  if (
    gatewayFailureToMcp(failure, 'legacy').code !== numeric &&
    gatewayFailureToMcp(failure, 'modern').code !== numeric
  )
    return fallback;
  return failure;
}

export type GatewayResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: GatewayFailure }>;

export function gatewaySuccess<T>(value: T): GatewayResult<T> {
  return Object.freeze({ ok: true, value });
}

export function gatewayFailure<T = never>(failure: GatewayFailure): GatewayResult<T> {
  return Object.freeze({ ok: false, failure });
}

/** Public projections share sanitized facts; raw upstream diagnostics never cross these boundaries. */
export function gatewayFailureToMcp(failure: GatewayFailure, era: 'legacy' | 'modern' = 'legacy') {
  const safe = createGatewayFailure({ kind: failure.kind, code: failure.code, message: failure.message });
  const numeric = Number(safe.code);
  let code: number;
  if (numeric === -32002) {
    code = era === 'modern' ? -32602 : -32002;
  } else if ([-32700, -32600, -32601, -32602, -32603].includes(numeric)) {
    code = numeric;
  } else if (safe.kind === 'invalid-request') {
    code = -32602;
  } else if (safe.kind === 'internal') {
    code = -32603;
  } else if (safe.code === 'resource_not_found') {
    code = era === 'modern' ? -32602 : -32002;
  } else {
    code = -32000;
  }
  return { code, message: safe.message, data: { 'app.1mcp/failure': { kind: safe.kind, code: safe.code } } };
}

export function gatewayFailureToProblem(failure: GatewayFailure) {
  const safe = createGatewayFailure({ kind: failure.kind, code: failure.code, message: failure.message });
  let status: number;
  if (safe.kind === 'invalid-request') {
    status = 400;
  } else if (safe.kind === 'authorization') {
    status = 403;
  } else if (safe.kind === 'deadline-exceeded' || safe.kind === 'cancelled') {
    status = 408;
  } else if (safe.code === 'gateway_overloaded') {
    status = 503;
  } else if (safe.kind === 'transport' || safe.kind === 'protocol') {
    status = 502;
  } else {
    status = 500;
  }
  return {
    type: `https://docs.1mcp.app/problems/${safe.kind}`,
    title: safe.message,
    status,
    detail: safe.message,
    error: safe.message,
    'app.1mcp/failure': { kind: safe.kind, code: safe.code },
  };
}

export function gatewayFailureToToolResult(failure: GatewayFailure) {
  const safe = createGatewayFailure({ kind: failure.kind, code: failure.code, message: failure.message });
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: safe.message }],
    structuredContent: { 'app.1mcp/failure': { kind: safe.kind, code: safe.code } },
  };
}

export function gatewayFailureExitCode(failure: GatewayFailure): number {
  const safe = createGatewayFailure({ kind: failure.kind, code: failure.code, message: failure.message });
  if (['400', '413'].includes(safe.code)) return 2;
  if (safe.code === '404') return 4;
  if (safe.code === '500') return 1;
  if (['0', '408', '429', '503', '504'].includes(safe.code)) return 6;
  if (safe.kind === 'invalid-request' || ['-32700', '-32600', '-32602'].includes(safe.code)) return 2;
  if (safe.kind === 'authorization' || ['401', '403'].includes(safe.code)) return 3;
  if (safe.kind === 'deadline-exceeded' || safe.kind === 'cancelled' || safe.code === 'gateway_overloaded') return 6;
  if (['gateway_target_unavailable', '-32004', '-32010'].includes(safe.code)) return 4;
  return safe.kind === 'internal' || safe.code === '-32603' ? 1 : 5;
}
