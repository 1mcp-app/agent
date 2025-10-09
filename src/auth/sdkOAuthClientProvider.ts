import { randomUUID } from 'node:crypto';
import { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import logger from '@src/logger/logger.js';
import { ClientSessionRepository } from './storage/clientSessionRepository.js';
import { FileStorageService } from './storage/fileStorageService.js';
import { AUTH_CONFIG, getGlobalConfigDir } from '@src/constants.js';
import { ClientSessionData } from './sessionTypes.js';
import path from 'path';

/**
 * OAuth client configuration for connecting to downstream MCP servers
 */
export interface OAuthClientConfig {
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  redirectUrl: string;
}

/**
 * SDK-compatible OAuth client provider that replaces the custom implementation.
 *
 * This provider implements the OAuth 2.1 Authorization Code Grant flow using
 * the SDK's OAuthClientProvider interface while maintaining compatibility with
 * the existing session storage system.
 */
export class SDKOAuthClientProvider implements OAuthClientProvider {
  private _clientMetadata: OAuthClientMetadata;
  private _clientInfo?: OAuthClientInformationFull;
  private _tokens?: OAuthTokens;
  private _codeVerifier?: string;
  private _state?: string;
  private sessionRepository: ClientSessionRepository;
  private serverName: string;
  private config: OAuthClientConfig;
  private _authorizationUrl?: string;

  constructor(serverName: string, config: OAuthClientConfig, sessionStoragePath?: string) {
    this.serverName = serverName;
    this.config = config;

    // Create FileStorageService and ClientSessionRepository
    const storagePath = sessionStoragePath || path.join(getGlobalConfigDir(), 'clientSessions');
    const fileStorage = new FileStorageService(storagePath);
    this.sessionRepository = new ClientSessionRepository(fileStorage);

    // Set up client metadata for registration with better defaults
    this._clientMetadata = {
      client_name: `1MCP Agent - ${serverName}`,
      redirect_uris: [config.redirectUrl || ''],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: config.clientSecret ? 'client_secret_post' : 'none',
      scope: config.scopes?.join(' ') || AUTH_CONFIG.CLIENT.OAUTH.DEFAULT_SCOPES.join(' '),
    };

    logger.debug(
      `OAuth client configured for ${this.serverName} with redirect URL configured: ${!!this._clientMetadata.redirect_uris?.[0]}`,
    );

    // Load existing client info and tokens if available
    this.loadPersistedData();
  }

  get redirectUrl(): string {
    return this.config.redirectUrl || '';
  }

  get clientMetadata(): OAuthClientMetadata {
    return this._clientMetadata;
  }

  /**
   * Returns current client registration information
   */
  clientInformation(): OAuthClientInformationFull | undefined {
    return this._clientInfo;
  }

  /**
   * Saves client registration information from dynamic registration
   */
  saveClientInformation(clientInfo: OAuthClientInformationFull): void {
    this._clientInfo = clientInfo;
    this.persistAllData();
    logger.info(`OAuth client registered for ${this.serverName}: ${clientInfo.client_id}`);
  }

  /**
   * Returns current OAuth tokens
   */
  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  /**
   * Saves OAuth tokens after successful authorization
   */
  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
    this.persistAllData();
    logger.info(`OAuth tokens saved for ${this.serverName}`);
  }

  /**
   * Stores authorization URL instead of prompting user in console
   */
  redirectToAuthorization(authorizationUrl: URL): void {
    this._authorizationUrl = authorizationUrl.toString();
  }

  /**
   * Gets the current authorization URL
   */
  getAuthorizationUrl(): string | undefined {
    return this._authorizationUrl;
  }

  /**
   * Clears the stored authorization URL
   */
  clearAuthorizationUrl(): void {
    this._authorizationUrl = undefined;
  }

  /**
   * Saves PKCE code verifier for the authorization session
   */
  saveCodeVerifier(codeVerifier: string): void {
    this._codeVerifier = codeVerifier;
    this.persistAllData();
  }

  /**
   * Returns the PKCE code verifier for token exchange
   */
  codeVerifier(): string | Promise<string> {
    return this._codeVerifier || '';
  }

  /**
   * Returns the OAuth state parameter for CSRF protection
   */
  state(): string | Promise<string> {
    if (!this._state) {
      this._state = randomUUID();
      this.persistAllData();
    }
    return this._state;
  }

  /**
   * Custom resource validation (optional)
   */
  async validateResourceURL(serverUrl: string | URL, resource?: string): Promise<URL | undefined> {
    const url = typeof serverUrl === 'string' ? new URL(serverUrl) : serverUrl;
    // Basic validation - can be extended for specific requirements
    if (resource && !resource.startsWith(url.origin)) {
      return undefined;
    }
    return url;
  }

  /**
   * Load persisted OAuth data from unified client session storage
   */
  private loadPersistedData(): void {
    const clientSession = this.sessionRepository.get(this.serverName);

    if (clientSession) {
      // Load client info
      if (clientSession.clientInfo) {
        this._clientInfo = JSON.parse(clientSession.clientInfo);
      }

      // Load tokens
      if (clientSession.tokens) {
        this._tokens = JSON.parse(clientSession.tokens);

        // Check if tokens are expired
        if (this._tokens && this.isTokenExpired(this._tokens)) {
          logger.warn(`OAuth tokens expired for ${this.serverName}, clearing`);
          this._tokens = undefined;
          this.persistAllData();
        }
      }

      // Load code verifier
      if (clientSession.codeVerifier) {
        this._codeVerifier = clientSession.codeVerifier;
      }

      // Load state
      if (clientSession.state) {
        this._state = clientSession.state;
      }
    }
  }

  /**
   * Persist all OAuth data to unified client session storage
   */
  private persistAllData(): void {
    // Calculate the longest TTL based on the data we have
    let maxTtl = AUTH_CONFIG.CLIENT.OAUTH.TTL_MS; // Default to 30 days

    // If we have tokens, use their expiry time
    if (this._tokens && this._tokens.expires_in) {
      const tokenTtl = this._tokens.expires_in * 1000;
      maxTtl = Math.max(maxTtl, tokenTtl);
    }

    // Code verifier and state have shorter TTL, but we keep them for completeness
    const clientSessionData: ClientSessionData = {
      serverName: this.serverName,
      clientInfo: this._clientInfo ? JSON.stringify(this._clientInfo) : undefined,
      tokens: this._tokens ? JSON.stringify(this._tokens) : undefined,
      codeVerifier: this._codeVerifier,
      state: this._state,
      expires: Date.now() + maxTtl,
      createdAt: Date.now(),
    };

    this.sessionRepository.save(this.serverName, clientSessionData, maxTtl);
  }

  /**
   * Check if OAuth tokens are expired
   */
  private isTokenExpired(tokens: OAuthTokens): boolean {
    if (!tokens.expires_in) {
      return false; // No expiration info, assume valid
    }

    // This is a simple check - in practice, you might want to store the issued_at time
    // For now, we'll rely on the session storage TTL for expiration
    return false;
  }

  /**
   * Clean up resources
   */
  shutdown(): void {
    // Clean up temporary session data by clearing verifier and state
    this._codeVerifier = undefined;
    this._state = undefined;
    this.persistAllData();
  }
}
