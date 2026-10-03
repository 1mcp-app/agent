import type { ClientTemplateTracker } from '@src/core/filtering/index.js';
import type { ClientInstancePool } from '@src/core/server/clientInstancePool.js';
import type { OutboundConnections } from '@src/core/types/client.js';
import logger, { debugIf } from '@src/logger/logger.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';

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
  logger.info('templateServerCleanup.removing.client.from.template.instances.5ecc2955', { sessionId: sessionId });

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

      const poolInstanceKey = getPoolInstanceKey(context.clientInstancePool, instanceKey);
      const instance = context.clientInstancePool.getInstance(poolInstanceKey);
      context.clientInstancePool.removeClientFromInstance(poolInstanceKey, sessionId);

      if (sessionHashes) {
        sessionHashes.delete(templateName);
        if (sessionHashes.size === 0) {
          context.sessionToRenderedHash.delete(sessionId);
        }
      }

      debugIf(() => ({
        message:
          'templateServerCleanup.templateservermanager.cleanuptemplateservers.successfully.removed.client.fr.69ab5186',
        meta: { sessionId: sessionId },
      }));

      const remainingClients = context.clientTemplateTracker.getClientCount(templateName, instanceId);
      cleanupOutboundConnection(outboundConns, outboundKey, isShareable, remainingClients);
      if (!isShareable || remainingClients === 0) {
        instance?.outboundKeys?.delete(outboundKey);
      }
      cleanupTransportIfUnused(transports, instanceId, remainingClients);
      logInstanceRetention(templateName, instanceId, outboundKey, remainingClients);
    } catch (error) {
      logger.warn('templateServerCleanup.failed.to.cleanup.client.instance.795b730f', {
        error: error,
        sessionId: sessionId,
      });
    }
  }

  logger.info('templateServerCleanup.cleaned.up.template.client.instances.for.session.61999099');
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
        instance?.outboundKeys?.delete(trackedClient.outboundKey);
        delete transports[trackedClient.instanceId];
        context.clientTemplateTracker.cleanupInstance(templateName, trackedClient.instanceId);
      }

      clients.delete(templateName);
      debugIf(() => ({
        message: 'templateServerCleanup.expired.ephemeral.template.client.17c64c77',
        meta: { sessionId: sessionId },
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
      logger.debug('templateServerCleanup.removed.shareable.template.server.from.outbound.connections.45ac528c');
    }
    return;
  }

  if (!isShareable) {
    const removed = outboundConns.delete(outboundKey);
    if (removed) {
      logger.debug('templateServerCleanup.removed.template.server.from.outbound.connections.705ab981');
    }
    return;
  }

  debugIf(() => ({
    message: 'templateServerCleanup.shareable.template.server.still.has.clients.keeping.connection.f619a95b',
  }));
}

function cleanupTransportIfUnused(
  transports: Record<string, Transport>,
  instanceId: string,
  remainingClients: number,
): void {
  if (remainingClients === 0 && instanceId) {
    delete transports[instanceId];
    logger.debug('templateServerCleanup.removed.transport.for.instance.29f67138');
  }
}

function logInstanceRetention(
  templateName: string,
  instanceId: string,
  outboundKey: string,
  remainingClients: number,
): void {
  if (remainingClients === 0) {
    logger.debug(
      'templateServerCleanup.client.instance.has.no.more.clients.marking.as.idle.for.cleanup.after.timeo.f1e0ff23',
    );
    return;
  }

  debugIf(() => ({
    message: 'templateServerCleanup.client.instance.still.has.clients.keeping.connection.open.31b49148',
  }));
}

function getPoolInstanceKey(clientInstancePool: ClientInstancePool, trackerInstanceKey: string): string {
  const [, ...instanceParts] = trackerInstanceKey.split(':');
  const instanceId = instanceParts.join(':');
  const poolInstanceKey = clientInstancePool.getInstanceKeyById(instanceId);
  return poolInstanceKey ?? trackerInstanceKey;
}
