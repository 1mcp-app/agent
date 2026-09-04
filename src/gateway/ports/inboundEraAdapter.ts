import type {
  GatewayCancellation,
  GatewayFailure,
  GatewayRequestEnvelope,
  ImmutableJsonValue,
  ProtocolEraPin,
} from '../contracts/index.js';

export type InboundGatewayEvent =
  | Readonly<{ type: 'request'; request: GatewayRequestEnvelope }>
  | GatewayCancellation
  | Readonly<{ type: 'failure'; failure: GatewayFailure }>
  | Readonly<{ type: 'closed' }>;

export type InboundGatewayResponse =
  | Readonly<{ type: 'success'; requestId: string; result: ImmutableJsonValue }>
  | Readonly<{ type: 'failure'; requestId: string; failure: GatewayFailure }>;

export interface InboundEraAdapter {
  readonly role: 'inbound';
  readonly pin: ProtocolEraPin;
  nextEvent(): Promise<InboundGatewayEvent>;
  respond(response: InboundGatewayResponse): Promise<void>;
  close(): Promise<void>;
}
