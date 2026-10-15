import type { OutboundConnection } from '@src/core/types/index.js';

import { describe, expect, it, vi } from 'vitest';

import {
  invalidatePreparedToolProvider,
  registerCapabilityPaginationNotifications,
  walkCapabilityPages,
} from './capabilityPagination.js';

function fixture(name: string) {
  const connection = {
    name,
    adapter: { nextEvent: () => new Promise(() => undefined) },
  } as unknown as OutboundConnection;
  const connections = new Map([[name, connection]]);
  const forward = vi.fn(async () => undefined);
  registerCapabilityPaginationNotifications(connections, connection, {}, forward);
  const options = {
    connections,
    providers: [
      {
        id: name,
        name,
        list: async (cursor?: string) => ({ items: [cursor ?? 'first'], nextCursor: cursor ? undefined : 'next' }),
      },
    ],
    kind: 'tools' as const,
    filterSelection: {},
    enablePagination: true,
  };
  return { connection, connections, forward, options };
}

describe('prepared provider invalidation', () => {
  it('invalidates exact provider walks and uses its existing scoped forwarders without changing another checkout', async () => {
    const prepared = fixture('checkout-a');
    const other = fixture('checkout-b');
    const first = await walkCapabilityPages(prepared.options);
    const second = await walkCapabilityPages(other.options);
    await invalidatePreparedToolProvider(prepared.connection);
    await expect(walkCapabilityPages({ ...prepared.options, cursor: first.nextCursor })).rejects.toMatchObject({
      data: { reason: 'stale_generation' },
    });
    await expect(walkCapabilityPages({ ...other.options, cursor: second.nextCursor })).resolves.toMatchObject({
      items: ['next'],
    });
    expect(prepared.forward).toHaveBeenCalledWith({ method: 'notifications/tools/list_changed' });
    expect(other.forward).not.toHaveBeenCalled();
  });
  it('retains authorization filtering inside registered forwarding callbacks', async () => {
    const f = fixture('checkout');
    const notify = vi.fn();
    let authorized = true;
    registerCapabilityPaginationNotifications(f.connections, f.connection, {}, async () => {
      if (authorized) notify();
    });
    await invalidatePreparedToolProvider(f.connection);
    authorized = false;
    await invalidatePreparedToolProvider(f.connection);
    expect(notify).toHaveBeenCalledOnce();
  });
});
