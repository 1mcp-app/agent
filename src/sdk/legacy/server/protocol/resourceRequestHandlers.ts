import {
  acquireRuntimeCapabilityCatalog,
  isIssuedRuntimeResourceEntry,
} from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { getRequestSession, resolveCapabilityVisibility } from '@src/core/protocol/requestHandlerUtils.js';
import { InboundConnection } from '@src/core/types/index.js';
import { createGatewayFailure } from '@src/gateway/contracts/gatewayFailure.js';
import { RESPONSE_JSON_VALUE_LIMITS } from '@src/sdk/contracts/index.js';
import {
  type LegacyOutboundConnections,
  requestLegacyOutbound,
} from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { revalidateLegacyRequestAuthInfo } from '@src/sdk/legacy/server/auth/requestAuthRevalidation.js';
import { getLegacyInboundServer } from '@src/sdk/legacy/server/runtime/legacyInboundConnection.js';
import { projectResourceUri, resolveResourceRoute } from '@src/sdk/legacy/shared/resourceTemplateRouting.js';
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@src/sdk/legacy/types.js';
import { withErrorHandling } from '@src/utils/core/errorHandling.js';

import { withPrivateInteractionConnection } from './privateInteractionConnection.js';
import { withProviderRequestProgress } from './requestProviderProgress.js';
import {
  bindOwnedCatalogConnections,
  bindOwnedNotificationAuthorization,
  subscribeOwnedResource,
  unsubscribeOwnedResource,
} from './resourceSubscriptions.js';

export function registerResourceHandlers(
  outboundConns: LegacyOutboundConnections,
  inboundConn: InboundConnection,
): void {
  const acquire = (cursor?: string, kind: 'resources' | 'resourceTemplates' = 'resources') =>
    acquireRuntimeCapabilityCatalog(
      outboundConns,
      resolveCapabilityVisibility(outboundConns, inboundConn, getRequestSession(inboundConn), 'resources'),
      { continuation: cursor ? { kind, cursor, enablePagination: inboundConn.enablePagination ?? false } : undefined },
    );
  const server = getLegacyInboundServer(inboundConn);
  server.setRequestHandler(
    ListResourcesRequestSchema,
    withErrorHandling(async (request, extra) => {
      bindOwnedCatalogConnections(outboundConns, inboundConn, 'resources');
      if (extra?.authInfo)
        bindOwnedNotificationAuthorization(outboundConns, inboundConn, () =>
          revalidateLegacyRequestAuthInfo(extra.authInfo),
        );
      const snapshot = await acquire(request.params?.cursor);
      const result = await snapshot.list('resources', {
        cursor: request.params?.cursor,
        enablePagination: inboundConn.enablePagination ?? false,
        responseBudget: { limits: RESPONSE_JSON_VALUE_LIMITS },
      });
      return {
        resources: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing resources'),
  );
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    withErrorHandling(async (request, extra) => {
      bindOwnedCatalogConnections(outboundConns, inboundConn, 'resources');
      if (extra?.authInfo)
        bindOwnedNotificationAuthorization(outboundConns, inboundConn, () =>
          revalidateLegacyRequestAuthInfo(extra.authInfo),
        );
      const snapshot = await acquire(request.params?.cursor, 'resourceTemplates');
      const result = await snapshot.list('resourceTemplates', {
        cursor: request.params?.cursor,
        enablePagination: inboundConn.enablePagination ?? false,
        responseBudget: { limits: RESPONSE_JSON_VALUE_LIMITS },
      });
      return {
        resourceTemplates: result.items,
        ...(result.nextCursor === undefined ? {} : { nextCursor: result.nextCursor }),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }, 'Error listing resource templates'),
  );
  server.setRequestHandler(
    SubscribeRequestSchema,
    withErrorHandling(async (request, extra) => {
      await subscribeOwnedResource(
        outboundConns,
        inboundConn,
        request.params.uri,
        extra.signal,
        extra.authInfo ? () => revalidateLegacyRequestAuthInfo(extra.authInfo) : undefined,
      );
      return {};
    }, 'Error subscribing to resource'),
  );
  server.setRequestHandler(
    UnsubscribeRequestSchema,
    withErrorHandling(async (request) => {
      await unsubscribeOwnedResource(inboundConn, request.params.uri);
      return {};
    }, 'Error unsubscribing from resource'),
  );
  server.setRequestHandler(
    ReadResourceRequestSchema,
    withErrorHandling(async (request, extra) => {
      const snapshot = await acquire();
      const route = resolveResourceRoute(snapshot, request.params.uri);
      const assertResourceCurrent = () => {
        // A private lease can wait past handle expiry or owner revocation.
        try {
          const current = resolveResourceRoute(snapshot, request.params.uri);
          if (
            current.entry === route.entry &&
            current.connection === route.connection &&
            current.upstreamIdentity === route.upstreamIdentity
          )
            return;
        } catch {
          // Report only the trusted boundary failure, without the caller's URI.
        }
        throw createGatewayFailure({ kind: 'protocol', code: '-32602', message: 'Resource route is unavailable' });
      };
      const { _meta: _callerMeta, ...params } = request.params;
      const result = await withProviderRequestProgress(
        outboundConns,
        route.connection,
        route.entry,
        extra,
        request.params._meta?.progressToken,
        () =>
          withPrivateInteractionConnection(
            route.connection,
            inboundConn,
            extra,
            route.entry,
            (selected) =>
              requestLegacyOutbound<{ contents: Array<{ uri: string; [key: string]: unknown }> }>(
                selected,
                'resources/read',
                { ...params, uri: route.upstreamIdentity },
              ),
            assertResourceCurrent,
            isIssuedRuntimeResourceEntry(route.entry) ? route.entry : undefined,
          ),
        assertResourceCurrent,
      );
      return {
        ...result,
        contents: result.contents.map((content) => ({
          ...content,
          uri: projectResourceUri(snapshot, route.entry.route.connectionKey, content.uri),
        })),
      };
    }, 'Error reading resource'),
  );
}
