import logger from '@src/logger/logger.js';
import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { ContextData } from '@src/types/context.js';

import type { Request } from 'express';

export { deriveContextSessionId } from '@src/utils/context/sessionIdentity.js';

// Header constants for context transmission
export const CONTEXT_HEADERS = {
  SESSION_ID: 'mcp-session-id', // Use standard streamable HTTP header
} as const;

export interface ExtractedTemplateContextRequest {
  context: ContextData;
  proof?: TemplateContextProof;
  source: 'meta' | 'query';
}

/**
 * Type guard to check if a value is a valid ContextData
 */
export function isContextData(value: unknown): value is ContextData {
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
export function extractContextFromMeta(req: Request): ContextData | null {
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

    return contextData;
  } catch (error) {
    logger.error(
      'Failed to extract context from _meta field:',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

export function encodeContextValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
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

export function extractTemplateContextRequest(req: Request): ExtractedTemplateContextRequest | null {
  const metaContext = extractContextFromMeta(req) as ContextData | null;
  if (metaContext) {
    return {
      context: metaContext,
      proof: extractProofFromMeta(req) ?? undefined,
      source: 'meta',
    };
  }

  const queryContext = extractContextFromQuery(req);
  if (!queryContext) {
    return null;
  }

  return {
    context: queryContext,
    proof: extractProofFromQuery(req) ?? undefined,
    source: 'query',
  };
}

function extractProofFromMeta(req: Request): TemplateContextProof | null {
  const body = req.body as {
    _meta?: { contextProof?: unknown };
    params?: { _meta?: { contextProof?: unknown } };
  };
  const value = body?.params?._meta?.contextProof ?? body?._meta?.contextProof;
  return isTemplateContextProof(value) ? value : null;
}

function extractProofFromQuery(req: Request): TemplateContextProof | null {
  try {
    const queryValue = req.query?.contextProof;
    const encoded = Array.isArray(queryValue) ? queryValue[0] : queryValue;
    if (!encoded || typeof encoded !== 'string') {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    return isTemplateContextProof(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTemplateContextProof(value: unknown): value is TemplateContextProof {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proof = value as Partial<TemplateContextProof>;
  return (
    proof.version === 1 &&
    typeof proof.runtimeScopeId === 'string' &&
    typeof proof.sessionId === 'string' &&
    typeof proof.contextHash === 'string' &&
    typeof proof.issuedAt === 'string' &&
    typeof proof.signature === 'string'
  );
}
