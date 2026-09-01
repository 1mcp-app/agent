import { LoadingState } from '@src/core/loading/loadingStateTracker.js';
import { McpLoadingManager } from '@src/core/loading/mcpLoadingManager.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/index.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/index.js';
import logger from '@src/logger/logger.js';

const POST_AUTH_UNAUTHORIZED_MESSAGE = 'Server returned 401 after successful authentication';
const recoveries = new WeakMap<OutboundConnection, Promise<void>>();

export function isPostAuthUnauthorized(error: unknown): error is OneMcpProtocolError {
  return error instanceof OneMcpProtocolError && error.code === 401 && error.message.includes(POST_AUTH_UNAUTHORIZED_MESSAGE);
}

function publishAwaitingOAuth(serverName: string, error: OneMcpProtocolError): void {
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
    connection.lastError = { name: error.name, message: error.message };
    publishAwaitingOAuth(serverName, error);

    await connection.adapter.close().catch((closeError) => {
      logger.warn(`Failed to close unauthorized client ${serverName}`, { error: String(closeError) });
    });

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
