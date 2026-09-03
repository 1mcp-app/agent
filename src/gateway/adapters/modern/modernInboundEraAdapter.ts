import {
  createGatewayCancellation,
  createGatewayFailure,
  createGatewayRequestEnvelope,
  type EffectiveRequestAuthority,
  gatewayFailureFromUnknown,
  type ImmutableJsonValue,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../../contracts/index.js';
import type { InboundEraAdapter, InboundGatewayEvent, InboundGatewayResponse } from '../../ports/index.js';
import { requireModernPin } from './modernPin.js';

export interface ModernInboundAdapterCallbacks {
  /** Returns one decoded modern frame, or undefined once the fixture/transport closes. */
  readonly receive: () => Promise<unknown>;
  /** Derives gateway-owned context without trusting fields on the decoded wire frame. */
  readonly requestContext: (
    correlationId: string,
  ) => ModernInboundRequestContext | Promise<ModernInboundRequestContext>;
  /** Receives a detached, recursively frozen JSON response frame. */
  readonly respond: (response: ImmutableJsonValue) => Promise<void>;
  readonly close?: () => Promise<void>;
}

export interface ModernInboundEraAdapterOptions extends ModernInboundAdapterCallbacks {
  readonly revision: unknown;
}

export interface ModernInboundRequestContext {
  readonly requestId: string;
  readonly targetConnectionId: string;
  readonly authority: EffectiveRequestAuthority;
  readonly outbound: ProtocolEraPin;
  readonly deadlineUnixMs: number;
}

function invalidModernRequest(): InboundGatewayEvent {
  return Object.freeze({
    type: 'failure',
    failure: createGatewayFailure({
      kind: 'invalid-request',
      code: 'modern_request_invalid',
      message: 'The modern request frame is malformed or unsupported',
    }),
  });
}

function isRecord(value: ImmutableJsonValue): value is { readonly [key: string]: ImmutableJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(record: { readonly [key: string]: ImmutableJsonValue }, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${key} must be a non-empty string`);
  return value;
}

/** Modern-only inbound shell. It is intentionally unattached to a serving route. */
export class ModernInboundEraAdapter implements InboundEraAdapter {
  readonly role = 'inbound' as const;
  readonly pin: ProtocolEraPin;
  readonly #callbacks: ModernInboundAdapterCallbacks;
  readonly #correlationByRequestId = new Map<string, string>();
  readonly #requestIdByCorrelation = new Map<string, string>();

  constructor(options: ModernInboundEraAdapterOptions) {
    this.pin = requireModernPin(options.revision);
    this.#callbacks = Object.freeze({
      receive: options.receive,
      requestContext: options.requestContext,
      respond: options.respond,
      ...(options.close === undefined ? {} : { close: options.close }),
    });
    Object.freeze(this);
  }

  async nextEvent(): Promise<InboundGatewayEvent> {
    let raw: unknown;
    try {
      raw = await this.#callbacks.receive();
    } catch (error) {
      return Object.freeze({ type: 'failure', failure: gatewayFailureFromUnknown(error, 'transport') });
    }

    if (raw === undefined) return Object.freeze({ type: 'closed' });

    let frame: ImmutableJsonValue;
    try {
      frame = toImmutableJsonValue(raw);
    } catch {
      return invalidModernRequest();
    }
    if (!isRecord(frame)) return invalidModernRequest();

    if (frame.type === 'cancel') {
      try {
        const requestId = this.#requestIdByCorrelation.get(requiredString(frame, 'correlationId'));
        return requestId === undefined ? invalidModernRequest() : createGatewayCancellation(requestId);
      } catch {
        return invalidModernRequest();
      }
    }
    if (frame.type !== 'request') return invalidModernRequest();

    let correlationId: string;
    let operation: string;
    try {
      correlationId = requiredString(frame, 'correlationId');
      operation = requiredString(frame, 'operation');
    } catch {
      return invalidModernRequest();
    }

    let context: ModernInboundRequestContext;
    try {
      context = await this.#callbacks.requestContext(correlationId);
    } catch (error) {
      return Object.freeze({ type: 'failure', failure: gatewayFailureFromUnknown(error, 'transport') });
    }

    try {
      const request = createGatewayRequestEnvelope({
        requestId: context.requestId,
        operation: operation as 'tools/list',
        targetConnectionId: context.targetConnectionId,
        ...(frame.params === undefined ? {} : { params: frame.params }),
        authority: context.authority,
        inbound: this.pin,
        outbound: context.outbound,
        deadlineUnixMs: context.deadlineUnixMs,
      });
      if (this.#correlationByRequestId.has(request.requestId) || this.#requestIdByCorrelation.has(correlationId)) {
        return invalidModernRequest();
      }
      this.#correlationByRequestId.set(request.requestId, correlationId);
      this.#requestIdByCorrelation.set(correlationId, request.requestId);
      return Object.freeze({ type: 'request', request });
    } catch {
      return invalidModernRequest();
    }
  }

  async respond(response: InboundGatewayResponse): Promise<void> {
    const correlationId = this.#correlationByRequestId.get(response.requestId);
    if (correlationId === undefined) {
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'modern_response_unknown_request',
        message: 'The modern response does not match an active request',
      });
    }
    const frame =
      response.type === 'success'
        ? toImmutableJsonValue({
            type: 'success',
            correlationId,
            result: response.result,
          })
        : toImmutableJsonValue({
            type: 'failure',
            correlationId,
            failure: response.failure,
          });
    try {
      await this.#callbacks.respond(frame);
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    } finally {
      this.#correlationByRequestId.delete(response.requestId);
      this.#requestIdByCorrelation.delete(correlationId);
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
