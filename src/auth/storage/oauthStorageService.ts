import logger from '@src/logger/logger.js';
import { AUTH_CONFIG } from '@src/constants.js';
import { FileStorageService } from './fileStorageService.js';
import { SessionRepository } from './sessionRepository.js';
import { AuthCodeRepository } from './authCodeRepository.js';
import { AuthRequestRepository } from './authRequestRepository.js';
import { ClientDataRepository } from './clientDataRepository.js';
import { auditScopeOperation } from '@src/utils/validation/scopeValidation.js';

/**
 * High-level OAuth storage service providing business operations
 *
 * This service orchestrates the lower-level repositories to provide
 * high-level business operations for OAuth flows. It encapsulates
 * the complexity of coordinating multiple data types and provides
 * clean APIs for route handlers.
 */
export class OAuthStorageService {
  private storage: FileStorageService;
  private sessions: SessionRepository;
  private authCodes: AuthCodeRepository;
  private authRequests: AuthRequestRepository;
  private clientData: ClientDataRepository;

  constructor(storageDir?: string) {
    this.storage = new FileStorageService(storageDir);
    this.sessions = new SessionRepository(this.storage);
    this.authCodes = new AuthCodeRepository(this.storage);
    this.authRequests = new AuthRequestRepository(this.storage);
    this.clientData = new ClientDataRepository(this.storage);
  }

  /**
   * Processes user consent approval
   *
   * Creates an authorization code with the selected scopes and builds
   * the redirect URL for the client. Cleans up the temporary auth request.
   */
  async processConsentApproval(
    authRequestId: string,
    selectedScopes: string[],
  ): Promise<{ authCode: string; redirectUrl: URL }> {
    const authRequest = this.authRequests.get(authRequestId);
    if (!authRequest) {
      throw new Error('Invalid or expired authorization request');
    }

    // Create authorization code with selected scopes
    const authCode = this.authCodes.create(
      authRequest.clientId,
      authRequest.redirectUri,
      authRequest.resource || '',
      selectedScopes,
      AUTH_CONFIG.SERVER.AUTH_CODE.TTL_MS,
      authRequest.codeChallenge,
    );

    // Clean up the temporary auth request
    this.authRequests.delete(authRequestId);

    // Build redirect URL
    const redirectUrl = new URL(authRequest.redirectUri);
    redirectUrl.searchParams.set('code', authCode);
    if (authRequest.state) {
      redirectUrl.searchParams.set('state', authRequest.state);
    }

    // Audit the operation
    auditScopeOperation('authorization_granted', {
      clientId: authRequest.clientId,
      requestedScopes: authRequest.scopes || [],
      grantedScopes: selectedScopes,
      success: true,
    });

    logger.info(`OAuth authorization granted for client ${authRequest.clientId}`, {
      clientId: authRequest.clientId,
      redirectUri: authRequest.redirectUri,
      grantedScopes: selectedScopes,
    });

    return { authCode, redirectUrl };
  }

  /**
   * Processes user consent denial
   *
   * Builds an error redirect URL and cleans up the temporary auth request.
   */
  async processConsentDenial(authRequestId: string): Promise<URL> {
    const authRequest = this.authRequests.get(authRequestId);
    if (!authRequest) {
      throw new Error('Invalid or expired authorization request');
    }

    // Clean up the auth request
    this.authRequests.delete(authRequestId);

    // Build error redirect URL
    const redirectUrl = new URL(authRequest.redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    redirectUrl.searchParams.set('error_description', 'User denied the request');
    if (authRequest.state) {
      redirectUrl.searchParams.set('state', authRequest.state);
    }

    // Audit the operation
    auditScopeOperation('authorization_denied', {
      clientId: authRequest.clientId,
      success: false,
      error: 'User denied authorization',
    });

    logger.info(`OAuth authorization denied by user for client ${authRequest.clientId}`);

    return redirectUrl;
  }

  /**
   * Creates a temporary authorization request for the consent flow
   */
  createAuthorizationRequest(
    clientId: string,
    redirectUri: string,
    codeChallenge?: string,
    state?: string,
    resource?: string,
    scopes?: string[],
  ): string {
    return this.authRequests.create(clientId, redirectUri, codeChallenge, state, resource, scopes);
  }

  /**
   * Retrieves an authorization request
   */
  getAuthorizationRequest(authRequestId: string) {
    return this.authRequests.get(authRequestId);
  }

  // Expose repositories for direct access when needed (with getters for encapsulation)
  get sessionRepository(): SessionRepository {
    return this.sessions;
  }

  get authCodeRepository(): AuthCodeRepository {
    return this.authCodes;
  }

  get authRequestRepository(): AuthRequestRepository {
    return this.authRequests;
  }

  get clientDataRepository(): ClientDataRepository {
    return this.clientData;
  }

  /**
   * Gets the storage directory path
   */
  getStorageDir(): string {
    return this.storage.getStorageDir();
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.storage.shutdown();
  }
}
