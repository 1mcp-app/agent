import type {
  EffectiveRequestAuthority,
  GatewayOperation,
  ImmutableJsonValue,
  ProtocolEraPin,
} from '../contracts/index.js';

export interface OutboundGatewayRequest {
  readonly requestId: string;
  readonly operation: GatewayOperation;
  readonly params?: ImmutableJsonValue;
  readonly authority: EffectiveRequestAuthority;
  readonly deadlineUnixMs: number;
}

export interface OutboundEraAdapter {
  readonly role: 'outbound';
  readonly pin: ProtocolEraPin;
  request(request: OutboundGatewayRequest): Promise<ImmutableJsonValue>;
  cancel(requestId: string): Promise<void>;
  close(): Promise<void>;
}
