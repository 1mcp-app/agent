import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { OAuthError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { sanitizeRuntimeScopeError } from '@src/config/runtimeScopeEnv.js';
import { CONNECTION_RETRY, MCP_SERVER_NAME } from '@src/constants.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import { AuthProviderTransport } from '@src/core/types/index.js';
import logger, { debugIf } from '@src/logger/logger.js';
import { ClientConnectionError, NonRetryableClientConnectionError } from '@src/utils/core/errorTypes.js';
import { getConnectionTimeout } from '@src/utils/core/timeoutUtils.js';

import type { ConnectedClient } from './connectedClient.js';
import { OAuthRequiredError } from './types.js';

const RETRYABLE_OAUTH_ERROR_CODES = new Set(['server_error', 'temporarily_unavailable', 'too_many_requests']);
const RETRYABLE_OAUTH_HTTP_STATUSES = new Set([408, 429]);
const INVALID_OAUTH_HTTP_RESPONSE = /^HTTP (?<statusCode>\d{3}): Invalid OAuth error response:/;

function isNonRetryableOAuthError(error: unknown): error is OAuthError {
  if (!(error instanceof OAuthError)) return false;

  const match = INVALID_OAUTH_HTTP_RESPONSE.exec(error.message);
  const statusCode = Number(match?.groups?.statusCode);
  if (statusCode >= 400 && statusCode < 500) {
    return !RETRYABLE_OAUTH_HTTP_STATUSES.has(statusCode);
  }

  return !RETRYABLE_OAUTH_ERROR_CODES.has(error.errorCode);
}

export class ConnectionHandler {
  public async connectWithRetry(
    client: Client,
    transport: Transport,
    name: string,
    abortSignal?: AbortSignal,
    recreateTransport?: (transport: AuthProviderTransport) => AuthProviderTransport,
  ): Promise<ConnectedClient> {
    let retryDelay = CONNECTION_RETRY.INITIAL_DELAY_MS;
    let currentClient = client;
    let currentTransport = transport;

    for (let i = 0; i < CONNECTION_RETRY.MAX_ATTEMPTS; i++) {
      try {
        if (abortSignal?.aborted) {
          throw new Error(`Connection aborted: ${abortSignal.reason || 'Request cancelled'}`);
        }

        const authTransport = currentTransport as AuthProviderTransport;
        const timeout = getConnectionTimeout(authTransport);
        await currentClient.connect(currentTransport, timeout ? { timeout } : undefined);

        const sv = await currentClient.getServerVersion();
        if (sv?.name === MCP_SERVER_NAME) {
          throw new ClientConnectionError(name, new Error('Aborted to prevent circular dependency'));
        }

        logger.info(`Successfully connected to ${name} with server ${sv?.name} version ${sv?.version}`);
        return { client: currentClient, transport: currentTransport as AuthProviderTransport };
      } catch (error) {
        if (error instanceof UnauthorizedError) {
          const configManager = AgentConfigManager.getInstance();
          logger.info(`OAuth authorization required for ${name}. Visit ${configManager.getUrl()}/oauth to authorize`);
          throw new OAuthRequiredError(name, currentClient);
        }

        const nonRetryableOAuthError = isNonRetryableOAuthError(error);
        const safeError = sanitizeRuntimeScopeError(error);
        logger.error(`Failed to connect to ${name}: ${safeError.message}`);

        if (nonRetryableOAuthError) {
          throw new NonRetryableClientConnectionError(name, safeError);
        }

        if (i >= CONNECTION_RETRY.MAX_ATTEMPTS - 1) {
          throw new ClientConnectionError(name, safeError);
        }

        logger.info(`Retrying in ${retryDelay}ms...`);

        try {
          await currentTransport.close();
        } catch (closeError) {
          const safeCloseError = sanitizeRuntimeScopeError(closeError);
          debugIf(() => ({ message: `Error closing transport during retry: ${safeCloseError}` }));
        }

        await this.createCancellableDelay(retryDelay, abortSignal);
        retryDelay *= 2;

        currentClient = new Client({ name: '1mcp-client', version: '1.0.0' }, { capabilities: {} });

        if (recreateTransport) {
          currentTransport = recreateTransport(currentTransport as AuthProviderTransport);
        }
      }
    }

    throw new ClientConnectionError(name, new Error('Max retries exceeded'));
  }

  private async createCancellableDelay(ms: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, ms);

      if (!abortSignal) {
        return;
      }

      const abortHandler = () => {
        clearTimeout(timeoutId);
        reject(new Error(`Connection retry aborted: ${abortSignal.reason || 'Request cancelled'}`));
      };

      if (abortSignal.aborted) {
        clearTimeout(timeoutId);
        reject(new Error(`Connection retry aborted: ${abortSignal.reason || 'Request cancelled'}`));
      } else {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }
    });
  }
}
