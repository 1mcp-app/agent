import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';

import { v4 as uuidv4 } from 'uuid';
import { z, ZodLiteral, ZodObject } from 'zod';

import logger from './logger.js';

interface LogContext {
  requestId: string;
  method: string;
  startTime: number;
}

// Use the same constraint as the SDK Protocol class
type SDKRequestSchema = ZodObject<{
  method: ZodLiteral<string>;
}>;

type SDKNotificationSchema = ZodObject<{
  method: ZodLiteral<string>;
}>;

type SDKRequestHandler<T extends SDKRequestSchema> = (
  request: z.infer<T>,
  extra: RequestHandlerExtra<any, any>,
) => any | Promise<any>;

type SDKNotificationHandler<T extends SDKNotificationSchema> = (notification: z.infer<T>) => void | Promise<void>;

const activeRequests = new Map<string, LogContext>();

/**
 * Logs MCP request details
 */
function logRequest(requestId: string, method: string, params: unknown): void {
  logger.info('MCP Request', {
    requestId,
    method,
    params: JSON.stringify(params),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Logs MCP response details
 */
function logResponse(requestId: string, result: unknown, duration: number): void {
  logger.info('MCP Response', {
    requestId,
    duration,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Logs MCP error details
 */
function logError(requestId: string, error: unknown, duration: number): void {
  logger.error('MCP Error', {
    requestId,
    error: error instanceof Error ? error.message : JSON.stringify(error),
    stack: error instanceof Error ? error.stack : undefined,
    duration,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Logs MCP notification details
 */
function logNotification(method: string, params: unknown): void {
  logger.info('MCP Notification', {
    method,
    params: JSON.stringify(params),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Wraps the original request handler with logging
 */
function wrapRequestHandler<T extends SDKRequestSchema>(
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

    // Log request
    logRequest(requestId, method, (request as any).params);

    try {
      // Execute original handler with the original extra object
      const result = await originalHandler(request, {
        ...extra,
        sendNotification: async (notification) => {
          logger.info('Sending notification', { requestId, notification });
          return extra.sendNotification(notification);
        },
        sendRequest: async (request, resultSchema, options) => {
          logger.info('Sending request', { requestId, request });
          return extra.sendRequest(request, resultSchema, options);
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

/**
 * Wraps the original notification handler with logging
 */
function wrapNotificationHandler<T extends SDKNotificationSchema>(
  originalHandler: SDKNotificationHandler<T>,
  method: string,
): SDKNotificationHandler<T> {
  return async (notification) => {
    // Log notification
    logNotification(method, (notification as any).params);

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

  // Override request handler registration - cast server to bypass Zod version incompatibilities
  const serverAny = server as any;
  serverAny.setRequestHandler = <T extends ZodObject<{ method: ZodLiteral<string> }>>(
    requestSchema: T,
    handler: (request: z.infer<T>, extra: RequestHandlerExtra<any, any>) => any | Promise<any>,
  ): void => {
    const wrappedHandler = wrapRequestHandler(
      handler as SDKRequestHandler<any>,
      (requestSchema as unknown as { _def: { shape: () => { method: { _def: { value: string } } } } })?._def?.shape?.()
        ?.method?._def?.value || 'unknown',
    );
    return originalSetRequestHandler.call(server, requestSchema as any, wrappedHandler as any);
  };

  // Override notification handler registration - cast server to bypass Zod version incompatibilities
  serverAny.setNotificationHandler = <T extends ZodObject<{ method: ZodLiteral<string> }>>(
    notificationSchema: T,
    handler: (notification: z.infer<T>) => void | Promise<void>,
  ): void => {
    const wrappedHandler = wrapNotificationHandler(
      handler as SDKNotificationHandler<any>,
      (
        notificationSchema as unknown as { _def: { shape: () => { method: { _def: { value: string } } } } }
      )?._def?.shape?.()?.method?._def?.value || 'unknown',
    );
    return originalSetNotificationHandler.call(server, notificationSchema as any, wrappedHandler as any);
  };

  // Override notification sending
  server.notification = (notification: {
    method: string;
    params?: { [key: string]: unknown; _meta?: { [key: string]: unknown } };
  }) => {
    logNotification(notification.method, notification.params);

    if (!server.transport) {
      logger.warn('Attempted to send notification on disconnected transport');
      return Promise.resolve();
    }

    // Try to send notification, catch connection errors gracefully
    try {
      const result = originalNotification(notification);

      // Handle both sync and async cases
      if (result && typeof result.catch === 'function') {
        // It's a promise - handle async errors
        return result.catch((error: unknown) => {
          if (error instanceof Error && error.message.includes('Not connected')) {
            logger.warn('Attempted to send notification on disconnected transport');
            return Promise.resolve();
          }
          throw error;
        });
      }

      // Sync result
      return result;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Not connected')) {
        logger.warn('Attempted to send notification on disconnected transport');
        return Promise.resolve();
      }
      throw error;
    }
  };
}
