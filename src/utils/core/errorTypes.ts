import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class MCPError extends Error {
  code: number;
  data?: any;

  constructor(message: string, code: number, data?: any) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.data = data;
  }
}

export class ClientConnectionError extends MCPError {
  constructor(clientName: string, cause: Error) {
    super(`Failed to connect to client ${clientName}: ${cause.message}`, ErrorCode.ConnectionClosed, { cause });
    this.name = 'ClientConnectionError';
  }
}

export class ClientNotFoundError extends MCPError {
  constructor(clientName: string) {
    super(`Client '${clientName}' not found`, ErrorCode.MethodNotFound, { clientName });
    this.name = 'ClientNotFoundError';
  }
}

export class ClientOperationError extends MCPError {
  constructor(clientName: string, operation: string, cause: Error, context?: Record<string, unknown>) {
    super(`Operation ${operation} failed on client ${clientName}: ${cause.message}`, ErrorCode.InternalError, {
      cause,
      context,
    });
    this.name = 'ClientOperationError';
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, validationErrors: any) {
    super(message, ErrorCode.InvalidParams, { validationErrors });
    this.name = 'ValidationError';
  }
}

export class TransportError extends MCPError {
  constructor(transportName: string, cause: Error) {
    super(`Transport error for ${transportName}: ${cause.message}`, ErrorCode.InternalError, { cause });
    this.name = 'TransportError';
  }
}

export class InvalidRequestError extends MCPError {
  constructor(message: string, data?: any) {
    super(message, ErrorCode.InvalidRequest, data);
    this.name = 'InvalidRequestError';
  }
}

export class CapabilityError extends MCPError {
  constructor(clientName: string, capability: string) {
    super(`Client '${clientName}' does not support the '${capability}' capability`, ErrorCode.MethodNotFound, {
      clientName,
      capability,
    });
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
