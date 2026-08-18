import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';

import { TransportRecreator } from './transportRecreator.js';

const POST_AUTH_UNAUTHORIZED_MESSAGE = 'Server returned 401 after successful authentication';
const recoveries = new WeakMap<OutboundConnection, Promise<void>>();
const transportRecreator = new TransportRecreator();

export function isPostAuthUnauthorized(error: unknown): error is StreamableHTTPError {
  return (
    error instanceof StreamableHTTPError && error.code === 401 && error.message.includes(POST_AUTH_UNAUTHORIZED_MESSAGE)
  );
}

function publishAwaitingOAuth(serverName: string, error: StreamableHTTPError): void {
  try {
    const tracker = McpLoadingManager.current.getStateTracker();
    tracker.registerServer(serverName);
    tracker.updateServerState(serverName, LoadingState.AwaitingOAuth, { error });
  } catch (trackerError) {
    logger.warn(`Failed to publish OAuth recovery state for ${serverName}`, { error: String(trackerError) });
  }
}

export async function recoverPostAuthUnauthorized(
  serverName: string,
  connection: OutboundConnection,
  error: unknown,
): Promise<boolean> {
  if (!isPostAuthUnauthorized(error)) {
    return false;
  }

  const activeRecovery = recoveries.get(connection);
  if (activeRecovery) {
    await activeRecovery;
    return true;
  }

  if (connection.status === ClientStatus.AwaitingOAuth) {
    return true;
  }

  const recovery = (async () => {
    connection.status = ClientStatus.AwaitingOAuth;
    connection.authorizationUrl = undefined;
    connection.oauthStartTime = undefined;
    connection.lastError = error;
    publishAwaitingOAuth(serverName, error);

    try {
      await connection.transport.oauthProvider?.invalidateCredentials('tokens');
    } catch (invalidationError) {
      logger.warn(`Failed to invalidate OAuth credentials for ${serverName}`, {
        error: String(invalidationError),
      });
    }

    connection.client.onclose = undefined;
    await connection.client.close().catch((closeError) => {
      logger.warn(`Failed to close unauthorized client ${serverName}`, { error: String(closeError) });
    });

    connection.transport = transportRecreator.recreateHttpTransport(connection.transport, serverName);

    logger.warn(`OAuth reauthorization required for ${serverName} after authenticated request returned 401`);
  })();

  recoveries.set(connection, recovery);
  try {
    await recovery;
  } finally {
    recoveries.delete(connection);
  }

  return true;
}

export async function executeWithPostAuthOAuthRecovery<T>(
  serverName: string,
  connection: OutboundConnection,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    await recoverPostAuthUnauthorized(serverName, connection, error);
    throw error;
  }
}
