import type { JsonValue } from './jsonValue.js';
import type { OneMcpProtocolError } from './oneMcpProtocolError.js';

declare const legacyConnectionIdBrand: unique symbol;
declare const legacyRequestIdBrand: unique symbol;

export type LegacyConnectionId = string & { readonly [legacyConnectionIdBrand]: true };
export type LegacyRequestId = string & { readonly [legacyRequestIdBrand]: true };

export interface LegacySdkRequest {
  readonly id: LegacyRequestId;
  readonly method: string;
  readonly params?: JsonValue;
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

export interface LegacySdkAdapterEvents {
  onNotification(notification: LegacySdkNotification): void | Promise<void>;
  onFailure(failure: LegacySdkFailure): void | Promise<void>;
  onClose(): void | Promise<void>;
}

/** SDK-free interface implemented inside the complete current-runtime legacy island. */
export interface LegacySdkAdapter {
  readonly connectionId: LegacyConnectionId;
  readonly state: LegacySdkLifecycleState;
  start(events: LegacySdkAdapterEvents): Promise<void>;
  request(request: LegacySdkRequest): Promise<JsonValue>;
  notify(notification: LegacySdkNotification): Promise<void>;
  close(): Promise<void>;
}
