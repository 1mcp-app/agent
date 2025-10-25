import { randomUUID } from 'node:crypto';

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

import { McpConfigManager } from '@src/config/mcpConfigManager.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import logger from '@src/logger/logger.js';
import {
  auditScopeOperation,
  scopesToTags,
  tagsToScopes,
  validateScopesAgainstAvailableTags,
} from '@src/utils/validation/scopeValidation.js';

import type { Response } from 'express';

import { OAuthStorageService } from './storage/oauthStorageService.js';

/**
 * File-based OAuth clients store implementation using the new repository architecture
 */
class FileBasedClientsStore implements OAuthRegisteredClientsStore {
  private oauthStorage: OAuthStorageService;

  constructor(oauthStorage: OAuthStorageService) {
    this.oauthStorage = oauthStorage;
  }

  getClientKey(clientId: string): string {
    return `${AUTH_CONFIG.CLIENT.PREFIXES.CLIENT}${clientId}`;
  }

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    const clientKey = this.getClientKey(clientId);
    const clientData = this.oauthStorage.clientDataRepository.get(clientKey);

    if (!clientData) {
      return undefined;
    }

    return clientData;
  }

  registerClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
    const clientKey = this.getClientKey(client.client_id);
    // Store client for 30 days (same as original implementation)
    const ttlMs = AUTH_CONFIG.CLIENT.OAUTH.TTL_MS;

    try {
      this.oauthStorage.clientDataRepository.save(clientKey, client, ttlMs);
      logger.info(`Registered OAuth client: ${client.client_id}`);
      return client;
    } catch (error) {
      logger.error(`Failed to register client ${client.client_id}:`, error);
      throw error;
    }
  }
}

/**
 * Implementation of SDK's OAuthServerProvider interface using the new repository architecture.
 *
 * This provider implements OAuth 2.1 server functionality using the MCP SDK's interfaces
 * with the new layered storage architecture for better separation of concerns.
 */
export class SDKOAuthServerProvider implements OAuthServerProvider {
  public oauthStorage: OAuthStorageService;
  private configManager: AgentConfigManager;
  private _clientsStore: OAuthRegisteredClientsStore;

  constructor(sessionStoragePath?: string) {
    this.oauthStorage = new OAuthStorageService(sessionStoragePath);
    this.configManager = AgentConfigManager.getInstance();
    this._clientsStore = new FileBasedClientsStore(this.oauthStorage);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Handles the authorization request with scope validation and user consent
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    logger.debug('Authorizing client', { clientId: client.client_id, params });
    try {
      // Get requested scopes (default to all available tags if none specified)
      const requestedScopes = params.scopes || [];
      const configManager = McpConfigManager.getInstance();
      const availableTags = configManager.getAvailableTags();

      // If no scopes requested, default to all available tags
      const finalScopes = requestedScopes.length > 0 ? requestedScopes : tagsToScopes(availableTags);

      // Validate requested scopes against available tags
      const validation = validateScopesAgainstAvailableTags(finalScopes, availableTags);

      if (!validation.isValid) {
        auditScopeOperation('scope_validation_failed', {
          clientId: client.client_id,
          requestedScopes: finalScopes,
          success: false,
          error: validation.errors.join(', '),
        });

        logger.warn(`Invalid scopes requested by client ${client.client_id}`, {
          requestedScopes: finalScopes,
          errors: validation.errors,
        });

        res.status(400).json({
          error: 'invalid_scope',
          error_description: `Invalid scopes: ${validation.errors.join(', ')}`,
        });
        return;
      }

      // Check if this is a direct authorization (auto-approve) or requires user consent
      const requiresUserConsent = this.requiresUserConsent(client, finalScopes);

      if (requiresUserConsent) {
        // Show consent page
        await this.renderConsentPage(client, params, finalScopes, availableTags, res);
      } else {
        // Auto-approve with validated scopes
        await this.approveAuthorization(client, params, validation.validScopes, res);
      }
    } catch (error) {
      logger.error('Authorization error:', error);
      res.status(500).json({ error: 'server_error', error_description: 'Internal server error' });
    }
  }

