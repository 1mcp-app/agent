import {
  authorityAllows,
  createGatewayFailure,
  gatewayFailure,
  gatewayFailureFromUnknown,
  type GatewayRequestEnvelope,
  type GatewayResult,
  gatewaySuccess,
  type ImmutableJsonValue,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../ports/index.js';

export interface GatewayDispatcherDependencies {
  resolveOutbound(connectionId: string): OutboundEraAdapter | undefined;
  now?: () => number;
  maxActiveRequests?: number;
}

function pinsEqual(left: ProtocolEraPin, right: ProtocolEraPin): boolean {
  return left.era === right.era && left.revision === right.revision;
}

export class GatewayDispatcher {
  private readonly active = new Map<string, OutboundEraAdapter>();
  private readonly dispatched = new WeakSet<GatewayRequestEnvelope>();
  private readonly now: () => number;

  constructor(private readonly dependencies: GatewayDispatcherDependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  async dispatch(request: GatewayRequestEnvelope): Promise<GatewayResult<ImmutableJsonValue>> {
    if (this.active.has(request.requestId) || this.dispatched.has(request)) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'invalid-request',
          code: 'gateway_request_already_active',
          message: 'The gateway request id has already been dispatched',
        }),
      );
    }
    // Completed operation ownership follows the envelope lifetime, not reusable wire request IDs.
    if (this.active.size >= (this.dependencies.maxActiveRequests ?? 256)) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'transport',
          code: 'gateway_overloaded',
          message: 'Gateway request capacity exceeded',
        }),
      );
    }
    if (!authorityAllows(request.authority, request.targetConnectionId)) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'authorization',
          code: 'gateway_target_not_authorized',
          message: 'The request target is outside the effective authority',
        }),
      );
    }
    if (request.deadlineUnixMs <= this.now()) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'deadline-exceeded',
          code: 'gateway_deadline_exceeded',
          message: 'The gateway request deadline has expired',
        }),
      );
    }

    const outbound = this.dependencies.resolveOutbound(request.targetConnectionId);
    if (!outbound) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'transport',
          code: 'gateway_target_unavailable',
          message: 'No outbound adapter is available',
        }),
      );
    }
    if (!pinsEqual(outbound.pin, request.outbound)) {
      return gatewayFailure(
        createGatewayFailure({
          kind: 'protocol',
          code: 'gateway_outbound_pin_mismatch',
          message: 'The outbound adapter does not match the request era pin',
        }),
      );
    }

    const outboundRequest: OutboundGatewayRequest = Object.freeze({
      requestId: request.requestId,
      operation: request.operation,
      ...(request.params === undefined ? {} : { params: request.params }),
      authority: request.authority,
      deadlineUnixMs: request.deadlineUnixMs,
    });
    this.active.set(request.requestId, outbound);
    this.dispatched.add(request);
    try {
      return gatewaySuccess(toImmutableJsonValue(await outbound.request(outboundRequest)));
    } catch (error) {
      const failure = gatewayFailureFromUnknown(error, 'transport');
      return gatewayFailure(
        request.operation === 'tools/call' && failure.kind === 'transport'
          ? createGatewayFailure({
              kind: 'transport',
              code: 'gateway_tool_outcome_unknown',
              message: 'Tool execution may have occurred; the outcome is unknown',
            })
          : failure,
      );
    } finally {
      if (this.active.get(request.requestId) === outbound) this.active.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const outbound = this.active.get(requestId);
    if (!outbound) return false;
    await outbound.cancel(requestId);
    return true;
  }
}
