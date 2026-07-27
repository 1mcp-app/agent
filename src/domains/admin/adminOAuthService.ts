import type { OAuthAuthorizationFlow } from '@src/auth/oauthAuthorizationFlow.js';

import type { AdminOperationContext, AdminOperationResult, AdminOperationService } from './adminOperationService.js';

interface AdminOAuthServiceOptions {
  operationService: AdminOperationService;
  oauthFlow: OAuthAuthorizationFlow;
}

interface AdminOAuthOperationInput {
  context: AdminOperationContext;
  serviceId: string;
}

export interface AdminOAuthRedirectResult {
  serviceId: string;
  redirectUrl: string;
}

export interface AdminOAuthOperations {
  authorizeService(input: AdminOAuthOperationInput): Promise<AdminOperationResult<AdminOAuthRedirectResult>>;
  restartService(input: AdminOAuthOperationInput): Promise<AdminOperationResult<AdminOAuthRedirectResult>>;
}

export class AdminOAuthService implements AdminOAuthOperations {
  constructor(private readonly options: AdminOAuthServiceOptions) {}

  async authorizeService(input: AdminOAuthOperationInput): Promise<AdminOperationResult<AdminOAuthRedirectResult>> {
    const context = {
      ...input.context,
      target: { type: 'backend_oauth_service', id: input.serviceId },
    };

    return this.options.operationService.executeMutation({
      context,
      operationName: 'authorizeBackendOAuth',
      run: async () => {
        let result;
        try {
          result = await this.options.oauthFlow.startBackendOAuth({ serverName: input.serviceId });
        } catch {
          throw new Error('backend_oauth_authorization_start_failed');
        }
        if (result.status === 'service_not_found') {
          throw new Error('backend_oauth_service_not_found');
        }
        if (result.status === 'runtime_unavailable') {
          throw new Error('backend_oauth_runtime_unavailable');
        }
        if (result.status !== 'redirect') {
          throw new Error('backend_oauth_authorization_start_failed');
        }

        return {
          serviceId: input.serviceId,
          redirectUrl: result.redirectUrl,
        };
      },
    });
  }

  async restartService(input: AdminOAuthOperationInput): Promise<AdminOperationResult<AdminOAuthRedirectResult>> {
    const context = {
      ...input.context,
      target: { type: 'backend_oauth_service', id: input.serviceId },
    };

    return this.options.operationService.executeMutation({
      context,
      operationName: 'restartBackendOAuth',
      run: async () => {
        let result;
        try {
          result = await this.options.oauthFlow.restartBackendOAuth({ serverName: input.serviceId });
        } catch {
          throw new Error('backend_oauth_authorization_start_failed');
        }
        if (result.status === 'service_not_found') {
          throw new Error('backend_oauth_service_not_found');
        }
        if (result.status === 'runtime_unavailable') {
          throw new Error('backend_oauth_runtime_unavailable');
        }
        if (result.status !== 'restarted' || !result.redirectUrl) {
          throw new Error('backend_oauth_authorization_start_failed');
        }

        return {
          serviceId: input.serviceId,
          redirectUrl: result.redirectUrl,
        };
      },
    });
  }
}
