import {
  createEffectiveRequestAuthority,
  createGatewayFailure,
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
  readonly now?: () => number;
}

/** Modern-only outbound shell. It is intentionally unattached to a backend factory. */
export class ModernOutboundEraAdapter implements OutboundEraAdapter {
  readonly role = 'outbound' as const;
  readonly pin: ProtocolEraPin;
  readonly #callbacks: ModernOutboundAdapterCallbacks;
  readonly #now: () => number;
  readonly #activeRequestIds = new Set<string>();
  readonly #cancelledRequestIds = new Set<string>();

  constructor(options: ModernOutboundEraAdapterOptions) {
    this.pin = requireModernPin(options.revision);
    this.#callbacks = Object.freeze({
      request: options.request,
      cancel: options.cancel,
      ...(options.close === undefined ? {} : { close: options.close }),
    });
    this.#now = options.now ?? Date.now;
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
    if (this.#activeRequestIds.has(request.requestId)) {
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'modern_outbound_duplicate_request',
        message: 'The modern outbound request id is already active',
      });
    }
    if (request.deadlineUnixMs <= this.#now()) {
      throw createGatewayFailure({
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'The gateway request deadline has expired',
      });
    }

    this.#activeRequestIds.add(request.requestId);
    try {
      return toImmutableJsonValue(await this.#callbacks.request(frame));
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    } finally {
      this.#activeRequestIds.delete(request.requestId);
      this.#cancelledRequestIds.delete(request.requestId);
    }
  }

  async cancel(requestId: string): Promise<void> {
    if (!this.#activeRequestIds.has(requestId) || this.#cancelledRequestIds.has(requestId)) return;
    this.#cancelledRequestIds.add(requestId);
    try {
      await this.#callbacks.cancel(requestId);
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
