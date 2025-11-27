import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Prompt, Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types.js';

import { ClientStatus, OutboundConnection, OutboundConnections } from '@src/core/types/index.js';
import logger from '@src/logger/logger.js';
import { getRequestTimeout } from '@src/utils/core/timeoutUtils.js';

interface PaginationParams {
  [x: string]: unknown;
  _meta?:
    | {
        [x: string]: unknown;
        progressToken?: string | number | undefined;
      }
    | undefined;
  cursor?: string | undefined;
}

interface PaginationResult<T> {
  items: T[];
  nextCursor?: string;
}

export interface PaginationResponse {
  resources?: Resource[];
  resourceTemplates?: ResourceTemplate[];
  tools?: Tool[];
  prompts?: Prompt[];
  nextCursor?: string;
}

export function parseCursor(cursor?: string): { clientName: string; actualCursor?: string } {
  if (!cursor || typeof cursor !== 'string') {
    return { clientName: '' };
  }

  // Validate base64 format
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cursor)) {
    logger.warn(`Invalid cursor format: not valid base64`);
    return { clientName: '' };
  }

  try {
    // Decode the base64 cursor
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');

    // Validate decoded content (should be clientName:actualCursor format)
    if (!decoded || decoded.length > 1000) {
      // Reasonable length limit
      logger.warn(`Invalid cursor: decoded content too long or empty`);
      return { clientName: '' };
    }

    // Split on first colon only to handle cursors that might contain colons
    const colonIndex = decoded.indexOf(':');
    let clientName: string;
    let actualCursor: string | undefined;

    if (colonIndex === -1) {
      // No colon found, treat entire string as client name
      clientName = decoded;
      actualCursor = undefined;
    } else {
      clientName = decoded.substring(0, colonIndex);
      actualCursor = decoded.substring(colonIndex + 1);
    }

    // Validate client name (basic alphanumeric and common symbols)
    if (!/^[a-zA-Z0-9_-]+$/.test(clientName) || clientName.length > 100) {
      logger.warn(`Invalid cursor: invalid client name format`);
      return { clientName: '' };
    }

    return { clientName, actualCursor: actualCursor || undefined };
  } catch (error) {
    logger.warn(`Failed to parse cursor: ${error}`);
    return { clientName: '' };
  }
}

export function encodeCursor(clientName: string, nextCursor: string = ''): string | undefined {
  // Validate inputs
  if (!clientName || typeof clientName !== 'string') {
    logger.warn('Cannot encode cursor: invalid client name');
    return undefined;
  }

  if (typeof nextCursor !== 'string') {
    logger.warn('Cannot encode cursor: invalid next cursor');
    return undefined;
  }

  // Validate client name format
  if (!/^[a-zA-Z0-9_-]+$/.test(clientName) || clientName.length > 100) {
    logger.warn('Cannot encode cursor: client name contains invalid characters or is too long');
    return undefined;
  }

  // Reasonable length limit for the full cursor
  const fullCursor = `${clientName}:${nextCursor}`;
  if (fullCursor.length > 1000) {
    logger.warn('Cannot encode cursor: combined cursor length exceeds limit');
    return undefined;
  }

  try {
    return Buffer.from(fullCursor).toString('base64');
  } catch (error) {
    logger.warn(`Failed to encode cursor: ${error}`);
    return undefined;
  }
}

