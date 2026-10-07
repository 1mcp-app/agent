import { isNativeError } from 'node:util/types';

import { JSON_VALUE_LIMITS, RESPONSE_JSON_VALUE_LIMITS } from '@src/sdk/contracts/jsonValue.js';

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
const ownedResourceNotFoundUris = new WeakMap<object, string>();
const ownedResourceNotFoundErrors = new WeakMap<object, GatewayFailure>();
export const MISSING_CLIENT_CAPABILITY = 'missing_required_client_capability';

/** Only the locally rejected public identity may become resource-not-found error data. */
export function resourceNotFoundFailure(requestedUri: string): GatewayFailure {
  const uri = toImmutableJsonValue(requestedUri, JSON_VALUE_LIMITS);
  if (typeof uri !== 'string') throw new TypeError('Resource URI must be a string');
  // The scalar already passed the input budget. Its owned response wrapper
  // must not spend that same input budget again on additional field names.
  const failure: GatewayFailure = Object.freeze({
    kind: 'protocol',
    code: 'resource_not_found',
    message: 'Unknown resource',
    data: Object.freeze({ uri }),
  });
  knownGatewayFailures.add(failure);
  ownedResourceNotFoundUris.set(failure, uri);
  return failure;
}

function resourceNotFoundMcpProjection(uri: string, era: 'legacy' | 'modern') {
  return Object.freeze({
    code: era === 'modern' ? -32602 : -32002,
    message: 'Unknown resource',
    data: Object.freeze({
      'app.1mcp/failure': Object.freeze({ kind: 'protocol', code: 'resource_not_found' }),
      uri,
    }),
  });
}

/** A numeric SDK error with a private local brand; structural lookalikes cannot preserve data. */
export class ResourceRouteNotFoundError extends Error {
  readonly code: number;
  readonly data: ImmutableJsonValue;

  constructor(requestedUri: string) {
    const failure = resourceNotFoundFailure(requestedUri);
    super(failure.message);
    const projected = resourceNotFoundMcpProjection(requestedUri, 'legacy');
    this.code = projected.code;
    this.data = projected.data;
    ownedResourceNotFoundErrors.set(this, failure);
    Object.freeze(this);
  }
}

/** Called only by the private aggregate bridge, never by an upstream provider adapter. */
export function resourceNotFoundFromBridge(error: unknown, expectedUri: string): GatewayFailure | undefined {
  if (!isNativeError(error) || ownDataValue(error, 'code') !== -32002) return undefined;
  const data = ownDataValue(error, 'data');
  if (typeof data !== 'object' || data === null || ownDataValue(data, 'uri') !== expectedUri) return undefined;
  const marker = ownDataValue(data, 'app.1mcp/failure');
  if (typeof marker !== 'object' || marker === null) return undefined;
  if (ownDataValue(marker, 'kind') !== 'protocol' || ownDataValue(marker, 'code') !== 'resource_not_found')
    return undefined;
  try {
    return resourceNotFoundFailure(expectedUri);
  } catch {
    return undefined;
  }
}

/** The protocol's extensible capability object, detached under a deliberately small error budget. */
export function missingClientCapabilityFailure(requiredCapabilities: unknown): GatewayFailure | undefined {
  try {
    const capabilities = toImmutableJsonValue(requiredCapabilities, {
      maxTotalStringLength: 4096,
      maxDepth: 6,
      maxNodes: 128,
    });
    if (Buffer.byteLength(JSON.stringify(capabilities)) > 8192) return undefined;
    const parsed = z
      .record(z.string().min(1).max(128), z.record(z.string().max(128), z.unknown()))
      .safeParse(capabilities);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return undefined;
    return createGatewayFailure({
      kind: 'protocol',
      code: MISSING_CLIENT_CAPABILITY,
      message: 'Interaction capability required',
      data: { requiredCapabilities: capabilities },
    });
  } catch {
    return undefined;
  }
}

/** Only the private aggregate bridge may reconstruct our exact public protocol projection. */
export function missingClientCapabilityFromBridge(error: unknown): GatewayFailure | undefined {
  if (typeof error !== 'object' || error === null || ownDataValue(error, 'code') !== -32021) return undefined;
  const data = ownDataValue(error, 'data');
  if (typeof data !== 'object' || data === null) return undefined;
  const marker = ownDataValue(data, 'app.1mcp/failure');
  if (typeof marker !== 'object' || marker === null) return undefined;
  if (ownDataValue(marker, 'kind') !== 'protocol' || ownDataValue(marker, 'code') !== MISSING_CLIENT_CAPABILITY)
    return undefined;
  return missingClientCapabilityFailure(ownDataValue(data, 'requiredCapabilities'));
}

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

/** Detach an internal response value without converting structural lookalikes into owned failures. */
export function detachGatewayFailure(failure: GatewayFailure): ImmutableJsonValue {
  const uri = ownedResourceNotFoundUris.get(failure);
  const detached = toImmutableJsonValue(failure, uri === undefined ? undefined : RESPONSE_JSON_VALUE_LIMITS);
  if (knownGatewayFailures.has(failure) && typeof detached === 'object' && detached !== null) {
    knownGatewayFailures.add(detached);
    if (uri !== undefined) ownedResourceNotFoundUris.set(detached, uri);
  }
  return detached;
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
  const resourceError = record && ownedResourceNotFoundErrors.get(record);
  if (resourceError) return resourceError;
  const resourceUri = record && ownedResourceNotFoundUris.get(record);
  if (resourceUri !== undefined) return record as GatewayFailure;
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
    [
      'gateway_overloaded',
      'runtime_draining',
      'gateway_target_unavailable',
      'resource_not_found',
      'schema_evaluation_timeout',
      'schema_evaluation_unavailable',
    ].includes(code) ||
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
  const uri = ownedResourceNotFoundUris.get(failure);
  if (uri !== undefined) {
    return resourceNotFoundMcpProjection(uri, era);
  }
  if (knownGatewayFailures.has(failure) && failure.kind === 'protocol' && failure.code === MISSING_CLIENT_CAPABILITY) {
    const details = failure.data;
    const validated = missingClientCapabilityFailure(
      typeof details === 'object' && details !== null ? ownDataValue(details, 'requiredCapabilities') : undefined,
    );
    if (validated)
      return {
        code: -32021,
        message: validated.message,
        data: {
          'app.1mcp/failure': { kind: 'protocol', code: MISSING_CLIENT_CAPABILITY },
          requiredCapabilities: ownDataValue(validated.data as object, 'requiredCapabilities'),
        },
      };
  }
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
  } else if (safe.code === 'gateway_overloaded' || safe.code === 'runtime_draining') {
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
  if (['schema_evaluation_timeout', 'schema_evaluation_unavailable'].includes(safe.code)) return 6;
  if (safe.kind === 'invalid-request' || ['-32700', '-32600', '-32602'].includes(safe.code)) return 2;
  if (safe.kind === 'authorization' || ['401', '403'].includes(safe.code)) return 3;
  if (
    safe.kind === 'deadline-exceeded' ||
    safe.kind === 'cancelled' ||
    safe.code === 'gateway_overloaded' ||
    safe.code === 'runtime_draining'
  )
    return 6;
  if (['gateway_target_unavailable', '-32004', '-32010'].includes(safe.code)) return 4;
  return safe.kind === 'internal' || safe.code === '-32603' ? 1 : 5;
}
