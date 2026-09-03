import {
  classifyProtocolEra,
  createEffectiveRequestAuthority,
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
  /** Receives a detached, recursively frozen JSON response frame. */
  readonly respond: (response: ImmutableJsonValue) => Promise<void>;
  readonly close?: () => Promise<void>;
}

export interface ModernInboundEraAdapterOptions extends ModernInboundAdapterCallbacks {
  readonly revision: unknown;
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

function stringArray(value: ImmutableJsonValue | undefined): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError('authority fields must be string arrays');
  }
  return value as readonly string[];
}

function parseAuthority(value: ImmutableJsonValue | undefined): EffectiveRequestAuthority {
  if (!value || !isRecord(value)) throw new TypeError('authority must be an object');
  return createEffectiveRequestAuthority({
    connectionIds: stringArray(value.connectionIds),
    provenance: value.provenance === undefined ? [] : stringArray(value.provenance),
  });
}

function parseOutboundPin(value: ImmutableJsonValue | undefined): ProtocolEraPin {
  if (!value || !isRecord(value)) throw new TypeError('outbound pin must be an object');
  const era = value.era;
  if (era !== 'legacy' && era !== 'modern') throw new TypeError('outbound era is invalid');
  const classified = classifyProtocolEra({ syntax: era, revision: value.revision });
  if (!classified.ok) throw classified.failure;
  return classified.value;
}

/** Modern-only inbound shell. It is intentionally unattached to a serving route. */
export class ModernInboundEraAdapter implements InboundEraAdapter {
  readonly role = 'inbound' as const;
  readonly pin: ProtocolEraPin;
  readonly #callbacks: ModernInboundAdapterCallbacks;

  constructor(options: ModernInboundEraAdapterOptions) {
    this.pin = requireModernPin(options.revision);
    this.#callbacks = Object.freeze({
      receive: options.receive,
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

    try {
      if (frame.type === 'cancel') {
        return createGatewayCancellation(requiredString(frame, 'requestId'));
      }
      if (frame.type !== 'request') return invalidModernRequest();

      const deadlineUnixMs = frame.deadlineUnixMs;
      if (typeof deadlineUnixMs !== 'number') throw new TypeError('deadlineUnixMs must be a number');
      const request = createGatewayRequestEnvelope({
        requestId: requiredString(frame, 'requestId'),
        operation: requiredString(frame, 'operation') as 'tools/list',
        targetConnectionId: requiredString(frame, 'targetConnectionId'),
        ...(frame.params === undefined ? {} : { params: frame.params }),
        authority: parseAuthority(frame.authority),
        inbound: this.pin,
        outbound: parseOutboundPin(frame.outbound),
        deadlineUnixMs,
      });
      return Object.freeze({ type: 'request', request });
    } catch {
      return invalidModernRequest();
    }
  }

  async respond(response: InboundGatewayResponse): Promise<void> {
    const frame =
      response.type === 'success'
        ? toImmutableJsonValue({
            type: 'success',
            requestId: response.requestId,
            result: response.result,
          })
        : toImmutableJsonValue({
            type: 'failure',
            requestId: response.requestId,
            failure: response.failure,
          });
    try {
      await this.#callbacks.respond(frame);
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
