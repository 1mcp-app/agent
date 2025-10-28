import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { AuthInfo as SDKAuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { SDKOAuthServerProvider } from '@src/auth/sdkOAuthServerProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { TagExpression } from '@src/domains/preset/parsers/tagQueryParser.js';
import { TagQuery } from '@src/domains/preset/types/presetTypes.js';
import logger from '@src/logger/logger.js';
import { auditScopeOperation, hasRequiredScopes, scopesToTags } from '@src/utils/validation/scopeValidation.js';

import { NextFunction, Request, Response } from 'express';

// Type augmentation to add auth property to Request and extend Response locals
declare global {
  namespace Express {
    interface Request {
      auth?: SDKAuthInfo;
    }

    interface Response {
      locals: ResponseLocals;
    }
  }
}

/**
 * Type-safe response locals interface for scope auth middleware
 * Extends the default Express locals interface
 */
export interface ResponseLocals extends Record<string, unknown> {
  /** Tags extracted from the request (may be undefined) */
  tags?: string[];
  /** Tags that have been validated against scopes */
  validatedTags?: string[];
  /** Tag expression for advanced filtering */
  tagExpression?: TagExpression;
  /** Tag filter mode */
  tagFilterMode?: 'simple-or' | 'advanced' | 'preset' | 'none';
  /** Tag query object */
  tagQuery?: TagQuery;
  /** Preset name if used */
  presetName?: string;
  /** Authentication context */
  auth?: AuthInfo;
}

/**
 * Authentication information structure
 */
export interface AuthInfo {
  token: string;
  clientId: string;
  grantedScopes: string[];
  grantedTags: string[];
}

/**
 * Creates a scope validation middleware that uses the SDK's bearer auth middleware
 *
 * This middleware:
 * 1. Uses SDK's requireBearerAuth to verify tokens (when auth enabled)
 * 2. Validates that requested tags are covered by granted scopes
 * 3. Provides authentication context to downstream handlers
 *
 * When scope validation is disabled, all tags are allowed.
 * When scope validation is enabled:
 * - If auth is also enabled, validates tokens and scopes
 * - If auth is disabled, allows all tags (useful for development/testing)
 */
export function createScopeAuthMiddleware(oauthProvider?: SDKOAuthServerProvider) {
  const serverConfig = AgentConfigManager.getInstance();

  // If scope validation is disabled, return a pass-through middleware
  if (!serverConfig.isScopeValidationEnabled()) {
    return (_req: Request, res: Response, next: NextFunction): void => {
      // Type-safe access to tags from res.locals
      const localsTags = res.locals.tags as unknown;
      const requestedTags: string[] = Array.isArray(localsTags)
        ? (localsTags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : [];
      res.locals.validatedTags = requestedTags;
      next();
    };
  }

  // If scope validation is enabled but auth is disabled, allow all tags
  if (!serverConfig.isAuthEnabled()) {
    return (_req: Request, res: Response, next: NextFunction): void => {
      // Type-safe access to tags from res.locals
      const localsTags = res.locals.tags as unknown;
      const requestedTags: string[] = Array.isArray(localsTags)
        ? (localsTags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : [];
      res.locals.validatedTags = requestedTags;
      next();
    };
  }

  const provider = oauthProvider || new SDKOAuthServerProvider();

  // Create the SDK's bearer auth middleware
  const bearerAuthMiddleware = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: `${AgentConfigManager.getInstance().getUrl()}/.well-known/oauth-protected-resource`,
  });

  // Return a combined middleware that does both auth and scope validation
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // First run the SDK's bearer auth middleware
      await new Promise<void>((resolve, reject) => {
        bearerAuthMiddleware(req, res, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // If we get here, auth succeeded and req.auth is populated
      const authInfo = req.auth;
      if (!authInfo) {
        throw new Error('Authentication succeeded but req.auth is undefined');
      }

      // Type-safe access to authInfo properties
      const grantedScopes = authInfo.scopes ? [...authInfo.scopes] : [];
      const grantedTags = scopesToTags(grantedScopes);

      // Get requested tags and tag expression from previous middleware (tagsExtractor)
      // Type-safe access to res.locals properties
      const localsTags = res.locals.tags as unknown;
      const requestedTags: string[] = Array.isArray(localsTags)
        ? (localsTags as unknown[]).filter((tag): tag is string => typeof tag === 'string')
        : [];

      const localsTagExpression = res.locals.tagExpression as unknown;
      const tagExpression: TagExpression | undefined =
        localsTagExpression && typeof localsTagExpression === 'object' && 'type' in localsTagExpression
          ? (localsTagExpression as TagExpression)
          : undefined;

      const localsTagFilterMode = res.locals.tagFilterMode as unknown;
      const tagFilterMode: 'simple-or' | 'advanced' | 'preset' | 'none' =
        localsTagFilterMode === 'simple-or' ||
        localsTagFilterMode === 'advanced' ||
        localsTagFilterMode === 'preset' ||
        localsTagFilterMode === 'none'
          ? localsTagFilterMode
          : 'none';

      let allRequestedTags: string[] = [];

      // Determine all tags that need validation based on filter mode
      if (tagFilterMode === 'advanced' && tagExpression) {
        // For advanced expressions, extract all referenced tags
        allRequestedTags = extractTagsFromExpression(tagExpression);
      } else if (tagFilterMode === 'simple-or') {
        // For simple mode, use the parsed tags
        allRequestedTags = requestedTags;
      }

      // Validate that all requested tags are covered by granted scopes
      if (allRequestedTags.length > 0 && !hasRequiredScopes(grantedScopes, allRequestedTags)) {
        auditScopeOperation('insufficient_scopes', {
          clientId: authInfo.clientId as string,
          requestedScopes: allRequestedTags.map((tag: string) => `tag:${tag}`),
          grantedScopes,
          success: false,
          error: 'Insufficient scopes for requested tags',
        });

        res.status(403).json({
          error: 'insufficient_scope',
          error_description: `Insufficient scopes. Required: ${allRequestedTags.join(', ')}, Granted: ${grantedTags.join(', ')}`,
        });
        return;
      }

      // Provide authentication context to downstream handlers via res.locals
      const authHeader = req.headers.authorization;
      const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      const authContext: AuthInfo = {
        token,
        clientId: (authInfo.clientId as string) || '',
        grantedScopes,
        grantedTags,
      };
      res.locals.auth = authContext;

      // Provide validated tags to downstream handlers
      // If no specific tags requested, use all granted tags
      res.locals.validatedTags = allRequestedTags.length > 0 ? allRequestedTags : grantedTags;

      auditScopeOperation('scope_validation_success', {
        clientId: authInfo.clientId as string,
        requestedScopes: allRequestedTags.map((tag: string) => `tag:${tag}`),
        grantedScopes,
        success: true,
      });

      next();
    } catch (error) {
      logger.error('Scope auth middleware error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error',
      });
    }
  };
}

/**
 * Extract all tag names from a tag expression (for scope validation)
 */
function extractTagsFromExpression(expression: TagExpression): string[] {
  const tags: string[] = [];

  function traverse(expr: TagExpression) {
    switch (expr.type) {
      case 'tag':
        if (expr.value && !tags.includes(expr.value)) {
          tags.push(expr.value);
        }
        break;
      case 'and':
      case 'or':
      case 'not':
      case 'group':
        if (expr.children) {
          expr.children.forEach(traverse);
        }
        break;
    }
  }

  traverse(expression);
  return tags;
}

/**
 * Utility function to get validated tags from response locals
 *
 * This should be used by downstream handlers instead of directly accessing res.locals.tags
 * to ensure they get scope-validated tags.
 */
export function getValidatedTags(res: Response): string[] {
  if (!res?.locals?.validatedTags) {
    return [];
  }

  // Ensure it's an array
  const validatedTags: unknown = res.locals.validatedTags as unknown;
  if (!Array.isArray(validatedTags)) {
    return [];
  }

  // Ensure all elements are strings
  return validatedTags.filter((tag): tag is string => typeof tag === 'string');
}

/**
 * Utility function to get tag expression from response locals
 */
export function getTagExpression(res: Response): TagExpression | undefined {
  const tagExpression = res.locals?.tagExpression as unknown;
  if (!tagExpression || typeof tagExpression !== 'object') {
    return undefined;
  }
  // Type guard to ensure it's a valid TagExpression
  return 'type' in tagExpression ? (tagExpression as TagExpression) : undefined;
}

/**
 * Utility function to get tag filter mode from response locals
 */
export function getTagFilterMode(res: Response): 'simple-or' | 'advanced' | 'preset' | 'none' {
  const tagFilterMode = res.locals?.tagFilterMode as unknown;
  if (
    tagFilterMode === 'simple-or' ||
    tagFilterMode === 'advanced' ||
    tagFilterMode === 'preset' ||
    tagFilterMode === 'none'
  ) {
    return tagFilterMode;
  }
  return 'none';
}

/**
 * Utility function to get tag query from response locals
 */
export function getTagQuery(res: Response): TagQuery | undefined {
  const tagQuery = res.locals?.tagQuery as unknown;
  if (!tagQuery || typeof tagQuery !== 'object') {
    return undefined;
  }
  // Type guard to ensure it's a valid TagQuery
  return tagQuery as TagQuery;
}

/**
 * Utility function to get preset name from response locals
 */
export function getPresetName(res: Response): string | undefined {
  const presetName = res.locals?.presetName as unknown;
  return typeof presetName === 'string' ? presetName : undefined;
}

/**
 * Utility function to get authentication information from response locals
 */
export function getAuthInfo(res: Response): AuthInfo | undefined {
  const auth = res.locals?.auth as unknown;
  if (!auth || typeof auth !== 'object') {
    return undefined;
  }

  // Type guard to ensure it's a valid AuthInfo object
  const authObj = auth as Record<string, unknown>;
  if (
    typeof authObj.token === 'string' &&
    typeof authObj.clientId === 'string' &&
    Array.isArray(authObj.grantedScopes) &&
    authObj.grantedScopes.every((scope: unknown) => typeof scope === 'string') &&
    Array.isArray(authObj.grantedTags) &&
    authObj.grantedTags.every((tag: unknown) => typeof tag === 'string')
  ) {
    return auth as AuthInfo;
  }

  return undefined;
}

// Default export for backward compatibility (creates a new provider instance)
export default createScopeAuthMiddleware();
