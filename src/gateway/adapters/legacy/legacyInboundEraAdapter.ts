import {
  createGatewayCancellation,
  createGatewayFailure,
  createGatewayRequestEnvelope,
  type GatewayFailure,
  gatewayFailureFromUnknown,
  type ProtocolEraPin,
  toImmutableJsonValue,
} from '../../contracts/index.js';
import type { InboundEraAdapter, InboundGatewayEvent, InboundGatewayResponse } from '../../ports/index.js';
import { createLegacyEraPin } from './legacyEraPin.js';

/** Transport-neutral channel used by isolated legacy inbound fixtures. */
export interface LegacyInboundChannel {
  nextEvent(): Promise<InboundGatewayEvent>;
  respond(response: InboundGatewayResponse): Promise<void>;
  close(): Promise<void>;
}

function copyFailure(failure: GatewayFailure): GatewayFailure {
  return createGatewayFailure({
    kind: failure.kind,
    code: failure.code,
    message: failure.message,
    ...(failure.data === undefined ? {} : { data: failure.data }),
  });
}

function pinsEqual(left: ProtocolEraPin, right: ProtocolEraPin): boolean {
  return left.era === right.era && left.revision === right.revision;
}

function copyEvent(event: InboundGatewayEvent, pin: ProtocolEraPin): InboundGatewayEvent {
  switch (event.type) {
    case 'request': {
      const request = createGatewayRequestEnvelope(event.request);
      if (!pinsEqual(request.inbound, pin)) {
        throw createGatewayFailure({
          kind: 'protocol',
          code: 'gateway_inbound_pin_mismatch',
          message: 'The inbound request does not match the legacy adapter era pin',
        });
      }
      return Object.freeze({ type: 'request', request });
    }
    case 'cancel':
      return createGatewayCancellation(event.requestId);
    case 'failure':
      return Object.freeze({ type: 'failure', failure: copyFailure(event.failure) });
    case 'closed':
      return Object.freeze({ type: 'closed' });
  }
}

function copyResponse(response: InboundGatewayResponse): InboundGatewayResponse {
  if (response.type === 'success') {
    return Object.freeze({
      type: 'success',
      requestId: response.requestId,
      result: toImmutableJsonValue(response.result),
    });
  }
  return Object.freeze({
    type: 'failure',
    requestId: response.requestId,
    failure: copyFailure(response.failure),
  });
}

/** Inbound role shell only; production serving remains attached to the legacy runtime. */
export class LegacyInboundEraAdapter implements InboundEraAdapter {
  readonly role = 'inbound' as const;
  readonly pin: ProtocolEraPin;

  constructor(
    private readonly channel: LegacyInboundChannel,
    pin: ProtocolEraPin,
  ) {
    this.pin = createLegacyEraPin(pin);
  }

  async nextEvent(): Promise<InboundGatewayEvent> {
    let event: InboundGatewayEvent;
    try {
      event = await this.channel.nextEvent();
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
    return copyEvent(event, this.pin);
  }

  async respond(response: InboundGatewayResponse): Promise<void> {
    const copied = copyResponse(response);
    try {
      await this.channel.respond(copied);
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }

  async close(): Promise<void> {
    try {
      await this.channel.close();
    } catch (error) {
      throw gatewayFailureFromUnknown(error, 'transport');
    }
  }
}
