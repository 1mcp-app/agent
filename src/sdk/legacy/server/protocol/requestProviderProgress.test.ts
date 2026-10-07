import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import {
  getCapabilityPaginationGeneration,
  registerCapabilityPaginationNotifications,
  unregisterCapabilityPaginationConnections,
} from '@src/core/capabilities/capabilityPagination.js';
import type { CatalogEntry } from '@src/core/capabilities/catalogGeneration.js';
import { ClientStatus } from '@src/core/types/index.js';
import { currentRequestProgress } from '@src/sdk/contracts/requestProgress.js';
import { Client } from '@src/sdk/legacy/client/index.js';
import { createLegacyOutboundConnection } from '@src/sdk/legacy/client/runtime/legacyOutboundConnection.js';
import { Server } from '@src/sdk/legacy/server/index.js';
import type { RequestHandlerExtra } from '@src/sdk/legacy/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@src/sdk/legacy/types.js';

import { describe, expect, it, vi } from 'vitest';

import { withProviderRequestProgress } from './requestProviderProgress.js';

async function provider(name: string) {
  const capabilities = { tools: { listChanged: true } };
  const peer = new Server({ name, version: '1' }, { capabilities });
  const client = new Client({ name: 'observer', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([peer.connect(serverTransport), client.connect(clientTransport)]);
  const connection = createLegacyOutboundConnection({
    name,
    client,
    transport: clientTransport,
    status: ClientStatus.Connected,
    capabilities,
  });
  return { peer, connection };
}

describe('selected provider progress ownership', () => {
  it.each(['selected', 'sibling', 'unchanged'] as const)(
    'observes actual list_changed through queue drain: %s',
    async (changed) => {
      const selected = await provider('selected');
      const sibling = await provider('sibling');
      const connections = new Map([
        ['selected', selected.connection],
        ['sibling', sibling.connection],
      ]);
      const notifications = new Map([
        ['selected', selected.connection],
        ['sibling', sibling.connection],
      ]);
      for (const source of notifications.values()) registerCapabilityPaginationNotifications(notifications, source);
      const epoch = getCapabilityPaginationGeneration(notifications, 'tools');
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const send = vi.fn(async () => {
        if (send.mock.calls.length === 1) await blocked;
      });
      const extra = { signal: new AbortController().signal, sendNotification: send } as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >;
      const entry = { route: { kind: 'tools', connectionKey: 'selected' } } as CatalogEntry;
      const operation = vi.fn(async () => {
        const progress = currentRequestProgress()!;
        progress({ progress: 1 });
        progress({ progress: 2 });
        return 'completed once';
      });
      try {
        const pending = withProviderRequestProgress(
          connections,
          selected.connection,
          entry,
          extra,
          'caller-token',
          operation,
        );
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        if (changed !== 'unchanged') {
          await (changed === 'selected' ? selected.peer : sibling.peer).notification({
            method: 'notifications/tools/list_changed',
          });
          await vi.waitFor(() => expect(getCapabilityPaginationGeneration(notifications, 'tools')).not.toBe(epoch));
        }
        release();
        expect(await pending).toBe('completed once');
        expect(send).toHaveBeenCalledTimes(changed === 'selected' ? 1 : 2);
        expect(operation).toHaveBeenCalledTimes(1);
      } finally {
        release?.();
        unregisterCapabilityPaginationConnections(notifications);
        await selected.connection.adapter.close();
        await sibling.connection.adapter.close();
        await selected.peer.close();
        await sibling.peer.close();
      }
    },
  );
});
