import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class MCPError extends Error {
  code: number;
  data?: unknown;

  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.data = data;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, MCPError.prototype);
  }
}

export class ClientConnectionError extends MCPError {
  constructor(clientName: string, cause: Error) {
    super(`Failed to connect to client ${clientName}: ${cause.message}`, ErrorCode.ConnectionClosed, { cause });
    this.name = 'ClientConnectionError';
    Object.setPrototypeOf(this, ClientConnectionError.prototype);
  }
}

export class ClientNotFoundError extends MCPError {
  constructor(clientName: string) {
    super(`Client '${clientName}' not found`, ErrorCode.MethodNotFound, { clientName });
    this.name = 'ClientNotFoundError';
    Object.setPrototypeOf(this, ClientNotFoundError.prototype);
  }
}

export class ClientOperationError extends MCPError {
  constructor(clientName: string, operation: string, cause: Error, context?: Record<string, unknown>) {
    super(`Operation ${operation} failed on client ${clientName}: ${cause.message}`, ErrorCode.InternalError, {
      cause,
      context,
    });
    this.name = 'ClientOperationError';
    Object.setPrototypeOf(this, ClientOperationError.prototype);
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, validationErrors: unknown) {
    super(message, ErrorCode.InvalidParams, { validationErrors });
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class TransportError extends MCPError {
  constructor(transportName: string, cause: Error) {
    super(`Transport error for ${transportName}: ${cause.message}`, ErrorCode.InternalError, { cause });
    this.name = 'TransportError';
    Object.setPrototypeOf(this, TransportError.prototype);
  }
}

export class InvalidRequestError extends MCPError {
  constructor(message: string, data?: unknown) {
    super(message, ErrorCode.InvalidRequest, data);
    this.name = 'InvalidRequestError';
    Object.setPrototypeOf(this, InvalidRequestError.prototype);
  }
}

export class CapabilityError extends MCPError {
  constructor(clientName: string, capability: string) {
    super(`Client '${clientName}' does not support the '${capability}' capability`, ErrorCode.MethodNotFound, {
      clientName,
      capability,
    });
    this.name = 'CapabilityError';
    Object.setPrototypeOf(this, CapabilityError.prototype);
  }
}

export type MCPErrorType =
  | ClientConnectionError
  | ClientNotFoundError
  | ClientOperationError
  | ValidationError
  | TransportError
  | InvalidRequestError
  | CapabilityError;
