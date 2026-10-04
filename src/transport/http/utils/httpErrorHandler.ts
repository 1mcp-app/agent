import { ErrorCode } from '@src/sdk/contracts/index.js';

import { Response } from 'express';

import { logError, logWarn } from './unifiedLogger.js';

/**
 * Consolidated HTTP error response helpers.
 * Provides consistent error responses across all HTTP routes with proper logging.
 */

/**
 * Sends a 400 Bad Request response with consistent error format.
 *
 * @param res - Express response object
 * @param message - Error message describing what went wrong
 * @param details - Optional additional context for debugging and response
 */
export function sendBadRequest(res: Response, message: string, details?: Record<string, unknown>): void {
  const req = res.req;
  logWarn('httpErrorHandler.http.error.400.13c3edd2', { method: req?.method, statusCode: 400 });

  // Build response object - include details if they should be part of the response
  const response: { error: { code: typeof ErrorCode.InvalidParams; message: string; [key: string]: unknown } } = {
    error: {
      code: ErrorCode.InvalidParams,
      message,
    },
  };

  // Merge details into error response if provided (e.g., for examples)
  if (details) {
    Object.assign(response.error, details);
  }

  res.status(400).json(response);
}

/**
 * Sends a 404 Not Found response with consistent error format.
 *
 * @param res - Express response object
 * @param message - Error message describing what was not found
 * @param details - Optional additional context for debugging
 */
export function sendNotFound(res: Response, message: string, _details?: Record<string, unknown>): void {
  const req = res.req;
  logWarn('httpErrorHandler.http.error.404.663a1410', { method: req?.method, statusCode: 404 });

  res.status(404).json({
    error: {
      code: ErrorCode.InvalidParams,
      message,
    },
  });
}

/**
 * Sends a 500 Internal Server Error response with consistent error format.
 * Logs the actual error with stack trace for debugging.
 *
 * @param res - Express response object
 * @param error - The error that occurred (can be Error, string, or unknown)
 * @param context - Request context for logging (method, path, sessionId, phase)
 */
export function sendInternalError(
  res: Response,
  error: unknown,
  context: { method: string; path: string; sessionId?: string; phase?: string },
): void {
  logError('httpErrorHandler.http.error.500.a81f1c79', {
    method: context.method,
    sessionId: context.sessionId,
    statusCode: 500,
    error: error,
  });

  res.status(500).json({
    error: {
      code: ErrorCode.InternalError,
      message: 'An internal server error occurred while processing the request',
    },
  });
}
