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

export interface GatewayInteractionRequest {
  readonly method: 'elicitation/create' | 'sampling/createMessage' | 'roots/list';
  readonly params?: ImmutableJsonValue;
}

export interface GatewayRequestOptions {
  readonly interaction?: (input: GatewayInteractionRequest) => Promise<ImmutableJsonValue>;
  readonly interactionRound?: (
    inputs: GatewayInteractionRound,
  ) => Promise<Readonly<Record<string, ImmutableJsonValue>>>;
}

export type GatewayInteractionRound = Readonly<Record<string, GatewayInteractionRequest>>;

export interface OutboundEraAdapter {
  readonly role: 'outbound';
  readonly pin: ProtocolEraPin;
  request(request: OutboundGatewayRequest, options?: GatewayRequestOptions): Promise<ImmutableJsonValue>;
  cancel(requestId: string): Promise<void>;
  close(): Promise<void>;
}
