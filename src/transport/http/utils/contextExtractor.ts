import logger from '@src/logger/logger.js';
import type { TemplateContextProof } from '@src/core/context/templateContextTrust.js';
import type { ContextData } from '@src/types/context.js';

import type { Request } from 'express';
import { z } from 'zod';

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

const gitInfoSchema = z
  .object({
    branch: z.string().optional(),
    commit: z.string().optional(),
    repository: z.string().optional(),
    isRepo: z.boolean().optional(),
  })
  .strict();

const contextNamespaceSchema = z
  .object({
    path: z.string().optional(),
    cwd: z.string().optional(),
    name: z.string().optional(),
    git: gitInfoSchema.optional(),
    environment: z.string().optional(),
    custom: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const userContextSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    home: z.string().optional(),
    username: z.string().optional(),
    uid: z.string().optional(),
    gid: z.string().optional(),
    shell: z.string().optional(),
  })
  .strict();

const environmentContextSchema = z
  .object({
    variables: z.record(z.string(), z.string()).optional(),
    prefixes: z.array(z.string()).optional(),
  })
  .strict();

const clientInfoSchema = z
  .object({
    name: z.string(),
    version: z.string(),
    title: z.string().optional(),
  })
  .strict();

const contextDataSchema = z
  .object({
    project: contextNamespaceSchema,
    user: userContextSchema,
    environment: environmentContextSchema,
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    version: z.string().optional(),
    transport: z
      .object({
        type: z.string(),
        url: z.string().optional(),
        connectionId: z.string().optional(),
        connectionTimestamp: z.string().optional(),
        client: clientInfoSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<ContextData>;

const templateContextProofSchema = z
  .object({
    version: z.literal(1),
    runtimeScopeId: z.string().min(1),
    sessionId: z.string().min(1),
    contextHash: z.string().min(1),
    issuedAt: z.string().datetime(),
    signature: z.string().min(1),
  })
  .strict() satisfies z.ZodType<TemplateContextProof>;

/**
 * Type guard to check if a value is a valid ContextData
 */
export function isContextData(value: unknown): value is ContextData {
  return contextDataSchema.safeParse(value).success;
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
    const parsed = contextDataSchema.safeParse(contextData);
    if (!parsed.success) {
      logger.warn('Invalid context structure in _meta field, ignoring context');
      return null;
    }

    return parsed.data;
  } catch (error) {
    logger.error(
      'Failed to extract context from _meta field:',
      error instanceof Error ? error : new Error(String(error)),
    );
    return null;
  }
}

export function encodeContextValue(value: ContextData | TemplateContextProof): string {
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

    const context = contextDataSchema.safeParse(parsed);
    if (!context.success) {
      logger.warn('Invalid context structure in request query, ignoring context');
      return null;
    }

    return context.data;
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
  return templateContextProofSchema.safeParse(value).success;
}
