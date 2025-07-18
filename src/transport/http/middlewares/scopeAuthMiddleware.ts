import { Request, Response, NextFunction } from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import logger from '../../../logger/logger.js';
import { AgentConfigManager } from '../../../core/server/agentConfig.js';
import { SDKOAuthServerProvider } from '../../../auth/sdkOAuthServerProvider.js';
import { hasRequiredScopes, scopesToTags, auditScopeOperation } from '../../../utils/scopeValidation.js';

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
      const requestedTags = res.locals.tags || [];
      res.locals.validatedTags = requestedTags;
      next();
    };
  }

  // If scope validation is enabled but auth is disabled, allow all tags
  if (!serverConfig.isAuthEnabled()) {
    return (_req: Request, res: Response, next: NextFunction): void => {
      const requestedTags = res.locals.tags || [];
      res.locals.validatedTags = requestedTags;
      next();
    };
  }

  const provider = oauthProvider || new SDKOAuthServerProvider();

  // Create the SDK's bearer auth middleware
  const bearerAuthMiddleware = requireBearerAuth({
    verifier: provider,
  });

  // Return a combined middleware that does both auth and scope validation
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // First run the SDK's bearer auth middleware
      await new Promise<void>((resolve, reject) => {
        bearerAuthMiddleware(req, res, (err?: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // If we get here, auth succeeded and req.auth is populated
      const authInfo = req.auth!;
      const grantedScopes = authInfo.scopes || [];
      const grantedTags = scopesToTags(grantedScopes);

      // Get requested tags from previous middleware (tagsExtractor)
      const requestedTags = res.locals.tags || [];

      // Validate that all requested tags are covered by granted scopes
      if (!hasRequiredScopes(grantedScopes, requestedTags)) {
        auditScopeOperation('insufficient_scopes', {
          clientId: authInfo.clientId,
          requestedScopes: requestedTags.map((tag: string) => `tag:${tag}`),
          grantedScopes,
          success: false,
          error: 'Insufficient scopes for requested tags',
        });

        res.status(403).json({
          error: 'insufficient_scope',
          error_description: `Insufficient scopes. Required: ${requestedTags.join(', ')}, Granted: ${grantedTags.join(', ')}`,
        });
        return;
      }

      // Provide authentication context to downstream handlers via res.locals
      res.locals.auth = {
        token: req.headers.authorization?.slice(7) || '', // Remove 'Bearer ' prefix
        clientId: authInfo.clientId,
        grantedScopes,
        grantedTags,
      };

      // Provide validated tags to downstream handlers
      // If no specific tags requested, use all granted tags
      res.locals.validatedTags = requestedTags.length > 0 ? requestedTags : grantedTags;

      auditScopeOperation('scope_validation_success', {
        clientId: authInfo.clientId,
        requestedScopes: requestedTags.map((tag: string) => `tag:${tag}`),
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
  if (!Array.isArray(res.locals.validatedTags)) {
    return [];
  }

  return res.locals.validatedTags;
}

/**
 * Utility function to get authentication information from response locals
 */
export function getAuthInfo(res: Response): AuthInfo | undefined {
  if (!res?.locals?.auth) {
    return undefined;
  }

  return res.locals.auth;
}

// Default export for backward compatibility (creates a new provider instance)
export default createScopeAuthMiddleware();
