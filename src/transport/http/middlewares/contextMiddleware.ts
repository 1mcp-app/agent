import { getGlobalContextManager } from '@src/core/context/globalContextManager.js';
import logger from '@src/logger/logger.js';
import type { ContextData } from '@src/types/context.js';

import type { NextFunction, Request, Response } from 'express';

/**
 * Context extraction middleware for HTTP requests
 *
 * This middleware extracts context data from HTTP headers sent by the proxy command
 * and stores it in request locals for use in MCP server initialization.
 */

// Header constants for context transmission
export const CONTEXT_HEADERS = {
  SESSION_ID: 'x-1mcp-session-id',
  VERSION: 'x-1mcp-context-version',
  DATA: 'x-1mcp-context', // Base64 encoded context JSON
} as const;

/**
 * Type guard to check if a value is a valid ContextData
 */
function isContextData(value: unknown): value is ContextData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'project' in value &&
    'user' in value &&
    'environment' in value &&
    typeof (value as ContextData).project === 'object' &&
    typeof (value as ContextData).user === 'object' &&
    typeof (value as ContextData).environment === 'object'
  );
}

/**
 * Enhanced Request interface with context support
 */
export interface ContextRequest extends Request {
  locals: {
    context?: ContextData;
    hasContext?: boolean;
    [key: string]: unknown;
  };
}

/**
 * Middleware function to extract context from HTTP headers
 */
export function contextMiddleware(): (req: ContextRequest, res: Response, next: NextFunction) => void {
  return (req: ContextRequest, _res: Response, next: NextFunction) => {
    try {
      // Initialize req.locals if it doesn't exist
      if (!req.locals) {
        req.locals = {};
      }

      // Check if context headers are present
      const contextDataHeader = req.headers[CONTEXT_HEADERS.DATA.toLowerCase()];
      const sessionIdHeader = req.headers[CONTEXT_HEADERS.SESSION_ID.toLowerCase()];
      const versionHeader = req.headers[CONTEXT_HEADERS.VERSION.toLowerCase()];

      if (
        typeof contextDataHeader === 'string' &&
        typeof sessionIdHeader === 'string' &&
        typeof versionHeader === 'string'
      ) {
        // Decode base64 context data
        const contextJson = Buffer.from(contextDataHeader, 'base64').toString('utf-8');
        let parsedContext: unknown;
        try {
          parsedContext = JSON.parse(contextJson);
        } catch (parseError) {
          logger.warn('Failed to parse context JSON:', parseError);
          req.locals.hasContext = false;
          next();
          return;
        }

        // Validate that the parsed context has the correct structure
        if (!isContextData(parsedContext)) {
          logger.warn('Invalid context structure in JSON, ignoring context');
          req.locals.hasContext = false;
          next();
          return;
        }

        const context = parsedContext;

        // Validate basic structure
        if (context && context.project && context.user && context.sessionId === sessionIdHeader) {
          logger.debug(`Context validation passed: sessionId=${context.sessionId}, header=${sessionIdHeader}`);
          logger.info(`📊 Extracted context from headers: ${context.project.name} (${context.sessionId})`);

          // Store context in request locals for downstream middleware
          req.locals.context = context;
          req.locals.hasContext = true;

          // Update global context manager for template processing
          const globalContextManager = getGlobalContextManager();
          globalContextManager.updateContext(context);
        } else {
          logger.warn('Invalid context structure in headers, ignoring context', {
            hasContext: !!context,
            hasProject: !!context?.project,
            hasUser: !!context?.user,
            sessionIdsMatch: context?.sessionId === sessionIdHeader,
            contextSessionId: context?.sessionId,
            headerSessionId: sessionIdHeader,
          });
          req.locals.hasContext = false;
        }
      } else {
        req.locals.hasContext = false;
      }

      next();
    } catch (error) {
      logger.error('Failed to extract context from headers:', error);
      req.locals.hasContext = false;
      next();
    }
  };
}

/**
 * Create context headers for HTTP requests
 */
export function createContextHeaders(context: ContextData): Record<string, string> {
  const headers: Record<string, string> = {};

  // Add session ID
  if (context.sessionId) {
    headers[CONTEXT_HEADERS.SESSION_ID] = context.sessionId;
  }

  // Add version
  if (context.version) {
    headers[CONTEXT_HEADERS.VERSION] = context.version;
  }

  // Add encoded context data
  if (context) {
    const contextJson = JSON.stringify(context);
    const contextEncoded = Buffer.from(contextJson, 'utf-8').toString('base64');
    headers[CONTEXT_HEADERS.DATA] = contextEncoded;
  }

  return headers;
}

/**
 * Check if a request has context data
 */
export function hasContext(req: ContextRequest): boolean {
  return req.locals?.hasContext === true;
}

/**
 * Get context data from a request
 */
export function getContext(req: ContextRequest): ContextData | undefined {
  return req.locals?.context;
}
