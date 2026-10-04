import { AUTH_CONFIG } from '@src/constants.js';
import logger from '@src/logger/logger.js';
import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';
import { tagsToScopes, validateScopes } from '@src/utils/validation/scopeValidation.js';

import { OAuthAuthorizationDeniedError } from './oauthAuthority.js';

export type OAuthConsentAction = 'approve' | 'deny';

export interface OAuthAuthorizationRequestForFlow {
  clientId: string;
  scopes?: string[];
}

export interface OAuthAuthorizationFlowStorage {
  getAuthorizationRequest(authRequestId: string): OAuthAuthorizationRequestForFlow | null | undefined;
  getClient(clientId: string): unknown | null | undefined;
  processConsentApproval(authRequestId: string, selectedScopes: string[]): Promise<{ redirectUrl: URL }>;
  processConsentDenial(authRequestId: string): Promise<URL>;
  createSessionWithId(
    tokenId: string,
    clientId: string,
    resource: string,
    scopes: string[],
    ttlMs: number,
    refreshFamilyId?: string,
  ): string;
}

export interface OAuthAuthorizationFlowStorageService {
  getAuthorizationRequest(authRequestId: string): OAuthAuthorizationRequestForFlow | null | undefined;
  clientDataRepository: {
    get(clientKey: string): unknown | null | undefined;
  };
  processConsentApproval(authRequestId: string, selectedScopes: string[]): Promise<{ redirectUrl: URL }>;
  processConsentDenial(authRequestId: string): Promise<URL>;
  sessionRepository: {
    createWithId(
      tokenId: string,
      clientId: string,
      resource: string,
      scopes: string[],
      ttlMs: number,
      refreshFamilyId?: string,
    ): string;
  };
}

export interface OAuthBackendClientInfoForFlow {
  status: string;
  adapter: LegacySdkAdapter;
  requiresOAuth: boolean;
  authorizationUrl?: string;
  oauthStartTime?: string;
  lastError?: { message: string };
  lastConnected?: string;
}

export interface OAuthBackendServerRuntime {
  getClient(serverName: string): OAuthBackendClientInfoForFlow | undefined;
  getClients?(): Map<string, OAuthBackendClientInfoForFlow>;
}

export interface OAuthBackendClientRuntime {
  initiateOAuth(serverName: string): Promise<void>;
  bindOAuthReturn?(serverName: string, state: string, origin: string): Promise<void>;
  getOAuthReturn?(serverName: string, state: string): string | undefined;
  completeOAuthAndReconnect(serverName: string, authorizationCode: string | URLSearchParams): Promise<void>;
}

export interface OAuthBackendLoadingRuntime {
  markReady(serverName: string): void;
}

