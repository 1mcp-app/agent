import { createLegacyTimeoutMs, type LegacyRequestId, toJsonValue } from '@src/sdk/contracts/index.js';
import type { LegacySdkAdapter } from '@src/sdk/contracts/index.js';

import { authorityAllows, createGatewayFailure, toImmutableJsonValue } from '../contracts/index.js';
import type { ImmutableJsonValue, ProtocolEraPin } from '../contracts/index.js';
import type { OutboundEraAdapter, OutboundGatewayRequest } from '../ports/index.js';

const EVENT_OPERATIONS = new Set(['events/list', 'events/subscribe', 'events/unsubscribe']);

/** Routes the bounded Events surface to one configured downstream connection. */
export class ConfiguredServerEventsProvider implements OutboundEraAdapter {
  readonly role = 'outbound' as const;

  constructor(
    private readonly serverName: string,
    private readonly adapter: LegacySdkAdapter,
    readonly pin: ProtocolEraPin,
    private readonly now: () => number = Date.now,
  ) {}

  async request(request: OutboundGatewayRequest): Promise<ImmutableJsonValue> {
    if (!authorityAllows(request.authority, this.serverName)) {
      throw createGatewayFailure({
        kind: 'authorization',
        code: 'events_provider_not_authorized',
        message: 'Events requests are restricted to the configured provider',
      });
    }
    if (!EVENT_OPERATIONS.has(request.operation)) {
      throw createGatewayFailure({
        kind: 'invalid-request',
        code: 'unsupported_events_operation',
        message: 'The Events provider accepts only events/list, events/subscribe, and events/unsubscribe',
      });
    }
    const timeoutMs = Math.floor(request.deadlineUnixMs - this.now());
    if (timeoutMs <= 0) {
      throw createGatewayFailure({
        kind: 'deadline-exceeded',
        code: 'gateway_deadline_exceeded',
        message: 'The gateway request deadline has expired',
      });
    }

    return toImmutableJsonValue(
      await this.adapter.request({
        id: request.requestId as LegacyRequestId,
        method: request.operation,
        ...(request.params === undefined ? {} : { params: toJsonValue(request.params) }),
        timeoutMs: createLegacyTimeoutMs(timeoutMs),
      }),
    );
  }

  async cancel(requestId: string): Promise<void> {
    await this.adapter.cancel(requestId as LegacyRequestId);
  }

  async close(): Promise<void> {
    // The provider connection is shared with the normal 1MCP runtime.
  }
}