  /**
   * Determines if user consent is required for the authorization
   */
  private requiresUserConsent(client: OAuthClientInformationFull, scopes: string[]): boolean {
    logger.debug('Requires user consent', { clientId: client.client_id, scopes });
    // For now, always require user consent for security
    // In the future, this could be configurable based on client trust level
    return true;
  }

  /**
   * Renders the consent page for scope selection
   */
  private async renderConsentPage(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    requestedScopes: string[],
    availableTags: string[],
    res: Response,
  ): Promise<void> {
    // Create temporary authorization request to store the code challenge securely
    const authRequestId = this.oauthStorage.createAuthorizationRequest(
      client.client_id,
      params.redirectUri,
      params.codeChallenge,
      params.state,
      params.resource?.toString(),
      requestedScopes,
    );

    const scopeTags = scopesToTags(requestedScopes);
    const consentPageHtml = this.generateConsentPageHtml(client, authRequestId, scopeTags, availableTags);

    // Remove any CSP that might interfere with form submission
    res.removeHeader('Content-Security-Policy');
    res.set('Content-Type', 'text/html');
    res.send(consentPageHtml);
  }

  /**
   * Approves the authorization and redirects back to client
   */
  public async approveAuthorization(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    grantedScopes: string[],
    res: Response,
  ): Promise<void> {
    logger.debug('Approving authorization', { clientId: client.client_id, params, grantedScopes });
    // Create authorization code with granted scopes
    const ttlMs = this.configManager.get('auth').oauthCodeTtlMs;
    const code = this.oauthStorage.authCodeRepository.create(
      client.client_id,
      params.redirectUri,
      params.resource?.toString() || '',
      grantedScopes,
      ttlMs,
      params.codeChallenge,
    );

    // Build redirect URL
    const redirectUrl = new URL(params.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (params.state) {
      redirectUrl.searchParams.set('state', params.state);
    }

    auditScopeOperation('authorization_granted', {
      clientId: client.client_id,
      requestedScopes: params.scopes || [],
      grantedScopes,
      success: true,
    });

    logger.info(`OAuth authorization granted for client ${client.client_id}`, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      grantedScopes,
    });

    res.redirect(redirectUrl.toString());
  }

  /**
   * Generates the HTML for the consent page
   */
  private generateConsentPageHtml(
    client: OAuthClientInformationFull,
    authRequestId: string,
    requestedTags: string[],
    availableTags: string[],
  ): string {
    const clientName = client.client_name || client.client_id;

    return `
<!DOCTYPE html>
<html>
<head>
    <title>Authorize ${clientName}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 20px; }
        .app-info { background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
        .scopes-section { margin-bottom: 25px; }
        .scope-item { display: flex; align-items: center; margin-bottom: 10px; }
        .scope-item input { margin-right: 10px; }
        .scope-item label { flex: 1; }
        .tag-description { font-size: 0.9em; color: #666; margin-left: 25px; }
        .buttons { display: flex; gap: 10px; justify-content: flex-end; }
        .btn { padding: 10px 20px; border-radius: 4px; font-size: 14px; cursor: pointer; }
        .btn-primary { background: #007bff; color: white; border: none; }
        .btn-secondary { background: #6c757d; color: white; border: none; }
        .btn:hover { opacity: 0.9; }
        .security-notice { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 4px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Authorize Application</h1>

        <div class="app-info">
            <strong>${clientName}</strong> is requesting access to your MCP servers.
        </div>

        <div class="security-notice">
            <strong>Security Notice:</strong> Only grant access to server groups that this application needs.
        </div>

        <form method="POST" action="/oauth/consent">
            <input type="hidden" name="auth_request_id" value="${authRequestId}">

            <div class="scopes-section">
                <h3>Server Access Permissions</h3>
                <p>Select which server groups this application can access:</p>

                ${availableTags
                  .map(
                    (tag) => `
                    <div class="scope-item">
                        <input type="checkbox"
                               id="scope_${tag}"
                               name="scopes"
                               value="tag:${tag}"
                               ${requestedTags.includes(tag) ? 'checked' : ''}>
                        <label for="scope_${tag}">
                            <strong>${tag}</strong> servers
                        </label>
                    </div>
                    <div class="tag-description">
                        Access servers tagged with "${tag}"
                    </div>
                `,
                  )
                  .join('')}
            </div>

            <div class="buttons">
                <button type="submit" name="action" value="deny" class="btn btn-secondary">Deny</button>
                <button type="submit" name="action" value="approve" class="btn btn-primary">Approve</button>
            </div>
        </form>
    </div>
</body>
</html>
    `;
  }

