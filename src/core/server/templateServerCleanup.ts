import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { ClientTemplateTracker } from '@src/core/filtering/index.js';
import type { ClientInstancePool } from '@src/core/server/clientInstancePool.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import logger, { debugIf } from '@src/logger/logger.js';

export interface EphemeralTemplateClient {
  templateName: string;
  instanceId: string;
  instanceKey: string;
  outboundKey: string;
  lastUsedAt: Date;
  idleTimeout: number;
}

interface TemplateCleanupContext {
  clientInstancePool: ClientInstancePool;
  clientTemplateTracker: ClientTemplateTracker;
  sessionToRenderedHash: Map<string, Map<string, string>>;
  ephemeralClients: Map<string, Map<string, EphemeralTemplateClient>>;
  persistentSessions: Set<string>;
}

export async function cleanupTemplateServersForSession(
  sessionId: string,
  outboundConns: OutboundConnections,
  transports: Record<string, Transport>,
  context: TemplateCleanupContext,
): Promise<void> {
  context.ephemeralClients.delete(sessionId);
  context.persistentSessions.delete(sessionId);

  const instancesToCleanup = context.clientTemplateTracker.removeClient(sessionId);
  logger.info(`Removing client from ${instancesToCleanup.length} template instances`, {
    sessionId,
    instancesToCleanup,
  });

  for (const instanceKey of instancesToCleanup) {
    const [templateName, ...instanceParts] = instanceKey.split(':');
    const instanceId = instanceParts.join(':');

    try {
      const sessionHashes = context.sessionToRenderedHash.get(sessionId);
      const renderedHash = sessionHashes?.get(templateName);
      const { outboundKey, isShareable } = resolveOutboundCleanupTarget(
        templateName,
        sessionId,
        renderedHash,
        outboundConns,
      );

      context.clientInstancePool.removeClientFromInstance(
        getPoolInstanceKey(context.clientInstancePool, instanceKey),
        sessionId,
      );

      if (sessionHashes) {
        sessionHashes.delete(templateName);
        if (sessionHashes.size === 0) {
          context.sessionToRenderedHash.delete(sessionId);
        }
      }

      debugIf(() => ({
        message: `TemplateServerManager.cleanupTemplateServers: Successfully removed client from client instance`,
        meta: {
          sessionId,
          templateName,
          instanceId,
          instanceKey,
          outboundKey,
          isShareable,
          renderedHash: renderedHash?.substring(0, 8),
        },
      }));

      const remainingClients = context.clientTemplateTracker.getClientCount(templateName, instanceId);
      cleanupOutboundConnection(outboundConns, outboundKey, isShareable, remainingClients);
      cleanupTransportIfUnused(transports, instanceId, remainingClients);
      logInstanceRetention(templateName, instanceId, outboundKey, remainingClients);
    } catch (error) {
      logger.warn(`Failed to cleanup client instance ${instanceKey}:`, {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
        templateName,
        instanceId,
      });
    }
  }

  logger.info(`Cleaned up template client instances for session ${sessionId}`, {
    instancesCleaned: instancesToCleanup.length,
  });
}