async function fetchAllItemsForClient<T>(
  outboundConn: OutboundConnection,
  params: PaginationParams,
  callClientMethod: (client: Client, params: unknown, opts: RequestOptions) => Promise<PaginationResponse>,
  transformResult: (client: OutboundConnection, result: PaginationResponse) => T[],
): Promise<T[]> {
  if (!outboundConn || outboundConn.status !== ClientStatus.Connected || !outboundConn.client.transport) {
    logger.warn(`Client '${outboundConn?.name}' is not connected or transport not available, skipping`);
    return [];
  }

  logger.info(`Fetching all items for client ${outboundConn.name}`);

  try {
    const items: T[] = [];
    let result = await callClientMethod(outboundConn.client, params, {
      timeout: getRequestTimeout(outboundConn.transport),
    });
    items.push(...transformResult(outboundConn, result));

    while (result.nextCursor) {
      logger.info(`Fetching next page for client ${outboundConn.name} with cursor ${result.nextCursor}`);
      result = await callClientMethod(
        outboundConn.client,
        { ...params, cursor: result.nextCursor },
        { timeout: getRequestTimeout(outboundConn.transport) },
      );
      items.push(...transformResult(outboundConn, result));
    }

    return items;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to fetch items from client ${outboundConn.name}: ${errorMessage}`, {
      clientName: outboundConn.name,
      error: errorMessage,
      params,
    });
    throw error; // Re-throw to be handled by Promise.allSettled
  }
}

function getNextClientCursor(currentClientName: string, clientNames: string[]): string | undefined {
  const currentIndex = clientNames.indexOf(currentClientName);
  const nextClientName = currentIndex === clientNames.length - 1 ? undefined : clientNames[currentIndex + 1];
  return nextClientName ? encodeCursor(nextClientName, undefined) : undefined;
}

export async function handlePagination<T>(
  clients: OutboundConnections,
  params: PaginationParams,
  callClientMethod: (client: Client, params: unknown, opts: RequestOptions) => Promise<PaginationResponse>,
  transformResult: (client: OutboundConnection, result: PaginationResponse) => T[],
  enablePagination: boolean,
): Promise<PaginationResult<T>> {
  const { cursor, ...clientParams } = params;
  const clientNames = Array.from(clients.keys());

  if (!enablePagination) {
    const results = await Promise.allSettled(
      clientNames.map((clientName) =>
        fetchAllItemsForClient(clients.get(clientName)!, clientParams, callClientMethod, transformResult),
      ),
    );

    const allItems = results
      .filter((result): result is PromiseFulfilledResult<T[]> => result.status === 'fulfilled')
      .flatMap((result) => result.value);

    // Log any failures for debugging
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length > 0) {
      logger.warn(`Failed to fetch items from ${failures.length} clients during pagination`, {
        totalClients: clientNames.length,
        successfulClients: results.length - failures.length,
        failedClients: failures.length,
        errors: failures.map((failure) => ({
          reason: failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
        })),
      });
    }

    return { items: allItems };
  }

  const { clientName, actualCursor } = parseCursor(cursor);

  // If cursor parsing failed or clientName is empty, start from first client
  const targetClientName = clientName || clientNames[0];

  // Validate that the target client exists
  const outboundConn = clients.get(targetClientName);
  if (!outboundConn) {
    logger.warn(`Client '${targetClientName}' not found, falling back to first available client`);
    // Fallback to first available client if the target doesn't exist
    const fallbackClientName = clientNames[0];
    const fallbackClient = fallbackClientName ? clients.get(fallbackClientName) : null;

    if (!fallbackClient || fallbackClient.status !== ClientStatus.Connected || !fallbackClient.client.transport) {
      logger.warn(`Client '${fallbackClientName}' is not connected or transport not available, skipping`);
      return { items: [] };
    }

    // Use fallback client and reset cursor since the original target was invalid
    const result = await callClientMethod(
      fallbackClient.client,
      clientParams, // Don't pass the invalid cursor
      { timeout: getRequestTimeout(fallbackClient.transport) },
    );

    const transformedItems = transformResult(fallbackClient, result);
    const nextCursor = result.nextCursor
      ? encodeCursor(fallbackClientName, result.nextCursor)
      : getNextClientCursor(fallbackClientName, clientNames);

    return { items: transformedItems, nextCursor };
  }

  if (!outboundConn || outboundConn.status !== ClientStatus.Connected || !outboundConn.client.transport) {
    logger.warn(`Client '${targetClientName}' is not connected or transport not available, skipping`);
    return { items: [] };
  }

  const result = await callClientMethod(
    outboundConn.client,
    { ...clientParams, cursor: actualCursor },
    { timeout: getRequestTimeout(outboundConn.transport) },
  );

  const transformedItems = transformResult(outboundConn, result);
  const nextCursor = result.nextCursor
    ? encodeCursor(targetClientName, result.nextCursor)
    : getNextClientCursor(targetClientName, clientNames);

  return { items: transformedItems, nextCursor };
}
