import type { JSONRPCError, JSONRPCMessage, JSONRPCRequest, JSONRPCResponse } from '@modelcontextprotocol/sdk/types.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ProtocolValidator {
  static isJSONRPCMessage(message: unknown): message is JSONRPCMessage {
    return (
      typeof message === 'object' && message !== null && 'jsonrpc' in message && (message as any).jsonrpc === '2.0'
    );
  }

  static isJSONRPCRequest(message: unknown): message is JSONRPCRequest {
    return this.isJSONRPCMessage(message) && 'method' in message && typeof (message as any).method === 'string';
  }

  static isJSONRPCResponse(message: unknown): message is JSONRPCResponse {
    return this.isJSONRPCMessage(message) && 'id' in message && ('result' in message || 'error' in message);
  }

  static isJSONRPCError(error: unknown): error is JSONRPCError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as any).code === 'number' &&
      typeof (error as any).message === 'string'
    );
  }

  static validateMessage(message: unknown): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    if (!this.isJSONRPCMessage(message)) {
      result.valid = false;
      result.errors.push('Message must be a valid JSON-RPC 2.0 message');
      return result;
    }

    // Additional validation for message structure
    if ('method' in message) {
      // It's a request - check if it needs an id
      if (!('id' in message) && !this.isNotification(message)) {
        result.valid = false;
        result.errors.push('Request must have an id unless it is a notification');
      }
    } else if ('result' in message || 'error' in message) {
      // It's a response - must have an id
      if (!('id' in message)) {
        result.valid = false;
        result.errors.push('Response must have an id');
      }
    }

    return result;
  }

  static validateRequest(request: unknown): ValidationResult {
    const result = this.validateMessage(request);

    if (!result.valid) {
      return result;
    }

    if (!this.isJSONRPCRequest(request)) {
      result.valid = false;
      result.errors.push('Message must be a valid JSON-RPC request');
      return result;
    }

    // Additional request-specific validation
    if ('params' in request && request.params !== undefined) {
      if (typeof request.params !== 'object' || request.params === null) {
        result.valid = false;
        result.errors.push('Request params must be an object if present');
      }
    }

    return result;
  }

  static validateResponse(response: unknown): ValidationResult {
    const result = this.validateMessage(response);

    if (!result.valid) {
      return result;
    }

    if (!this.isJSONRPCResponse(response)) {
      result.valid = false;
      result.errors.push('Message must be a valid JSON-RPC response');
      return result;
    }

    const hasResult = 'result' in response;
    const hasError = 'error' in response;

    if (hasResult && hasError) {
      result.valid = false;
      result.errors.push('Response cannot have both result and error');
    }

    if (!hasResult && !hasError) {
      result.valid = false;
      result.errors.push('Response must have either result or error');
    }

    if (hasError && 'error' in response) {
      const errorValidation = this.validateError(response.error);
      if (!errorValidation.valid) {
        result.valid = false;
        result.errors.push(...errorValidation.errors);
      }
    }

    return result;
  }

  static validateError(error: unknown): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    if (!this.isJSONRPCError(error)) {
      result.valid = false;
      result.errors.push('Error must be a valid JSON-RPC error object');
      return result;
    }

    // Additional error-specific validation
    if ('data' in error && error.data !== undefined) {
      // Data can be any JSON value, so minimal validation
      if (typeof error.data === 'function' || typeof error.data === 'symbol') {
        result.valid = false;
        result.errors.push('Error data must be a valid JSON value');
      }
    }

    return result;
  }

  static validateMcpMethod(method: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
    };

    const validMethods = [
      'initialize',
      'ping',
      'tools/list',
      'tools/call',
      'resources/list',
      'resources/read',
      'resources/templates/list',
      'resources/subscribe',
      'resources/unsubscribe',
      'prompts/list',
      'prompts/get',
      'logging/setLevel',
    ];

    if (!validMethods.includes(method)) {
      result.warnings.push(`Method '${method}' is not a standard MCP method`);
    }

    return result;
  }

  private static isNotification(message: JSONRPCMessage): boolean {
    // Notifications are requests without an id
    return 'method' in message && !('id' in message);
  }

  static validateInitializeRequest(request: unknown): ValidationResult {
    const result = this.validateRequest(request);

    if (!result.valid) {
      return result;
    }

    if (!this.isJSONRPCRequest(request)) {
      result.valid = false;
      result.errors.push('Must be a valid JSON-RPC request');
      return result;
    }

    if (request.method !== 'initialize') {
      result.valid = false;
      result.errors.push('Must be an initialize request');
      return result;
    }

    if (!('params' in request) || !request.params || typeof request.params !== 'object') {
      result.valid = false;
      result.errors.push('Initialize request must have params object');
      return result;
    }

    const params = request.params as any;

    if (!params.protocolVersion || typeof params.protocolVersion !== 'string') {
      result.valid = false;
      result.errors.push('Initialize params must have protocolVersion string');
    }

    if (!params.capabilities || typeof params.capabilities !== 'object') {
      result.valid = false;
      result.errors.push('Initialize params must have capabilities object');
    }

    if (!params.clientInfo || typeof params.clientInfo !== 'object') {
      result.valid = false;
      result.errors.push('Initialize params must have clientInfo object');
    }

    return result;
  }
}
