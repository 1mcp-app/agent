import logger from '@src/logger/logger.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@src/sdk/legacy/types.js';

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

interface LogContext {
  requestId: string;
  method: string;
  startTime: number;
}

type SDKRequestHandler<T extends z.ZodType> = (
  request: z.infer<T>,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
) => unknown | Promise<unknown>;

type SDKNotificationHandler<T extends z.ZodType> = (notification: z.infer<T>) => void | Promise<void>;

const activeRequests = new Map<string, LogContext>();

/**
 * Logs MCP request details
 */
function logRequest(requestId: string, method: string, _params: unknown): void {
  logger.info('mcpLoggingEnhancer.mcp.request.837d8877', { requestId: requestId, method: method });
}

/**
 * Logs MCP response details
 */
function logResponse(requestId: string, result: unknown, duration: number): void {
  logger.info('mcpLoggingEnhancer.mcp.response.7a62c1df', { requestId: requestId, duration: duration });
}

/**
 * Logs MCP error details
 */
function logError(requestId: string, error: unknown, duration: number): void {
  logger.error('mcpLoggingEnhancer.mcp.error.62447971', { requestId: requestId, error: error, duration: duration });
}

/**
 * Logs MCP notification details
 */
function logNotification(method: string, _params: unknown): void {
  logger.info('mcpLoggingEnhancer.mcp.notification.867bb301', { method: method });
}

/**
 * Wraps the original request handler with logging
 */
function wrapRequestHandler<T extends z.ZodType>(
  originalHandler: SDKRequestHandler<T>,
  method: string,
): SDKRequestHandler<T> {
  return async (request, extra) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    // Store request context
    activeRequests.set(requestId, {
      requestId,
      method,
      startTime,
    });

    // Log request with type-safe params extraction
    const requestParams = hasParamsProperty(request) ? request.params : undefined;
    logRequest(requestId, method, requestParams);

    try {
      // Execute original handler with enhanced extra object
      const result = await originalHandler(request, {
        ...extra,
        sendNotification: async (notification: ServerNotification) => {
          logger.info('mcpLoggingEnhancer.sending.notification.20ae8d0b', { requestId: requestId });
          return extra.sendNotification(notification);
        },
        // Reason: MCP SDK sendRequest expects any schema type; Zod schemas have complex generic types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sendRequest: async (request: ServerRequest, resultSchema: any, options?: unknown) => {
          logger.info('mcpLoggingEnhancer.sending.request.ee0ac423', { requestId: requestId });
          // Reason: MCP SDK internal types don't match our wrapper signatures; any required for compatibility
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
          return extra.sendRequest(request, resultSchema as any, options as any);
        },
      });

      // Log response
      const duration = Date.now() - startTime;
      logResponse(requestId, result, duration);

      return result;
    } catch (error) {
      // Log error
      const duration = Date.now() - startTime;
      logError(requestId, error, duration);
      throw error;
    } finally {
      // Clean up request context
      activeRequests.delete(requestId);
    }
  };
}

// Type guard to check if request has params property
function hasParamsProperty(request: unknown): request is { params: unknown } {
  return typeof request === 'object' && request !== null && 'params' in request;
}

// Type-safe utility to extract method name from Zod schema
function extractMethodName(schema: z.ZodType): string {
  try {
    // Reason: Accessing internal Zod schema properties not exposed in public types
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
    const schemaAny = schema as any;
    // Reason: Navigating Zod's internal structure to extract method name from schema
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    if (schemaAny._def?.shape?.()?.method?._def?.value) {
      // Reason: Extracting method name from deep within Zod's internal schema structure
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return schemaAny._def.shape().method._def.value;
    }
  } catch {
    // Silently fall back to default if extraction fails
  }
  return 'unknown';
}

/**
 * Wraps the original notification handler with logging
 */
function wrapNotificationHandler<T extends z.ZodType>(
  originalHandler: SDKNotificationHandler<T>,
  method: string,
): SDKNotificationHandler<T> {
  return async (notification) => {
    // Log notification with type-safe params extraction
    const notificationParams = hasParamsProperty(notification) ? notification.params : undefined;
    logNotification(method, notificationParams);

    // Execute original handler
    await originalHandler(notification);
  };
}

/**
 * Enhances an MCP server with request/response logging
 */
export function enhanceServerWithLogging(server: Server): void {
  // Store original methods
  const originalSetRequestHandler = server.setRequestHandler.bind(server);
  const originalSetNotificationHandler = server.setNotificationHandler.bind(server);
  const originalNotification = server.notification.bind(server);

  // Override request handler registration with proper type safety
  const serverWithHandlers = server as {
    setRequestHandler: <T extends z.ZodType>(
      requestSchema: T,
      handler: (
        request: z.infer<T>,
        extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
      ) => unknown | Promise<unknown>,
    ) => void;
  };

  serverWithHandlers.setRequestHandler = <T extends z.ZodType>(
    requestSchema: T,
    handler: (
      request: z.infer<T>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
    ) => unknown | Promise<unknown>,
  ): void => {
    // Extract method name safely using our type-safe utility
    const methodName = extractMethodName(requestSchema);

    const wrappedHandler = wrapRequestHandler(handler as SDKRequestHandler<T>, methodName);
    // Reason: Original MCP SDK method signatures incompatible with our wrapped handlers; any required for override
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalSetRequestHandler.call(server, requestSchema as any, wrappedHandler as any);
  };

  // Override notification handler registration with proper type safety
  const serverWithNotificationHandlers = server as {
    setNotificationHandler: <T extends z.ZodType>(
      notificationSchema: T,
      handler: (notification: z.infer<T>) => void | Promise<void>,
    ) => void;
  };

  serverWithNotificationHandlers.setNotificationHandler = <T extends z.ZodType>(
    notificationSchema: T,
    handler: (notification: z.infer<T>) => void | Promise<void>,
  ): void => {
    // Extract method name safely using our type-safe utility
    const methodName = extractMethodName(notificationSchema);

    const wrappedHandler = wrapNotificationHandler(handler as SDKNotificationHandler<T>, methodName);
    // Reason: Original MCP SDK method signatures incompatible with our wrapped handlers; any required for override
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return originalSetNotificationHandler.call(server, notificationSchema as any, wrappedHandler as any);
  };

  // Override notification sending
  server.notification = (...args: Parameters<Server['notification']>) => {
    const [notification] = args;
    logNotification(notification.method, notification.params);

    if (!server.transport) {
      logger.warn('mcpLoggingEnhancer.attempted.to.send.notification.on.disconnected.transport.244c8d91');
      return Promise.resolve();
    }

    // Try to send notification, catch connection errors gracefully
    try {
      // Retain SDK request/task correlation so HTTP notifications stay on their owning response stream.
      const result = originalNotification(...args);

      // Handle both sync and async cases
      if (result && typeof result.catch === 'function') {
        // It's a promise - handle async errors
        return result.catch((error: unknown) => {
          if (error instanceof Error && error.message.includes('Not connected')) {
            logger.warn('mcpLoggingEnhancer.attempted.to.send.notification.on.disconnected.transport.244c8d91');
            return Promise.resolve();
          }
          throw error;
        });
      }

      // Sync result
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not connected')) {
        logger.warn('mcpLoggingEnhancer.attempted.to.send.notification.on.disconnected.transport.244c8d91', {
          error: error,
        });
        return Promise.resolve();
      }
      throw error;
    }
  };
}
