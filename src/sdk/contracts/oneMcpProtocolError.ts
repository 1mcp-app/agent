import { type JsonValue, toJsonValue } from './jsonValue.js';

export interface ProtocolErrorLike {
  readonly code: unknown;
  readonly message: unknown;
  readonly data?: unknown;
}

function readOwnDataProperty(error: object, property: string, optional = false): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(error, property);
  if (!descriptor) {
    if (optional) return undefined;
    throw new TypeError(`Protocol error ${property} must be an own data property`);
  }
  if (!('value' in descriptor)) throw new TypeError(`Protocol error ${property} must be a data property`);
  return descriptor.value as unknown;
}

export class OneMcpProtocolError extends Error {
  readonly code: number;
  readonly data?: JsonValue;

  constructor(code: number, message: string, data?: unknown) {
    if (!Number.isSafeInteger(code)) throw new TypeError('Protocol error code must be a safe integer');
    if (typeof message !== 'string') throw new TypeError('Protocol error message must be a string');
    super(message);
    this.name = 'OneMcpProtocolError';
    this.code = code;
    if (data !== undefined) this.data = toJsonValue(data);
  }

  static fromUnknown(error: unknown): OneMcpProtocolError {
    if (typeof error !== 'object' || error === null) {
      throw new TypeError('Protocol error must be an object');
    }

    return new OneMcpProtocolError(
      readOwnDataProperty(error, 'code') as number,
      readOwnDataProperty(error, 'message') as string,
      readOwnDataProperty(error, 'data', true),
    );
  }

  toJSON(): { code: number; message: string; data?: JsonValue } {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: toJsonValue(this.data) };
  }
}