  /**
   * Retrieves the PKCE challenge for an authorization code
   */
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    logger.debug('Challenge for authorization code', { clientId: client.client_id, authorizationCode });

    const codeData = this.oauthStorage.authCodeRepository.get(authorizationCode);
    if (!codeData || codeData.clientId !== client.client_id) {
      throw new Error('Invalid authorization code');
    }

    return codeData.codeChallenge || '';
  }

  /**
   * Exchanges authorization code for access token
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    // Note: code verifier is checked in SDK's token.ts by default
    // it's unused here for that reason.
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    logger.debug('Exchanging authorization code', {
      clientId: client.client_id,
      authorizationCode,
      redirectUri,
      resource,
    });

    const codeData = this.oauthStorage.authCodeRepository.get(authorizationCode);
    if (!codeData) {
      throw new Error('Invalid or expired authorization code');
    }

    // Validate client ID
    if (codeData.clientId !== client.client_id) {
      throw new Error('Client ID mismatch');
    }

    // Validate redirect URI if provided
    if (redirectUri && codeData.redirectUri !== redirectUri) {
      throw new Error('Redirect URI mismatch');
    }

    // Validate resource if provided
    if (resource && codeData.resource && codeData.resource !== resource.toString()) {
      throw new Error('Resource mismatch');
    }

    // Delete the authorization code (one-time use)
    this.oauthStorage.authCodeRepository.delete(authorizationCode);

    // Create access token
    const tokenId = randomUUID();
    const accessToken = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
    const ttlMs = this.configManager.get('auth').oauthTokenTtlMs;

    // Store session for token validation
    this.oauthStorage.sessionRepository.createWithId(
      tokenId,
      client.client_id,
      codeData.resource || '',
      codeData.scopes,
      ttlMs,
    );

    const tokens: OAuthTokens = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ttlMs / 1000),
      scope: codeData.scopes ? codeData.scopes.join(' ') : '',
    };

    logger.info(`Exchanged authorization code for access token`, {
      clientId: client.client_id,
      tokenId: tokenId.substring(0, 8) + '...',
      expiresIn: tokens.expires_in,
    });

    return tokens;
  }

  /**
   * Exchanges refresh token for new access token (not implemented)
   */
  async exchangeRefreshToken(
    _client: OAuthClientInformationFull,
    _refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<OAuthTokens> {
    throw new Error('Refresh tokens not supported');
  }

  /**
   * Verifies access token and returns auth info with granted scopes
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    logger.debug('Verifying access token', { token });

    if (!this.configManager.get('features').auth) {
      // Auth disabled, return minimal auth info with all available tags as scopes
      const configManager = McpConfigManager.getInstance();
      const availableTags = configManager.getAvailableTags();
      return {
        token,
        clientId: 'anonymous',
        scopes: tagsToScopes(availableTags),
      };
    }

    // Strip prefix if present
    const tokenId = token.startsWith(AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX)
      ? token.slice(AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX.length)
      : token;

    // Get session data
    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;
    const sessionData = this.oauthStorage.sessionRepository.get(sessionId);

    if (!sessionData) {
      throw new Error('Invalid or expired access token');
    }

    return {
      token,
      clientId: sessionData.clientId,
      scopes: sessionData.scopes,
      expiresAt: sessionData.expires,
      resource: sessionData.resource ? new URL(sessionData.resource) : undefined,
    };
  }

  /**
   * Revokes a token
   */
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    logger.debug('Revoking token', { clientId: client.client_id, request });

    const token = request.token;

    // Strip prefix if present
    const tokenId = token.startsWith(AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX)
      ? token.slice(AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX.length)
      : token;

    const sessionId = AUTH_CONFIG.SERVER.SESSION.ID_PREFIX + tokenId;
    const success = this.oauthStorage.sessionRepository.delete(sessionId);

    if (success) {
      logger.info(`Revoked access token for client ${client.client_id}`, {
        tokenId: tokenId.substring(0, 8) + '...',
      });
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.oauthStorage.shutdown();
  }
}
