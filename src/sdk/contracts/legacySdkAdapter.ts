import type { JsonValue } from './jsonValue.js';
import type { OneMcpProtocolError } from './oneMcpProtocolError.js';

declare const legacyConnectionIdBrand: unique symbol;
declare const legacyRequestIdBrand: unique symbol;
declare const legacyTimeoutMsBrand: unique symbol;

export type LegacyConnectionId = string & { readonly [legacyConnectionIdBrand]: true };
export type LegacyRequestId = string & { readonly [legacyRequestIdBrand]: true };
export type LegacyTimeoutMs = number & { readonly [legacyTimeoutMsBrand]: true };

export function createLegacyTimeoutMs(value: number): LegacyTimeoutMs {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('Legacy request timeout must be a finite positive integer');
  }
  return value as LegacyTimeoutMs;
}

export interface LegacySdkRequest {
  readonly id: LegacyRequestId;
  readonly method: string;
  readonly params?: JsonValue;
  readonly timeoutMs?: LegacyTimeoutMs;
}

export interface LegacySdkNotification {
  readonly method: string;
  readonly params?: JsonValue;
}

export type LegacySdkLifecycleState = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped';
export type LegacySdkFailurePhase = 'start' | 'request' | 'notification' | 'close';

export interface LegacySdkFailure {
  readonly phase: LegacySdkFailurePhase;
  readonly error: OneMcpProtocolError;
  readonly requestId?: LegacyRequestId;
}

export interface LegacySdkRequestEvent {
  readonly type: 'request';
  readonly request: LegacySdkRequest;
}

export interface LegacySdkNotificationEvent {
  readonly type: 'notification';
  readonly notification: LegacySdkNotification;
}

export interface LegacySdkFailureEvent {
  readonly type: 'failure';
  readonly failure: LegacySdkFailure;
}

export interface LegacySdkClosedEvent {
  readonly type: 'closed';
}

export type LegacySdkEvent =
  LegacySdkRequestEvent | LegacySdkNotificationEvent | LegacySdkFailureEvent | LegacySdkClosedEvent;

export interface LegacySdkSuccessResponse {
  readonly type: 'success';
  readonly requestId: LegacyRequestId;
  readonly result: JsonValue;
}

export interface LegacySdkErrorResponse {
  readonly type: 'error';
  readonly requestId: LegacyRequestId;
  readonly error: OneMcpProtocolError;
}

export type LegacySdkResponse = LegacySdkSuccessResponse | LegacySdkErrorResponse;

/** SDK-free interface implemented inside the complete current-runtime legacy island. */
export interface LegacySdkAdapter {
  readonly connectionId: LegacyConnectionId;
  readonly state: LegacySdkLifecycleState;
  start(): Promise<void>;
  nextEvent(): Promise<LegacySdkEvent>;
  respond(response: LegacySdkResponse): Promise<void>;
  request(request: LegacySdkRequest): Promise<JsonValue>;
  cancel(requestId: LegacyRequestId): Promise<void>;
  notify(notification: LegacySdkNotification): Promise<void>;
  close(): Promise<void>;
}
