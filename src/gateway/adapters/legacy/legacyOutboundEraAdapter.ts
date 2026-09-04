import {
  createLegacyTimeoutMs,
  type LegacyRequestId,
  type LegacySdkAdapter,
  toJsonValue,
} from '@src/sdk/contracts/index.js';

import {
  createGatewayFailure,
  gatewayFailureFromUnknown,
  type ImmutableJsonValue,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../../ports/index.js';
import { createLegacyEraPin } from './legacyEraPin.js';

export interface LegacyOutboundEraAdapterOptions {
  readonly now?: () => number;
}

interface ActiveLegacyRequest {
  readonly requestId: LegacyRequestId;
  cancellation?: Promise<void>;
}

function toLegacyRequestId(requestId: string): LegacyRequestId {
  if (!requestId) throw new TypeError('Gateway request id is required');
  return requestId as LegacyRequestId;
}

/** SDK-free outbound gateway port backed by the contained legacy adapter. */
export class LegacyOutboundEraAdapter implements OutboundEraAdapter {
  readonly role = 'outbound' as const;
  readonly pin: ProtocolEraPin;

  private readonly now: () => number;
  private readonly active = new Map<string, ActiveLegacyRequest>();

  constructor(
    private readonly legacy: LegacySdkAdapter,
    pin: ProtocolEraPin,
    options: LegacyOutboundEraAdapterOptions = {},
  ) {
    this.pin = createLegacyEraPin(pin);
    this.now = options.now ?? Date.now;
  }

  async request(request: OutboundGatewayRequest): Promise<ImmutableJsonValue> {
    if (this.active.has(request.requestId)) {
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'gateway_request_already_active',
        message: 'The gateway request id is already active',
      });
    }

    const requestId = toLegacyRequestId(request.requestId);
    const params = request.params === undefined ? undefined : toJsonValue(request.params);
    const remainingMs = Math.floor(request.deadlineUnixMs - this.now());
    if (remainingMs <= 0) {
      throw createGatewayFailure({
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'The gateway request deadline has expired',
      });
    }

    this.active.set(request.requestId, { requestId });
    try {
      const result = await this.legacy.request({
        id: requestId,
        method: request.operation,
        ...(params === undefined ? {} : { params }),
        timeoutMs: createLegacyTimeoutMs(remainingMs),
      });
      return toImmutableJsonValue(result);
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    } finally {
      this.active.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    const active = this.active.get(requestId);
    if (!active) return;
    active.cancellation ??= Promise.resolve()
      .then(() => this.legacy.cancel(active.requestId))
      .catch((error: unknown) => {
        throw gatewayFailureFromUnknown(error, 'transport');
      });
    await active.cancellation;
  }

  async close(): Promise<void> {
    try {
      await this.legacy.close();
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }
}
