import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../logger/logger.js';
import { z } from 'zod';

interface LogContext {
  requestId: string;
  method: string;
  startTime: number;
}

type RequestSchema = z.ZodObject<{
  method: z.ZodLiteral<string>;
  params?: z.ZodObject<any>;
}>;

type NotificationSchema = z.ZodObject<{
  method: z.ZodLiteral<string>;
  params?: z.ZodObject<any>;
}>;

interface RequestHandlerExtra {
  progressToken?: string | number;
  signal: AbortSignal;
}

type ServerResult = { [key: string]: unknown; _meta?: { [key: string]: unknown } };

type RequestHandler<T extends RequestSchema> = (
  request: z.TypeOf<T>,
  extra: RequestHandlerExtra,
) => Promise<ServerResult>;

type NotificationHandler<T extends NotificationSchema> = (notification: z.TypeOf<T>) => Promise<void>;

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
function wrapRequestHandler<T extends RequestSchema>(
  originalHandler: RequestHandler<T>,
  method: string,
): RequestHandler<T> {
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
    logRequest(requestId, method, request.params);

    try {
      // Execute original handler
      const result = await originalHandler(request, extra);

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
function wrapNotificationHandler<T extends NotificationSchema>(
  originalHandler: NotificationHandler<T>,
  method: string,
): NotificationHandler<T> {
  return async (notification) => {
    // Log notification
    logNotification(method, notification.params);

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

  // Override request handler registration
  server.setRequestHandler = <T extends RequestSchema>(schema: T, handler: RequestHandler<T>) => {
    return originalSetRequestHandler(schema, wrapRequestHandler(handler, schema._def.shape().method._def.value));
  };

  // Override notification handler registration
  server.setNotificationHandler = <T extends NotificationSchema>(schema: T, handler: NotificationHandler<T>) => {
    return originalSetNotificationHandler(
      schema,
      wrapNotificationHandler(handler, schema._def.shape().method._def.value),
    );
  };

  // Override notification sending
  server.notification = (notification: {
    method: string;
    params?: { [key: string]: unknown; _meta?: { [key: string]: unknown } };
  }) => {
    logNotification(notification.method, notification.params);
    return originalNotification(notification);
  };
}
