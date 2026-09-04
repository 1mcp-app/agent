import { LegacyOutboundEraAdapter } from '@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js';
import { createEffectiveRequestAuthority } from '@src/gateway/contracts/effectiveRequestAuthority.js';
import { toImmutableJsonValue } from '@src/gateway/contracts/immutableJson.js';
import {
  createLegacyTimeoutMs,
  type JsonValue,
  type LegacyRequestId,
  type LegacySdkAdapter,
  type LegacySdkRequest,
  toJsonValue,
} from '@src/sdk/contracts/index.js';
import type { Client } from '@src/sdk/legacy/client/index.js';

import { LegacySdkClientAdapter, type LegacySdkClientAdapterOptions } from './legacySdkClientAdapter.js';
import type { AuthProviderTransport } from './legacyTransport.js';

/** Routes the gateway-supported legacy slice through the legacy era adapter. */
export class LegacyGatewayClientAdapter extends LegacySdkClientAdapter {
  private readonly outbound: LegacyOutboundEraAdapter;
  private readonly gatewayRequests = new Set<LegacyRequestId>();

  constructor(client: Client, transport: AuthProviderTransport, options: LegacySdkClientAdapterOptions = {}) {
    super(client, transport, options);
    const owner = this;
    const direct: LegacySdkAdapter = {
      connectionId: this.connectionId,
      get state() {
        return owner.state;
      },
      start: () => super.start(),
      nextEvent: () => super.nextEvent(),
      respond: (response) => super.respond(response),
      request: (request) => super.request(request),
      cancel: (requestId) => super.cancel(requestId),
      notify: (notification) => super.notify(notification),
      close: () => super.close(),
    };
    this.outbound = new LegacyOutboundEraAdapter(direct, {
      era: 'legacy',
      revision: '2025-11-25',
    });
  }

  override async request(request: LegacySdkRequest): Promise<JsonValue> {
    if (request.method !== 'tools/list') return super.request(request);
    this.gatewayRequests.add(request.id);
    try {
      const timeoutMs = request.timeoutMs ?? createLegacyTimeoutMs(60_000);
      return toJsonValue(
        await this.outbound.request({
          requestId: request.id,
          operation: 'tools/list',
          ...(request.params === undefined ? {} : { params: toImmutableJsonValue(request.params) }),
          authority: createEffectiveRequestAuthority({
            connectionIds: [this.connectionId],
            provenance: ['configured-backend'],
          }),
          deadlineUnixMs: Date.now() + timeoutMs,
        }),
      );
    } finally {
      this.gatewayRequests.delete(request.id);
    }
  }

  override async cancel(requestId: LegacyRequestId): Promise<void> {
    if (this.gatewayRequests.has(requestId)) return this.outbound.cancel(requestId);
    await super.cancel(requestId);
  }

  override close(): Promise<void> {
    return this.outbound.close();
  }
}
