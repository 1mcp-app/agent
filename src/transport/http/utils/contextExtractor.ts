import { createHash } from 'node:crypto';

import logger from '@src/logger/logger.js';
import type { ClientInfo, ContextData, ContextNamespace, EnvironmentContext, UserContext } from '@src/types/context.js';

import type { Request } from 'express';

// Header constants for context transmission
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
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    project?: unknown;
    user?: unknown;
    environment?: unknown;
  };

  return (
    typeof candidate.project === 'object' &&
    candidate.project !== null &&
    typeof candidate.user === 'object' &&
    candidate.user !== null &&
    typeof candidate.environment === 'object' &&
    candidate.environment !== null
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
    // Check if request body exists and has _meta in either:
    // - JSON-RPC shape: body.params._meta.context
    // - REST shape: body._meta.context
    const body = req.body as {
      _meta?: {
        context?: unknown;
      };
      params?: {
        _meta?: {
          context?: unknown;
        };
      };
    };

    const contextData = body?.params?._meta?.context ?? body?._meta?.context;
    if (!contextData) {
      return null;
    }

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

export function encodeContextValue(context: ContextData): string {
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64url');
}

export function extractContextFromQuery(req: Request): ContextData | null {
  try {
    const queryValue = req.query?.context;
    const encoded = Array.isArray(queryValue) ? queryValue[0] : queryValue;

    if (!encoded || typeof encoded !== 'string') {
      return null;
    }

    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    const parsed = JSON.parse(decoded) as unknown;

    if (!isContextData(parsed)) {
      logger.warn('Invalid context structure in request query, ignoring context');
      return null;
    }

    return parsed as ContextData;
  } catch (error) {
    logger.error(
      'Failed to extract context from request query:',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

export function extractRequestContext(req: Request): ContextData | null {
  return (extractContextFromMeta(req) as ContextData | null) ?? extractContextFromQuery(req);
}

export function deriveContextSessionId(context: ContextData): string {
  const stableContext = normalizeForSessionHash({
    project: context.project,
    user: context.user,
    environment: context.environment,
    ...(context.version ? { version: context.version } : {}),
    ...(context.transport
      ? {
          transport: {
            type: context.transport.type,
            ...(context.transport.url ? { url: context.transport.url } : {}),
            ...(context.transport.client ? { client: context.transport.client } : {}),
          },
        }
      : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
  });
  const hash = createHash('sha256').update(JSON.stringify(stableContext)).digest('hex').slice(0, 16);
  return `rest-${hash}`;
}

function normalizeForSessionHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForSessionHash(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [key, normalizeForSessionHash(entryValue)] as const),
    );
  }

  return value;
}
