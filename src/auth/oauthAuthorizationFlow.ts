import { AUTH_CONFIG } from '@src/constants.js';
import { tagsToScopes, validateScopes } from '@src/utils/validation/scopeValidation.js';

export type OAuthConsentAction = 'approve' | 'deny';

export interface OAuthAuthorizationRequestForFlow {
  clientId: string;
}

export interface OAuthAuthorizationFlowStorage {
  getAuthorizationRequest(authRequestId: string): OAuthAuthorizationRequestForFlow | null | undefined;
  getClient(clientId: string): unknown | null | undefined;
  processConsentApproval(authRequestId: string, selectedScopes: string[]): Promise<{ redirectUrl: URL }>;
  processConsentDenial(authRequestId: string): Promise<URL>;
  createSessionWithId(tokenId: string, clientId: string, resource: string, scopes: string[], ttlMs: number): string;
}

export interface OAuthAuthorizationFlowStorageService {
  getAuthorizationRequest(authRequestId: string): OAuthAuthorizationRequestForFlow | null | undefined;
  clientDataRepository: {
    get(clientKey: string): unknown | null | undefined;
  };
  processConsentApproval(authRequestId: string, selectedScopes: string[]): Promise<{ redirectUrl: URL }>;
  processConsentDenial(authRequestId: string): Promise<URL>;
  sessionRepository: {
    createWithId(tokenId: string, clientId: string, resource: string, scopes: string[], ttlMs: number): string;
  };
}

export interface OAuthAuthorizationFlowDependencies {
  storage: OAuthAuthorizationFlowStorage;
  createTokenId: () => string;
  getAuthConfig: () => {
    enabled: boolean;
    oauthTokenTtlMs: number;
  };
  getAvailableTags: () => string[];
}

export interface SubmitConsentInput {
  authRequestId?: string;
  action?: OAuthConsentAction | string;
  scopes?: unknown;
}

export type SubmitConsentResult =
  | {
      status: 'approved_redirect';
      redirectUrl: string;
    }
  | {
      status: 'denied_redirect';
      redirectUrl: string;
    }
  | {
      status: 'invalid_request' | 'invalid_client' | 'invalid_scope';
      errorDescription: string;
    };

export type LocalhostCliTokenResult =
  | {
      authRequired: false;
      message: string;
    }
  | {
      authRequired: true;
      token: string;
      expiresIn: number;
      tokenId: string;
    };

export interface OAuthAuthorizationFlow {
  submitConsent(input: SubmitConsentInput): Promise<SubmitConsentResult>;
  createLocalhostCliToken(): LocalhostCliTokenResult;
}

export interface OAuthAuthorizationFlowProvider {
  oauthStorage: OAuthAuthorizationFlowStorageService;
  oauthFlow?: OAuthAuthorizationFlow;
}

export function createOAuthAuthorizationFlow(dependencies: OAuthAuthorizationFlowDependencies): OAuthAuthorizationFlow {
  return {
    createLocalhostCliToken(): LocalhostCliTokenResult {
      const authConfig = dependencies.getAuthConfig();
      if (!authConfig.enabled) {
        return {
          authRequired: false,
          message: 'Auth is disabled on this server',
        };
      }

      const tokenId = dependencies.createTokenId();
      const accessToken = AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX + tokenId;
      const allScopes = tagsToScopes(dependencies.getAvailableTags());

      dependencies.storage.createSessionWithId(tokenId, 'cli', '', allScopes, authConfig.oauthTokenTtlMs);

      return {
        authRequired: true,
        token: accessToken,
        expiresIn: Math.floor(authConfig.oauthTokenTtlMs / 1000),
        tokenId,
      };
    },

    async submitConsent(input: SubmitConsentInput): Promise<SubmitConsentResult> {
      const { authRequestId, action } = input;

      if (!authRequestId || !action) {
        return {
          status: 'invalid_request',
          errorDescription: 'Missing required parameters',
        };
      }

      const authRequest = dependencies.storage.getAuthorizationRequest(authRequestId);
      if (!authRequest) {
        return {
          status: 'invalid_request',
          errorDescription: 'Invalid or expired authorization request',
        };
      }

      const client = dependencies.storage.getClient(authRequest.clientId);
      if (!client) {
        return {
          status: 'invalid_client',
          errorDescription: 'Client not found',
        };
      }

      if (action === 'deny') {
        const redirectUrl = await dependencies.storage.processConsentDenial(authRequestId);
        return {
          status: 'denied_redirect',
          redirectUrl: redirectUrl.toString(),
        };
      }

      if (action === 'approve') {
        const selectedScopes = normalizeSubmittedScopes(input.scopes);
        const validation = validateScopes(selectedScopes);
        if (!validation.isValid) {
          return {
            status: 'invalid_scope',
            errorDescription: `Invalid scopes: ${validation.errors.join(', ')}`,
          };
        }

        const { redirectUrl } = await dependencies.storage.processConsentApproval(
          authRequestId,
          validation.validScopes,
        );
        return {
          status: 'approved_redirect',
          redirectUrl: redirectUrl.toString(),
        };
      }

      return {
        status: 'invalid_request',
        errorDescription: 'Invalid action',
      };
    },
  };
}

export function createOAuthAuthorizationFlowFromStorage(
  storage: OAuthAuthorizationFlowStorageService,
  dependencies: Omit<OAuthAuthorizationFlowDependencies, 'storage'>,
): OAuthAuthorizationFlow {
  return createOAuthAuthorizationFlow({
    ...dependencies,
    storage: {
      getAuthorizationRequest: (authRequestId) => storage.getAuthorizationRequest(authRequestId),
      getClient: (clientId) => storage.clientDataRepository.get(`${AUTH_CONFIG.CLIENT.PREFIXES.CLIENT}${clientId}`),
      processConsentApproval: (authRequestId, selectedScopes) =>
        storage.processConsentApproval(authRequestId, selectedScopes),
      processConsentDenial: (authRequestId) => storage.processConsentDenial(authRequestId),
      createSessionWithId: (tokenId, clientId, resource, scopes, ttlMs) =>
        storage.sessionRepository.createWithId(tokenId, clientId, resource, scopes, ttlMs),
    },
  });
}

export function getOAuthAuthorizationFlow(
  oauthProvider: OAuthAuthorizationFlowProvider,
  dependencies: Omit<OAuthAuthorizationFlowDependencies, 'storage'>,
): OAuthAuthorizationFlow {
  return oauthProvider.oauthFlow ?? createOAuthAuthorizationFlowFromStorage(oauthProvider.oauthStorage, dependencies);
}

function normalizeSubmittedScopes(scopes: unknown): string[] {
  if (Array.isArray(scopes)) {
    return scopes.filter((scope): scope is string => typeof scope === 'string');
  }

  if (typeof scopes === 'string') {
    return [scopes];
  }

  if (scopes) {
    return [String(scopes)];
  }

  return [];
}