export interface OAuthAuthorizationFlowDependencies {
  storage: OAuthAuthorizationFlowStorage;
  serverRuntime?: OAuthBackendServerRuntime;
  clientRuntime?: OAuthBackendClientRuntime;
  loadingRuntime?: OAuthBackendLoadingRuntime;
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

export interface BackendOAuthInput {
  serverName: string;
  adminReturnOrigin?: string;
}

export interface BackendOAuthCallbackInput {
  serverName: string;
  state?: string;
  code?: string;
  error?: string;
  iss?: string;
  redirectUri?: string;
}

export type StartBackendOAuthResult =
  | {
      status: 'redirect';
      redirectUrl: string;
    }
  | {
      status: 'service_not_found' | 'oauth_url_unavailable' | 'runtime_unavailable';
      errorDescription: string;
    };

export type RestartBackendOAuthResult =
  | {
      status: 'restarted';
      redirectUrl?: string;
    }
  | {
      status: 'service_not_found' | 'oauth_url_unavailable' | 'runtime_unavailable';
      errorDescription: string;
    };

export type CompleteBackendOAuthCallbackResult =
  | {
      status: 'completed';
      adminReturnOrigin?: string;
    }
  | {
      status: 'provider_error' | 'missing_code' | 'callback_failed' | 'runtime_unavailable';
      adminReturnOrigin?: string;
      errorDescription: string;
    };

export interface BackendOAuthDashboardService {
  name: string;
  status: string;
  authorizationUrl?: string;
  oauthStartTime?: string;
  lastError?: string;
  lastConnected?: string;
  requiresOAuth: boolean;
}

export type BackendOAuthDashboardResult =
  | {
      status: 'ready';
      services: BackendOAuthDashboardService[];
    }
  | {
      status: 'runtime_unavailable';
      errorDescription: string;
    };

export interface OAuthAuthorizationFlow {
  submitConsent(input: SubmitConsentInput): Promise<SubmitConsentResult>;
  createLocalhostCliToken(): LocalhostCliTokenResult;
  startBackendOAuth(input: BackendOAuthInput): Promise<StartBackendOAuthResult>;
  restartBackendOAuth(input: BackendOAuthInput): Promise<RestartBackendOAuthResult>;
  completeBackendOAuthCallback(input: BackendOAuthCallbackInput): Promise<CompleteBackendOAuthCallbackResult>;
  getBackendOAuthDashboard(): BackendOAuthDashboardResult;
}

export interface OAuthAuthorizationFlowProvider {
  oauthStorage: OAuthAuthorizationFlowStorageService;
  oauthFlow?: OAuthAuthorizationFlow;
}

export function createOAuthAuthorizationFlow(dependencies: OAuthAuthorizationFlowDependencies): OAuthAuthorizationFlow {
  async function bindReturn(authorizationUrl: string, input: BackendOAuthInput): Promise<string | undefined> {
    if (!input.adminReturnOrigin) return authorizationUrl;
    const state = new URL(authorizationUrl).searchParams.get('state');
    if (!state || !dependencies.clientRuntime?.bindOAuthReturn) return undefined;
    await dependencies.clientRuntime.bindOAuthReturn(input.serverName, state, input.adminReturnOrigin);
    return authorizationUrl;
  }
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

        const unauthorizedScopes = validation.validScopes.filter((scope) => !authRequest.scopes?.includes(scope));
        if (unauthorizedScopes.length > 0) {
          return {
            status: 'invalid_scope',
            errorDescription: `Requested scopes were not part of the authorization request: ${unauthorizedScopes.join(', ')}`,
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

    async startBackendOAuth(input: BackendOAuthInput): Promise<StartBackendOAuthResult> {
      const started = await initiateBackendOAuth(input.serverName, dependencies);
      if (started.status !== 'started') {
        return started;
      }

      const redirectUrl = await bindReturn(started.authorizationUrl, input);
      if (!redirectUrl) {
        return {
          status: 'oauth_url_unavailable',
          errorDescription: 'Unable to bind the OAuth return; start authorization again',
        };
      }
      return {
        status: 'redirect',
        redirectUrl,
      };
    },

    async restartBackendOAuth(input: BackendOAuthInput): Promise<RestartBackendOAuthResult> {
      if (!dependencies.serverRuntime || !dependencies.clientRuntime) {
        return {
          status: 'runtime_unavailable',
          errorDescription: 'Backend OAuth runtime is unavailable',
        };
      }

      const clientInfo = dependencies.serverRuntime.getClient(input.serverName);
      if (!clientInfo) {
        return {
          status: 'service_not_found',
          errorDescription: 'Service not found',
        };
      }

      clientInfo.authorizationUrl = undefined;
      clientInfo.oauthStartTime = undefined;
      clientInfo.status = 'disconnected';

      const started = await initiateBackendOAuth(input.serverName, dependencies);
      if (started.status !== 'started') {
        return started;
      }

      const redirectUrl = await bindReturn(started.authorizationUrl, input);
      if (!redirectUrl) {
        return {
          status: 'oauth_url_unavailable',
          errorDescription: 'Unable to bind the OAuth return; start authorization again',
        };
      }
      return {
        status: 'restarted',
        redirectUrl,
      };
    },

    async completeBackendOAuthCallback(input: BackendOAuthCallbackInput): Promise<CompleteBackendOAuthCallbackResult> {
      if (!input.state) {
        return { status: 'callback_failed', errorDescription: 'Invalid or expired OAuth authorization attempt' };
      }
      if (!dependencies.clientRuntime) {
        return { status: 'runtime_unavailable', errorDescription: 'Backend OAuth runtime is unavailable' };
      }
      const response = new URLSearchParams({ state: input.state });
      if (input.code !== undefined) response.set('code', input.code);
      if (input.error !== undefined) response.set('error', input.error);
      if (input.iss !== undefined) response.set('iss', input.iss);
      if (input.redirectUri !== undefined) response.set('redirect_uri', input.redirectUri);
      try {
        await dependencies.clientRuntime.completeOAuthAndReconnect(input.serverName, response);
        dependencies.loadingRuntime?.markReady(input.serverName);
        const adminReturnOrigin = dependencies.clientRuntime.getOAuthReturn?.(input.serverName, input.state);
        return { status: 'completed', ...(adminReturnOrigin ? { adminReturnOrigin } : {}) };
      } catch (error) {
        logger.error('oauthAuthorizationFlow.oauth.callback.completion.failed.for.758a88bb');
        const adminReturnOrigin = dependencies.clientRuntime.getOAuthReturn?.(input.serverName, input.state);
        return {
          status: error instanceof OAuthAuthorizationDeniedError ? 'provider_error' : 'callback_failed',
          errorDescription:
            error instanceof OAuthAuthorizationDeniedError
              ? error.errorCode
              : 'OAuth callback rejected; start authorization again',
          ...(adminReturnOrigin ? { adminReturnOrigin } : {}),
        };
      }
    },

    getBackendOAuthDashboard(): BackendOAuthDashboardResult {
      if (!dependencies.serverRuntime?.getClients) {
        return {
          status: 'runtime_unavailable',
          errorDescription: 'Backend OAuth runtime is unavailable',
        };
      }

      const services = Array.from(dependencies.serverRuntime.getClients().entries()).map(([name, clientInfo]) => ({
        name,
        status: clientInfo.status,
        authorizationUrl: clientInfo.authorizationUrl,
        oauthStartTime: clientInfo.oauthStartTime,
        lastError: clientInfo.lastError?.message,
        lastConnected: clientInfo.lastConnected,
        requiresOAuth: requiresBackendOAuth(clientInfo),
      }));

      return {
        status: 'ready',
        services,
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
      createSessionWithId: (tokenId, clientId, resource, scopes, ttlMs, refreshFamilyId) =>
        storage.sessionRepository.createWithId(tokenId, clientId, resource, scopes, ttlMs, refreshFamilyId),
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

type InitiateBackendOAuthResult =
  | {
      status: 'started';
      authorizationUrl: string;
    }
  | {
      status: 'service_not_found' | 'oauth_url_unavailable' | 'runtime_unavailable';
      errorDescription: string;
    };

async function initiateBackendOAuth(
  serverName: string,
  dependencies: OAuthAuthorizationFlowDependencies,
): Promise<InitiateBackendOAuthResult> {
  if (!dependencies.serverRuntime) {
    return {
      status: 'runtime_unavailable',
      errorDescription: 'Backend OAuth runtime is unavailable',
    };
  }

  const clientInfo = dependencies.serverRuntime.getClient(serverName);
  if (!clientInfo) {
    return {
      status: 'service_not_found',
      errorDescription: 'Service not found',
    };
  }

  if (!dependencies.clientRuntime) {
    return {
      status: 'runtime_unavailable',
      errorDescription: 'Backend OAuth runtime is unavailable',
    };
  }

  await dependencies.clientRuntime.initiateOAuth(serverName);

  if (!clientInfo.authorizationUrl) {
    return {
      status: 'oauth_url_unavailable',
      errorDescription: 'Failed to generate OAuth URL',
    };
  }

  return {
    status: 'started',
    authorizationUrl: clientInfo.authorizationUrl,
  };
}

function requiresBackendOAuth(clientInfo: OAuthBackendClientInfoForFlow): boolean {
  return Boolean(
    clientInfo.requiresOAuth ||
    clientInfo.authorizationUrl ||
    clientInfo.oauthStartTime ||
    clientInfo.status === 'awaiting_oauth',
  );
}
