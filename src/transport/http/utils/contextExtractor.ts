import logger from '@src/logger/logger.js';
import type { ClientInfo, ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

import type { Request } from 'express';

// Header constants for context transmission (now only for session ID)
export const CONTEXT_HEADERS = {
  SESSION_ID: 'mcp-session-id', // Use standard streamable HTTP header
} as const;

/**
 * Type guard to check if a value is a valid ContextData
 */
function isContextData(value: unknown): value is {
  project: ContextNamespace;
  user: UserContext;
  environment: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'project' in value &&
    'user' in value &&
    'environment' in value &&
    typeof (value as { project: unknown }).project === 'object' &&
    typeof (value as { user: unknown }).user === 'object' &&
    typeof (value as { environment: unknown }).environment === 'object'
  );
}

/**
 * Extract context data from _meta field in request body (from STDIO proxy)
 */
export function extractContextFromMeta(req: Request): {
  project?: ContextNamespace;
  user?: UserContext;
  environment?: EnvironmentContext;
  timestamp?: string;
  version?: string;
  sessionId?: string;
  transport?: {
    type: string;
    connectionId?: string;
    connectionTimestamp?: string;
    client?: ClientInfo;
  };
} | null {
  try {
    // Check if request body exists and has params with _meta
    const body = req.body as {
      params?: {
        _meta?: {
          context?: unknown;
        };
      };
    };

    if (!body?.params?._meta?.context) {
      return null;
    }

    const contextData = body.params._meta.context;

    // Validate that the context has the correct structure
    if (!isContextData(contextData)) {
      logger.warn('Invalid context structure in _meta field, ignoring context');
      return null;
    }

    logger.info(`📊 Extracted context from _meta field: ${contextData.project.name} (${contextData.sessionId})`);

    const result: {
      project?: ContextNamespace;
      user?: UserContext;
      environment?: EnvironmentContext;
      timestamp?: string;
      version?: string;
      sessionId?: string;
      transport?: {
        type: string;
        connectionId?: string;
        connectionTimestamp?: string;
        client?: ClientInfo;
      };
    } = {
      project: contextData.project,
      user: contextData.user,
      environment: contextData.environment,
      timestamp: contextData.timestamp,
      version: contextData.version,
      sessionId: contextData.sessionId,
    };

    // Include transport info if present
    if (
      'transport' in contextData &&
      contextData.transport &&
      typeof contextData.transport === 'object' &&
      'type' in contextData.transport
    ) {
      result.transport = contextData.transport as {
        type: string;
        connectionId?: string;
        connectionTimestamp?: string;
        client?: ClientInfo;
      };
    }

    return result;
  } catch (error) {
    logger.error(
      'Failed to extract context from _meta field:',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}
