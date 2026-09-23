import { randomUUID } from 'node:crypto';

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { FilteringService } from '@src/core/filtering/filteringService.js';
import { filterConnectionsForSession } from '@src/core/protocol/requestHandlerUtils.js';
import type { ServerManager } from '@src/core/server/serverManager.js';
import type { InboundConnectionConfig } from '@src/core/types/index.js';
import { LegacyOutboundEraAdapter } from '@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js';
import type { ImmutableJsonValue } from '@src/gateway/contracts/index.js';
import type { GatewayInteractionRequest } from '@src/gateway/ports/outboundEraAdapter.js';
import { toJsonValue } from '@src/sdk/contracts/index.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { LegacySdkClientAdapter } from '@src/sdk/legacy/client/runtime/legacySdkClientAdapter.js';
import { ensureModernSubscriptionCoverage } from '@src/sdk/legacy/client/runtime/modernSubscriptions.js';
import {
  ClientCapabilitiesSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ResourceUpdatedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@src/sdk/legacy/types.js';

const LEGACY_REVISION = '2025-11-25';

export interface ModernInboundLegacyBridge {
  readonly targetConnectionId: string;
  readonly outbound: LegacyOutboundEraAdapter;
  subscribe(uri: string, signal: AbortSignal): Promise<void>;
  prepareSubscriptions(filter: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

/**
 * Gives one modern stateless exchange a private connection to the existing
 * aggregate legacy server. SDK-v1 objects stay inside the legacy island.
 */
export async function createModernInboundLegacyBridge(
  serverManager: ServerManager,
  config: InboundConnectionConfig,
  options: {
    readonly subscriptionSignal?: AbortSignal;
    readonly subscriptionListKinds?: readonly ('tools' | 'resources' | 'prompts')[];
    readonly subscriptionNotification?: (notification: { method: string; params?: Record<string, unknown> }) => void;
    readonly subscriptionClosed?: () => void;
    readonly capabilities?: ImmutableJsonValue;
    readonly logLevel?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
    readonly interaction?: (input: GatewayInteractionRequest) => Promise<ImmutableJsonValue>;
  } = {},
): Promise<ModernInboundLegacyBridge> {
  const acceptedCatalogFilter = options.subscriptionNotification
    ? await prepareCatalogFilter(serverManager, config, options.subscriptionListKinds ?? [], options.subscriptionSignal)
    : {};
  const connectionId = `modern-${randomUUID()}`;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const capabilities = ClientCapabilitiesSchema.parse(options.capabilities ?? {});
  const client = new Client({ name: '1mcp-modern-http-bridge', version: '1.0.0' }, { capabilities });
  if (options.interaction) {
    const interact = options.interaction;
    for (const [schema, capability] of [
      [CreateMessageRequestSchema, 'sampling'],
      [ElicitRequestSchema, 'elicitation'],
      [ListRootsRequestSchema, 'roots'],
    ] as const) {
      if (!capabilities[capability]) continue;
      client.setRequestHandler(
        schema,
        async (request) =>
          toJsonValue(
            await interact({
              method: request.method,
              ...(request.params === undefined ? {} : { params: request.params as ImmutableJsonValue }),
            }),
          ) as never,
      );
    }
  }

  const abortSubscription = () => {
    void Promise.allSettled([
      clientTransport.close(),
      serverTransport.close(),
      serverManager.disconnectTransport(connectionId, true),
    ]);
  };
  options.subscriptionSignal?.throwIfAborted();
  options.subscriptionSignal?.addEventListener('abort', abortSubscription, { once: true });
  const connecting = [
    serverManager.connectTransport(serverTransport, connectionId, {
      ...config,
      requestOnly: !options.subscriptionNotification,
      ...(options.subscriptionNotification
        ? {
            subscriptionListKinds: (['tools', 'resources', 'prompts'] as const).filter(
              (kind) => acceptedCatalogFilter[`${kind}ListChanged`] === true,
            ),
          }
        : {}),
      canonicalSchemaProjection: true,
    }),
    client.connect(clientTransport),
  ];
  try {
    await Promise.all(connecting);
    options.subscriptionSignal?.throwIfAborted();
    // This private inbound session owns the threshold; no shared upstream logging/setLevel is sent.
    if (options.logLevel !== undefined) await client.setLoggingLevel(options.logLevel);
  } catch (error) {
    await Promise.allSettled([clientTransport.close(), serverTransport.close()]);
    await Promise.allSettled(connecting);
    await serverManager.disconnectTransport(connectionId, true).catch(() => undefined);
    options.subscriptionSignal?.removeEventListener('abort', abortSubscription);
    throw error;
  }

  const legacy = new LegacySdkClientAdapter(client, clientTransport, { interactionBridge: true });
  try {
    await legacy.start();
  } catch (error) {
    await Promise.allSettled([legacy.close(), serverManager.disconnectTransport(connectionId, true)]);
    throw error;
  }
  if (options.subscriptionNotification) {
    for (const schema of [
      ResourceUpdatedNotificationSchema,
      ResourceListChangedNotificationSchema,
      ToolListChangedNotificationSchema,
      PromptListChangedNotificationSchema,
    ]) {
      client.setNotificationHandler(schema, (notification) => options.subscriptionNotification?.(notification));
    }
    client.onclose = () => options.subscriptionClosed?.();
  }
  let closePromise: Promise<void> | undefined;
  return {
    targetConnectionId: connectionId,
    subscribe: async (uri, signal) => {
      await client.subscribeResource({ uri }, { signal });
    },
    prepareSubscriptions: async () => ({ ...acceptedCatalogFilter }),
    outbound: new LegacyOutboundEraAdapter(legacy, { era: 'legacy', revision: LEGACY_REVISION }),
    close: () =>
      (closePromise ??= Promise.resolve()
        .then(() => {
          options.subscriptionSignal?.removeEventListener('abort', abortSubscription);
        })
        .then(() => Promise.allSettled([legacy.close(), serverManager.disconnectTransport(connectionId, true)]))
        .then((results) => {
          const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
          if (failed) throw failed.reason;
        })),
  };
}

async function prepareCatalogFilter(
  serverManager: ServerManager,
  config: InboundConnectionConfig,
  kinds: readonly ('tools' | 'resources' | 'prompts')[],
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const visible = FilteringService.getFilteredConnections(
    filterConnectionsForSession(serverManager.getClients(), undefined),
    config,
  );
  const accepted: Record<string, unknown> = {};
  for (const [field, kind] of [
    ['toolsListChanged', 'tools'],
    ['promptsListChanged', 'prompts'],
    ['resourcesListChanged', 'resources'],
  ] as const) {
    if (!kinds.includes(kind)) continue;
    const providers = [...visible.values()].filter((connection) => connection.capabilities?.[kind]);
    if (!providers.length) continue;
    let supported = true;
    for (const connection of providers) {
      signal?.throwIfAborted();
      const capability = connection.capabilities?.[kind];
      if (
        !capability ||
        typeof capability !== 'object' ||
        Array.isArray(capability) ||
        capability.listChanged !== true
      ) {
        supported = false;
        break;
      }
      const honored = await ensureModernSubscriptionCoverage(connection.adapter, { [field]: true });
      if (honored[field] !== true) {
        supported = false;
        break;
      }
    }
    if (supported) accepted[field] = true;
  }
  signal?.throwIfAborted();
  return accepted;
}
