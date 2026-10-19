import { types } from 'node:util';

import type { OperationOutcome } from '@src/observability/telemetry.js';

// Only bounded protocol facts cross this boundary; never inspect error prose or causes.
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export function telemetryErrorOutcome(error: unknown): OperationOutcome {
  if (field(error, 'code') === 'runtime_draining') return 'draining';
  switch (field(error, 'kind')) {
    case 'authorization':
      return 'denied';
    case 'invalid-request':
      return 'caller-error';
    case 'cancelled':
      return 'cancelled';
    case 'deadline-exceeded':
      return 'aborted';
    case 'transport':
      return 'transport-error';
  }
  switch (field(error, 'code')) {
    case -32700:
    case -32600:
    case -32602:
      return 'caller-error';
    case -32601:
    case -32002:
    case 'resource_not_found':
      return 'not-found';
    case -32021:
      return 'denied';
    case -32603:
      return 'upstream-error';
    case -32004:
      return 'draining';
    case 'schema_input_invalid':
      return 'caller-error';
    case 'schema_output_invalid':
      return 'invalid-response';
  }
  if (field(error, 'name') === 'AbortError') return 'cancelled';
  return 'internal-error';
}

export function telemetryResultOutcome(result: unknown): OperationOutcome {
  if (field(result, 'ok') === false) return telemetryErrorOutcome(field(result, 'failure'));
  if (field(result, 'ok') === true) return telemetryResultOutcome(field(result, 'value'));
  const rpcError = field(result, 'error');
  if (rpcError !== undefined) return telemetryErrorOutcome(rpcError);
  const payload = field(result, 'result') ?? result;
  if (field(payload, 'isError') === true) return 'tool-error';
  return 'success';
}

export function telemetryFailureFacts(error: unknown) {
  const kinds = [
    'protocol',
    'invalid-request',
    'authorization',
    'deadline-exceeded',
    'cancelled',
    'transport',
    'internal',
  ] as const;
  const codes = [
    'gateway_overloaded',
    'runtime_draining',
    'gateway_target_unavailable',
    'resource_not_found',
    'schema_evaluation_timeout',
    'schema_evaluation_unavailable',
    'missing_required_client_capability',
  ] as const;
  return {
    outcome: telemetryErrorOutcome(error),
    failureKind: kinds.find((kind) => kind === field(error, 'kind')) ?? ('other' as const),
    failureCode: codes.find((code) => code === field(error, 'code')) ?? ('other' as const),
  };
}
