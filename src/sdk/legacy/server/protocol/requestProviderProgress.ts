import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
} from '@src/core/capabilities/capabilityPagination.js';
import type { CatalogEntry } from '@src/core/capabilities/catalogGeneration.js';
import { ClientStatus, type OutboundConnection } from '@src/core/types/index.js';
import { withRequestProgress } from '@src/sdk/contracts/requestProgress.js';
import type { LegacyOutboundConnections } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import { McpError, type ServerNotification, type ServerRequest } from '@src/sdk/legacy/types.js';

/** Keep the selected provider's notification epoch observed until optional progress has drained. */
export async function withProviderRequestProgress<T>(
  connections: LegacyOutboundConnections,
  source: OutboundConnection,
  entry: CatalogEntry,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  token: unknown,
  operation: () => Promise<T>,
  assertCurrent?: () => void,
): Promise<T> {
  const adapter = source.adapter;
  const observed = new Map([[entry.route.connectionKey, source]]);
  registerCapabilityPaginationNotifications(observed, source);
  const kinds = entry.route.kind === 'resources' ? (['resources', 'resourceTemplates'] as const) : [entry.route.kind];
  const generations = kinds.map((kind) => getCapabilityPaginationGeneration(observed, kind));
  try {
    return await withRequestProgress(
      token,
      (notification) => extra.sendNotification(notification),
      operation,
      extra.signal,
      () => {
        if (connections.get(entry.route.connectionKey) !== source) throw new McpError(-32000, 'interaction_lost');
        if (source.adapter !== adapter) throw new McpError(-32000, 'interaction_lost');
        if (source.status !== ClientStatus.Connected) throw new McpError(-32000, 'interaction_lost');
        if (kinds.some((kind, index) => getCapabilityPaginationGeneration(observed, kind) !== generations[index]))
          throw new McpError(-32000, 'interaction_lost');
        assertCurrent?.();
      },
    );
  } finally {
    unregisterCapabilityPaginationConnections(observed);
  }
}
