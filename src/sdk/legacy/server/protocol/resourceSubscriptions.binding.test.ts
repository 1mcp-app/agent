import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { InboundConnection } from '@src/core/types/index.js';
import { ServerStatus } from '@src/core/types/index.js';
import { withProjectBinding } from '@src/domains/project-selection/projectBindingScope.js';
import type { JsonValue } from '@src/sdk/contracts/index.js';
import { buildPublicResourceUri } from '@src/utils/core/resourceUris.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupOwnedResources, deliverOwnedResourceUpdate, subscribeOwnedResource } from './resourceSubscriptions.js';

vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ checkout: { type: 'stdio', command: 'node', template: {} } }),
}));
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      getTemplateServerManager: () => ({
        getRenderedHashForSession: () => undefined,
        getBindingContext: () => undefined,
        getBindingPolicies: () => [],
      }),
    },
  },
}));
vi.mock('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js', async () => {
  const actual = await vi.importActual<typeof import('@src/sdk/legacy/client/runtime/legacyOutboundConnection.js')>(
    '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js',
  );
  return {
    ...actual,
    setOutboundNotificationHandler: vi.fn(),
    requestLegacyOutbound: (
      connection: { adapter: { request: (message: unknown) => unknown } },
      method: string,
      params: unknown,
    ) => connection.adapter.request({ method, params }),
  };
});

describe('resource subscription project binding', () => {
  let inbound: InboundConnection | undefined;
  afterEach(async () => {
    if (inbound) await cleanupOwnedResources(inbound);
  });

  it('keeps concurrent target watches pinned after request scope ends, including events arriving under the other target scope', async () => {
    const requests = ['front', 'back'].map(() =>
      vi.fn(async ({ method }: { method: string }): Promise<JsonValue> =>
        method === 'resources/list'
          ? { resources: [{ name: 'source', uri: 'file:///source.ts' }] }
          : method === 'resources/templates/list'
            ? { resourceTemplates: [] }
            : {},
      ),
    );
    const providers = requests.map((request) =>
      createMockOutboundConnection({
        name: 'checkout',
        capabilities: { resources: { subscribe: true } },
        adapter: { request },
      }),
    );
    const connections = new Map(
      providers.map((provider, index) => [`checkout:${index === 0 ? 'front' : 'back'}`, provider]),
    );
    const notify = vi.fn(async (_notification: { params: Record<string, unknown> }) => {});
    inbound = {
      status: ServerStatus.Connected,
      bindingId: 'front',
      adapter: { notify, close: vi.fn(async () => {}) },
    } as unknown as InboundConnection;
    const owner = inbound;
    const uri = buildPublicResourceUri('checkout', 'file:///source.ts');
    const context = (label: string) => ({
      project: { path: `/${label}` },
      user: {},
      environment: {},
      sessionId: 'one-agent',
    });
    await subscribeOwnedResource(connections, owner, uri);
    await withProjectBinding('back', context('back'), () => subscribeOwnedResource(connections, owner, uri));
    withProjectBinding('back', context('back'), () =>
      deliverOwnedResourceUpdate(providers[0], {
        method: 'notifications/resources/updated',
        params: { uri: 'file:///source.ts', target: 'front' },
      }),
    );
    withProjectBinding('front', context('front'), () =>
      deliverOwnedResourceUpdate(providers[1], {
        method: 'notifications/resources/updated',
        params: { uri: 'file:///source.ts', target: 'back' },
      }),
    );
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls.map(([notification]) => notification.params.target)).toEqual(['front', 'back']);
    await cleanupOwnedResources(owner);
    expect(
      requests.every((request) => request.mock.calls.some(([message]) => message.method === 'resources/unsubscribe')),
    ).toBe(true);
  });
});
