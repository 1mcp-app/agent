import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import { assertInteractionRoute } from '@src/gateway/interactions/interactionRoute.js';
import type { LegacySdkEvent } from '@src/sdk/contracts/index.js';
import type { AuthInfo } from '@src/transport/http/middlewares/scopeAuthMiddleware.js';

import {
  createModernInteractionBinding,
  watchModernInteractionBinding,
  withModernInteractionBinding,
} from './modernInteractionBinding.js';

vi.mock('@src/config/configuredServerTargets.js', () => ({ getConfiguredServerTargets: () => ({}) }));
vi.mock('@src/core/protocol/requestHandlerUtils.js', () => ({
  filterConnectionsForSession: (connections: unknown) => connections,
}));

const auth: AuthInfo = {
  clientId: 'client',
  token: 'verified-grant',
  grantedScopes: ['tag:test'],
  grantedTags: ['test'],
};

function fixture() {
  const tools = [{ name: 'echo', inputSchema: { type: 'object' }, description: 'original' }];
  const connection = createMockOutboundConnection({
    name: 'server',
    tags: ['test'],
    capabilities: { tools: {} },
    adapter: { request: vi.fn(async () => ({ tools })) },
  });
  const connections = new Map([['server', connection]]);
  const manager = { getClients: () => connections };
  const bind = (currentAuth = auth, capabilities: unknown = { elicitation: { form: {} } }) =>
    createModernInteractionBinding(
      manager,
      {},
      'tools/call',
      { name: 'server_1mcp_echo', arguments: {} },
      currentAuth,
      capabilities,
    );
  return { connection, connections, tools, manager, bind };
}

describe('modern interaction route binding', () => {
  it('keeps an unchanged exact route stable across fresh catalog acquisitions', async () => {
    const { bind } = fixture();
    const first = await bind();
    expect(first).toBeDefined();
    expect(await bind()).toEqual(first);
    expect(JSON.stringify(first)).not.toContain(auth.token);
  });

  it('invalidates changed schemas, replaced providers, grants, and capabilities', async () => {
    const { bind, tools, connections } = fixture();
    const first = await bind();
    tools[0].description = 'changed';
    expect((await bind())?.generation).not.toBe(first?.generation);
    expect((await bind({ ...auth, token: 'different-grant' }))?.principal).not.toBe(first?.principal);
    expect((await bind(auth, {}))?.request).not.toBe(first?.request);
    connections.set(
      'server',
      createMockOutboundConnection({
        name: 'server',
        capabilities: { tools: {} },
        adapter: { request: vi.fn(async () => ({ tools })) },
      }),
    );
    expect((await bind())?.generation).not.toBe(first?.generation);
  });

  it('does not lend an interaction owner to anonymous or hidden calls', async () => {
    const { manager } = fixture();
    expect(
      await createModernInteractionBinding(manager, {}, 'tools/call', { name: 'server_1mcp_echo' }, undefined, {}),
    ).toBeUndefined();
    expect(
      await createModernInteractionBinding(
        manager,
        { tagFilterMode: 'simple-or', tags: ['other'] },
        'tools/call',
        { name: 'server_1mcp_echo' },
        auth,
        {},
      ),
    ).toBeUndefined();
  });

  it('ignores unrelated provider changes while retaining exact source binding', async () => {
    const { bind, connections } = fixture();
    const first = await bind();
    connections.set(
      'other',
      createMockOutboundConnection({
        name: 'other',
        capabilities: { tools: {} },
        adapter: { request: vi.fn(async () => ({ tools: [] })) },
      }),
    );
    expect(await bind()).toEqual(first);
  });

  it('invalidates a parked flow on its source list change and detaches its listener', async () => {
    const { bind, connection } = fixture();
    let deliver!: (event: LegacySdkEvent) => void;
    vi.mocked(connection.adapter.nextEvent).mockImplementation(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const binding = (await bind())!;
    const invalidate = vi.fn();
    const stop = watchModernInteractionBinding(binding, invalidate);
    deliver({ type: 'notification', notification: { method: 'notifications/prompts/list_changed' } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(invalidate).not.toHaveBeenCalled();
    deliver({ type: 'notification', notification: { method: 'notifications/tools/list_changed' } });
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalledOnce());
    expect((await bind())?.generation).not.toBe(binding.generation);
    stop();
    deliver({ type: 'notification', notification: { method: 'notifications/tools/list_changed' } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('refuses a provider replacement between binding and actual dispatch before side effects', async () => {
    const { bind, connection, connections } = fixture();
    const binding = (await bind())!;
    const effect = vi.fn();
    const invoke = () =>
      withModernInteractionBinding(binding, async () => {
        assertInteractionRoute(connection.adapter, 'tools/call', { name: 'echo' });
        effect();
      });
    await invoke();
    expect(effect).toHaveBeenCalledOnce();
    connections.delete('server');
    await expect(invoke()).rejects.toMatchObject({ code: 'interaction_lost' });
    expect(effect).toHaveBeenCalledOnce();
  });
});
