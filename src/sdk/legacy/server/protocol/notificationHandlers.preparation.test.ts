import {
  createMockClient,
  createMockLegacyInboundConnection,
  createMockLegacyOutboundConnection,
} from '@test/unit-utils/MockFactories.js';

import {
  invalidatePreparedToolProvider,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationForwarder,
} from '@src/core/capabilities/capabilityPagination.js';
import {
  bindProjectPreparationAuthority,
  createProjectPreparationAuthority,
  normalizeProjectPreparationAuthority,
  type ProjectPreparationAuthority,
} from '@src/core/context/projectPreparationAuthority.js';
import { authorizeTemplateContext, createTemplateContextProof } from '@src/core/context/templateContextTrust.js';
import { ServerStatus } from '@src/core/types/index.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { withProjectBinding } from '@src/domains/project-selection/projectBindingScope.js';
import type { Client } from '@src/sdk/legacy/client/index.js';
import { ToolListChangedNotificationSchema } from '@src/sdk/legacy/types.js';
import type { ContextData } from '@src/types/context.js';

import { expect, it, vi } from 'vitest';

import { setupClientToServerNotifications } from './notificationHandlers.js';
import {
  bindOwnedCatalogConnections,
  bindOwnedNotificationAuthorization,
  cleanupOwnedResources,
} from './resourceSubscriptions.js';

const context: ContextData = {
  project: { path: '/fixture/checkout' },
  user: {},
  environment: {},
  sessionId: 'session-a',
};
let currentAuthority: ProjectPreparationAuthority | undefined;
let currentBinding = true;
let currentBackend: MCPServerParams;
beforeEach(() => {
  currentAuthority = undefined;
  currentBinding = true;
  currentBackend = {
    command: 'fixture',
    template: {},
    preparation: {
      adapter: 'codegraph',
      executable: '/installed/codegraph',
      expectedVersion: '1.6.2',
      allowedActions: ['initialize', 'sync'],
    },
  };
});
vi.mock('@src/config/configuredServerTargets.js', () => ({
  getConfiguredServerTargets: () => ({ codegraph: currentBackend }),
}));
vi.mock('@src/core/server/serverManager.js', () => ({
  ServerManager: {
    current: {
      getTemplateServerManager: () => ({
        getBindingContext: () => (currentBinding ? context : undefined),
        getBindingAuthority: () => currentAuthority,
        getBindingPolicies: () => [],
        getRenderedHashForSession: () => undefined,
        getAllRenderedHashesForSession: () => undefined,
      }),
    },
  },
}));

it('preserves one initial recipient forwarder when catalog ownership is registered again', async () => {
  const provider = createMockLegacyOutboundConnection({
    name: 'ready',
    capabilities: { tools: { listChanged: true } },
  });
  const connections = new Map([['ready', provider]]);
  const notify = vi.fn(async () => undefined);
  const inbound = createMockLegacyInboundConnection({
    tags: [],
    tagFilterMode: 'none',
    server: { transport: {}, notification: notify, setNotificationHandler: vi.fn() } as never,
  });
  try {
    await setupClientToServerNotifications(connections, inbound);
    bindOwnedCatalogConnections(connections, inbound, 'tools');
    await invalidatePreparedToolProvider(provider);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    expect(notify).toHaveBeenCalledWith({ method: 'notifications/tools/list_changed', params: { server: 'ready' } });
  } finally {
    await cleanupOwnedResources(inbound);
    unregisterCapabilityPaginationForwarder(connections, inbound);
  }
});

