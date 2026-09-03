import {
  createEffectiveRequestAuthority,
  createGatewayCancellation,
  gatewayFailureFromUnknown,
  type ImmutableJsonValue,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../../ports/index.js';
import { requireModernPin } from './modernPin.js';

export interface ModernOutboundAdapterCallbacks {
  /** Receives a detached, recursively frozen JSON request frame. */
  readonly request: (request: ImmutableJsonValue) => Promise<unknown>;
  /** Receives the exact gateway request id being cancelled. */
  readonly cancel: (requestId: string) => Promise<void>;
  readonly close?: () => Promise<void>;
}

export interface ModernOutboundEraAdapterOptions extends ModernOutboundAdapterCallbacks {
  readonly revision: unknown;
}

/** Modern-only outbound shell. It is intentionally unattached to a backend factory. */
export class ModernOutboundEraAdapter implements OutboundEraAdapter {
  readonly role = 'outbound' as const;
  readonly pin: ProtocolEraPin;
  readonly #callbacks: ModernOutboundAdapterCallbacks;

  constructor(options: ModernOutboundEraAdapterOptions) {
    this.pin = requireModernPin(options.revision);
    this.#callbacks = Object.freeze({
      request: options.request,
      cancel: options.cancel,
      ...(options.close === undefined ? {} : { close: options.close }),
    });
    Object.freeze(this);
  }

  async request(request: OutboundGatewayRequest): Promise<ImmutableJsonValue> {
    const frame = toImmutableJsonValue({
      requestId: request.requestId,
      operation: request.operation,
      ...(request.params === undefined ? {} : { params: request.params }),
      authority: createEffectiveRequestAuthority(request.authority),
      deadlineUnixMs: request.deadlineUnixMs,
    });
    try {
      return toImmutableJsonValue(await this.#callbacks.request(frame));
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }

  async cancel(requestId: string): Promise<void> {
    const cancellation = createGatewayCancellation(requestId);
    try {
      await this.#callbacks.cancel(cancellation.requestId);
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }

  async close(): Promise<void> {
    try {
      await this.#callbacks.close?.();
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }
}
