import logger from '@src/logger/logger.js';

/**
 * Unified logging for HTTP transport and JSON-RPC messages.
 * All logs follow the same format with consistent metadata including sessionId.
 * Error level includes additional details (stack traces, error messages).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BaseLogOptions {
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface HttpLogOptions extends BaseLogOptions {
  method?: string;
  path?: string;
  statusCode?: number;
  reason?: string;
  phase?: string;
  headers?: Record<string, string | undefined>;
}

export interface ErrorLogOptions extends HttpLogOptions {
  error?: unknown;
}

export interface JsonRpcLogOptions extends BaseLogOptions {
  jsonrpcVersion?: string;
  requestId?: string | number;
  errorCode?: number;
  errorMessage?: string;
  errorData?: unknown;
}

/**
 * Unified logging function for all log levels.
 * Error level includes stack traces and additional error details.
 *
 * @param level - Log level ('debug' | 'info' | 'warn' | 'error')
 * @param message - Log message prefix
 * @param options - Log metadata options
 */
export function log(level: LogLevel, message: string, options: BaseLogOptions = {}): void {
  const { sessionId, context = {} } = options;

  const metadata: Record<string, unknown> = {
    sessionId: sessionId || '(none)',
    ...context,
  };

  // Map level to logger function
  const logFn = logger[level];
  if (typeof logFn === 'function') {
    logFn(message, metadata);
  }
}

/**
 * Logs HTTP request/response with optional status code.
 */
/* eslint-disable no-redeclare */
export function logHttp(level: Exclude<LogLevel, 'error'>, message: string, options: HttpLogOptions): void;
export function logHttp(level: 'error', message: string, options: ErrorLogOptions): void;
export function logHttp(level: LogLevel, message: string, options: HttpLogOptions | ErrorLogOptions): void {
  const { method, path, statusCode, reason, phase, headers, sessionId, context, error } = options as ErrorLogOptions;

  const baseContext: Record<string, unknown> = {
    ...(method && { method }),
    ...(path && { path }),
    ...(statusCode !== undefined && { statusCode }),
    ...context,
  };

  if (reason) baseContext.reason = reason;
  if (phase) baseContext.phase = phase;
  if (headers) baseContext.headers = headers;

  // Add error details for error level
  if (level === 'error' && error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorType = error instanceof Error ? error.constructor.name : typeof error;

    baseContext.errorMessage = errorMessage;
    baseContext.errorType = errorType;
    if (errorStack) baseContext.stack = errorStack;
    // Include full error context for non-Error objects
    if (typeof error === 'object' && !(error instanceof Error)) {
      baseContext.errorContext = error;
    }
  }

  log(level, message, { sessionId, context: baseContext });
}
/* eslint-enable no-redeclare */

/**
 * Logs JSON-RPC messages and errors.
 * Errors use error level, other messages use specified level.
 */
export function logJsonRpc(level: LogLevel, message: string, options: JsonRpcLogOptions): void {
  const { jsonrpcVersion, requestId, errorCode, errorMessage, errorData, sessionId, context } = options;

  const baseContext: Record<string, unknown> = {
    jsonrpc: jsonrpcVersion || '2.0',
    ...context,
  };

  if (requestId !== undefined) baseContext.requestId = requestId;
  if (errorCode !== undefined) baseContext.errorCode = errorCode;
  if (errorMessage) baseContext.errorMessage = errorMessage;
  if (errorData !== undefined) baseContext.errorData = errorData;

  // Use error level if errorCode is present, otherwise use specified level
  const finalLevel = errorCode !== undefined ? 'error' : level;
  log(finalLevel as LogLevel, message, { sessionId, context: baseContext });
}

// Convenience functions for common use cases
export const logError = (message: string, options: ErrorLogOptions) => logHttp('error', message, options);
export const logWarn = (message: string, options: HttpLogOptions) => logHttp('warn', message, options);
export const logInfo = (message: string, options: HttpLogOptions) => logHttp('info', message, options);
export const logDebug = (message: string, options: HttpLogOptions) => logHttp('debug', message, options);