it.each([
  'visible',
  'foreign-provider',
  'foreign-binding',
  'filtered',
  'revoked-auth',
  'revoked-proof',
  'revoked-proof-during-auth',
  'changed-preparation-during-auth',
  'disconnected-during-auth',
  'lost-binding',
  'changed-preparation',
  'native-origin',
  'missing-proof',
  'unconfigured',
  'cleaned',
] as const)(
  'handles %s preparation notifications for an initialized contextless consumer with a verified late binding',
  async (outcome) => {
    const ready = createMockLegacyOutboundConnection({ name: 'ready', capabilities: { tools: {} } });
    const connections = new Map([['ready', ready]]);
    const notify = vi.fn(async () => undefined);
    const inbound = createMockLegacyInboundConnection({
      tags: [],
      tagFilterMode: 'none',
      server: { transport: {}, notification: notify, setNotificationHandler: vi.fn() } as never,
    });
    // This consumer is connected and initialized before any checkout provider exists.
    await setupClientToServerNotifications(connections, inbound);
    const capability = {
      version: 1 as const,
      runtimeScopeId: 'runtime-a',
      secret: Buffer.alloc(32, 7).toString('base64url'),
    };
    const proof = createTemplateContextProof(context, capability);
    let revokedProof = false;
    const verify = (signedContext: ContextData, signedProof: typeof proof, ownerSessionId: string) =>
      authorizeTemplateContext({
        context: signedContext,
        proof: signedProof,
        transportSessionId: ownerSessionId,
        mode: revokedProof ? 'legacy' : 'verified',
        capability,
      });
    const authorization = verify(context, proof, 'session-a');
    const receipt = createProjectPreparationAuthority({ context, proof, authorization, verify })!;
    const authority = bindProjectPreparationAuthority(
      normalizeProjectPreparationAuthority(receipt, context, context),
      'binding-a',
      context,
    );
    expect(authority).toBeDefined();
    currentAuthority = authority;
    const nativeClient = createMockClient();
    const codegraph = createMockLegacyOutboundConnection({
      name: 'codegraph',
      client: nativeClient as Client,
      capabilities: { tools: {} },
    });
    Object.assign(codegraph, { tags: ['allowed'] });
    connections.set('codegraph:binding-a', codegraph);
    // Template creation currently registers generation tracking without a recipient.
    registerCapabilityPaginationNotifications(connections, codegraph);
    try {
      if (outcome === 'missing-proof') currentAuthority = undefined;
      if (outcome === 'unconfigured') currentBackend = { ...currentBackend, preparation: undefined };
      withProjectBinding('binding-a', context, () => bindOwnedCatalogConnections(connections, inbound, 'tools'));
      let source = codegraph;
      if (outcome === 'foreign-provider' || outcome === 'foreign-binding') {
        source = createMockLegacyOutboundConnection({
          name: outcome === 'foreign-binding' ? 'codegraph' : 'other-checkout',
          capabilities: { tools: { listChanged: true } },
        });
        connections.set(outcome === 'foreign-binding' ? 'codegraph:binding-b' : 'other-checkout', source);
        registerCapabilityPaginationNotifications(connections, source);
        if (outcome === 'foreign-binding')
          withProjectBinding('binding-a', context, () => bindOwnedCatalogConnections(connections, inbound, 'tools'));
      }
      if (outcome === 'filtered') Object.assign(inbound, { tags: ['excluded'], tagFilterMode: 'simple-or' });
      if (outcome === 'revoked-auth') {
        withProjectBinding('binding-a', context, () =>
          bindOwnedNotificationAuthorization(connections, inbound, async () => false),
        );
      }
      if (outcome === 'revoked-proof') revokedProof = true;
      if (outcome === 'revoked-proof-during-auth') {
        withProjectBinding('binding-a', context, () =>
          bindOwnedNotificationAuthorization(connections, inbound, async () => {
            await Promise.resolve();
            revokedProof = true;
            return true;
          }),
        );
      }
      if (outcome === 'changed-preparation-during-auth' || outcome === 'disconnected-during-auth') {
        withProjectBinding('binding-a', context, () =>
          bindOwnedNotificationAuthorization(connections, inbound, async () => {
            await Promise.resolve();
            if (outcome === 'changed-preparation-during-auth')
              currentBackend = { ...currentBackend, preparation: undefined };
            else Object.assign(inbound, { status: ServerStatus.Disconnected });
            return true;
          }),
        );
      }
      if (outcome === 'lost-binding') currentBinding = false;
      if (outcome === 'changed-preparation') currentBackend = { ...currentBackend, preparation: undefined };
      if (outcome === 'cleaned') {
        await cleanupOwnedResources(inbound);
        unregisterCapabilityPaginationForwarder(connections, inbound);
      }
      if (outcome === 'native-origin') {
        const nativeHandler = vi
          .mocked(nativeClient.setNotificationHandler!)
          .mock.calls.find(([schema]) => schema === ToolListChangedNotificationSchema)?.[1];
        expect(nativeHandler).toBeDefined();
        await nativeHandler!({
          method: 'notifications/tools/list_changed',
          origin: 'runtime-preparation',
          params: { origin: 'runtime-preparation' },
        } as never);
      } else {
        await invalidatePreparedToolProvider(source);
      }
      if (outcome === 'visible') {
        await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
        expect(notify).toHaveBeenCalledWith({
          method: 'notifications/tools/list_changed',
          params: { server: 'codegraph' },
        });
        expect(codegraph.capabilities).toEqual({ tools: {} });
      } else {
        // Drain the bounded recipient queue; denial must happen before SDK delivery.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(notify).not.toHaveBeenCalled();
      }
    } finally {
      await cleanupOwnedResources(inbound);
      unregisterCapabilityPaginationForwarder(connections, inbound);
    }
  },
);
