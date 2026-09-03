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
  return Object.freeze({
    kind: input.kind,
    code: input.code,
    message: input.message,
    ...(input.data === undefined ? {} : { data: toImmutableJsonValue(input.data) }),
  });
}

export function gatewayFailureFromUnknown(error: unknown, kind: GatewayFailureKind = 'internal'): GatewayFailure {
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined;
  const failureKind = GATEWAY_FAILURE_KINDS.includes(record?.kind as GatewayFailureKind)
    ? (record!.kind as GatewayFailureKind)
    : kind;
  const code =
    typeof record?.code === 'string' || typeof record?.code === 'number'
      ? String(record.code)
      : 'gateway_internal_error';
  const message =
    typeof record?.message === 'string' ? record.message : error instanceof Error ? error.message : String(error);
  let data: ImmutableJsonValue | undefined;
  if (record?.data !== undefined) {
    try {
      data = toImmutableJsonValue(record.data);
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