export async function cleanupExpiredEphemeralClients(
  outboundConns: OutboundConnections,
  transports: Record<string, Transport>,
  context: TemplateCleanupContext,
): Promise<void> {
  const now = new Date();

  for (const [sessionId, clients] of Array.from(context.ephemeralClients.entries())) {
    if (context.persistentSessions.has(sessionId)) {
      continue;
    }

    for (const [templateName, trackedClient] of Array.from(clients.entries())) {
      const idleTime = now.getTime() - trackedClient.lastUsedAt.getTime();
      if (idleTime <= trackedClient.idleTimeout) {
        continue;
      }

      const instance =
        context.clientInstancePool.getInstance(trackedClient.instanceKey) ??
        context.clientInstancePool.getInstance(`${templateName}:${trackedClient.instanceKey}`);
      context.clientInstancePool.removeClientFromInstance(
        trackedClient.instanceKey,
        sessionId,
        trackedClient.lastUsedAt,
      );
      const shouldCleanup = context.clientTemplateTracker.removeClientFromInstance(
        sessionId,
        templateName,
        trackedClient.instanceId,
      );

      const sessionHashes = context.sessionToRenderedHash.get(sessionId);
      sessionHashes?.delete(templateName);
      if (sessionHashes?.size === 0) {
        context.sessionToRenderedHash.delete(sessionId);
      }

      const remainingClients = context.clientTemplateTracker.getClientCount(templateName, trackedClient.instanceId);
      if (shouldCleanup || remainingClients === 0) {
        outboundConns.delete(trackedClient.outboundKey);
        delete transports[trackedClient.instanceId];
        context.clientTemplateTracker.cleanupInstance(templateName, trackedClient.instanceId);
      }

      clients.delete(templateName);
      debugIf(() => ({
        message: 'Expired ephemeral template client',
        meta: {
          sessionId,
          templateName,
          instanceId: trackedClient.instanceId,
          instanceKey: trackedClient.instanceKey,
          idleTime,
          instanceFound: Boolean(instance),
        },
      }));
    }

    if (clients.size === 0) {
      context.ephemeralClients.delete(sessionId);
    }
  }
}

function resolveOutboundCleanupTarget(
  templateName: string,
  sessionId: string,
  renderedHash: string | undefined,
  outboundConns: OutboundConnections,
): { outboundKey: string; isShareable: boolean } {
  if (!renderedHash) {
    return { outboundKey: `${templateName}:${sessionId}`, isShareable: false };
  }

  const hashKey = `${templateName}:${renderedHash}`;
  const sessionKey = `${templateName}:${sessionId}`;

  if (outboundConns.has(hashKey)) {
    return { outboundKey: hashKey, isShareable: true };
  }

  return { outboundKey: sessionKey, isShareable: false };
}

function cleanupOutboundConnection(
  outboundConns: OutboundConnections,
  outboundKey: string,
  isShareable: boolean,
  remainingClients: number,
): void {
  if (isShareable && remainingClients === 0) {
    const removed = outboundConns.delete(outboundKey);
    if (removed) {
      logger.debug(`Removed shareable template server from outbound connections: ${outboundKey}`);
    }
    return;
  }

  if (!isShareable) {
    const removed = outboundConns.delete(outboundKey);
    if (removed) {
      logger.debug(`Removed template server from outbound connections: ${outboundKey}`);
    }
    return;
  }

  debugIf(() => ({
    message: `Shareable template server still has clients, keeping connection`,
    meta: { outboundKey, remainingClients },
  }));
}

function cleanupTransportIfUnused(
  transports: Record<string, Transport>,
  instanceId: string,
  remainingClients: number,
): void {
  if (remainingClients === 0 && instanceId) {
    delete transports[instanceId];
    logger.debug(`Removed transport for instance: ${instanceId}`);
  }
}

function logInstanceRetention(
  templateName: string,
  instanceId: string,
  outboundKey: string,
  remainingClients: number,
): void {
  if (remainingClients === 0) {
    logger.debug(`Client instance ${instanceId} has no more clients, marking as idle for cleanup after timeout`, {
      templateName,
      instanceId,
      idleTimeout: 5 * 60 * 1000,
    });
    return;
  }

  debugIf(() => ({
    message: `Client instance ${instanceId} still has ${remainingClients} clients, keeping connection open`,
    meta: { instanceId, outboundKey, remainingClients },
  }));
}

function getPoolInstanceKey(clientInstancePool: ClientInstancePool, trackerInstanceKey: string): string {
  const [, ...instanceParts] = trackerInstanceKey.split(':');
  const instanceId = instanceParts.join(':');
  const poolInstanceKey = clientInstancePool.getInstanceKeyById(instanceId);
  return poolInstanceKey ?? trackerInstanceKey;
}
