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
  if (!input.code || !input.message) throw new TypeError('Gateway failure code and message are required');
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
  const rawCode = record ? ownDataValue(record, 'code') : undefined;
  const code = typeof rawCode === 'string' || typeof rawCode === 'number' ? String(rawCode) : 'gateway_internal_error';
  const rawMessage = record ? ownDataValue(record, 'message') : undefined;
  let message = typeof rawMessage === 'string' ? rawMessage : 'Unknown gateway failure';
  if (rawMessage === undefined && !record) {
    try {
      message = String(error);
    } catch {
      message = 'Unknown gateway failure';
    }
  }
  let data: ImmutableJsonValue | undefined;
  const rawData = record ? ownDataValue(record, 'data') : undefined;
  if (rawData !== undefined) {
    try {
      data = toImmutableJsonValue(rawData);
    } catch {
      data = undefined;
    }
  }
  return createGatewayFailure({ kind: failureKind, code, message, ...(data === undefined ? {} : { data }) });
}

export type GatewayResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: GatewayFailure }>;

export function gatewaySuccess<T>(value: T): GatewayResult<T> {
  return Object.freeze({ ok: true, value });
}

export function gatewayFailure<T = never>(failure: GatewayFailure): GatewayResult<T> {
  return Object.freeze({ ok: false, failure });
}
