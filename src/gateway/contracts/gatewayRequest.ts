import { createEffectiveRequestAuthority, type EffectiveRequestAuthority } from './effectiveRequestAuthority.js';
import { type ImmutableJsonValue, toImmutableJsonValue } from './immutableJson.js';
import type { ProtocolEraPin } from './protocolEra.js';

export type GatewayOperation = 'tools/list';

export interface GatewayRequestEnvelope {
  readonly requestId: string;
  readonly operation: GatewayOperation;
  readonly targetConnectionId: string;
  readonly params?: ImmutableJsonValue;
  readonly authority: EffectiveRequestAuthority;
  readonly inbound: ProtocolEraPin;
  readonly outbound: ProtocolEraPin;
  readonly deadlineUnixMs: number;
}

export function createGatewayRequestEnvelope(input: GatewayRequestEnvelope): GatewayRequestEnvelope {
  if (!input.requestId || !input.targetConnectionId) throw new TypeError('Gateway request identifiers are required');
  if (input.operation !== 'tools/list')
    throw new TypeError(`Unsupported gateway operation: ${String(input.operation)}`);
  if (!Number.isSafeInteger(input.deadlineUnixMs) || input.deadlineUnixMs <= 0) {
    throw new TypeError('Gateway deadline must be a positive Unix millisecond timestamp');
  }
  return Object.freeze({
    ...input,
    authority: createEffectiveRequestAuthority(input.authority),
    inbound: Object.freeze({ ...input.inbound }),
    outbound: Object.freeze({ ...input.outbound }),
    ...(input.params === undefined ? {} : { params: toImmutableJsonValue(input.params) }),
  });
}

export interface GatewayCancellation {
  readonly type: 'cancel';
  readonly requestId: string;
}

export function createGatewayCancellation(requestId: string): GatewayCancellation {
  if (!requestId) throw new TypeError('Gateway cancellation request id is required');
  return Object.freeze({ type: 'cancel', requestId });
}
