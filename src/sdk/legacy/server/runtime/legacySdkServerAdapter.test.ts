import type { LegacyConnectionId } from '@src/sdk/contracts/legacySdkAdapter.js';
import { OneMcpProtocolError } from '@src/sdk/contracts/oneMcpProtocolError.js';
import type { Server } from '@src/sdk/legacy/server/index.js';
import type { Transport } from '@src/sdk/legacy/shared/transport.js';
import { McpError } from '@src/sdk/legacy/types.js';

import { describe, expect, it, vi } from 'vitest';

import {
  getLegacyServerHandle,
  getLegacyServerTransportHandle,
  LegacySdkServerAdapter,
} from './legacySdkServerAdapter.js';

function createAdapter() {
  const transport = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Transport;
  const server = {
    connect: vi.fn(async () => {
      (server as { transport?: Transport }).transport = transport;
    }),
    notification: vi.fn().mockResolvedValue(undefined),
    transport: undefined as Transport | undefined,
  } as unknown as Server;
  const adapter = new LegacySdkServerAdapter('session-1' as LegacyConnectionId, server, transport);
  return { adapter, server, transport };
}

describe('LegacySdkServerAdapter', () => {
  it('keeps live SDK handles off the adapter surface', () => {
    const { adapter, server } = createAdapter();

    expect(adapter).not.toHaveProperty('server');
    expect(adapter).not.toHaveProperty('transport');
    expect(getLegacyServerHandle(adapter)).toBe(server);
    expect(getLegacyServerTransportHandle(adapter)).toBeUndefined();
  });

  it('owns start, notification, and close lifecycle operations', async () => {
    const { adapter, server, transport } = createAdapter();
    const params = { nested: { value: 'original' } };

    await adapter.start();
    await adapter.notify({ method: 'notifications/tools/list_changed', params });
    params.nested.value = 'changed';
    await adapter.close();

    expect(adapter.state).toBe('stopped');
    expect(getLegacyServerTransportHandle(adapter)).toBe(transport);
    expect(server.notification).toHaveBeenCalledWith({
      method: 'notifications/tools/list_changed',
      params: { nested: { value: 'original' } },
    });
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('rejects notification params that are not JSON objects', async () => {
    const { adapter } = createAdapter();

    await expect(adapter.notify({ method: 'notifications/test', params: null })).rejects.toThrow(
      'Legacy server notification params must be a JSON object',
    );
  });

  it.each(['start', 'notify', 'close'] as const)('converts foreign %s failures', async (operation) => {
    const { adapter, server, transport } = createAdapter();
    const foreign = new McpError(-32_603, `${operation} failed`, { operation });
    if (operation === 'start') vi.mocked(server.connect).mockRejectedValueOnce(foreign);
    if (operation === 'notify') vi.mocked(server.notification).mockRejectedValueOnce(foreign);
    if (operation === 'close') vi.mocked(transport.close).mockRejectedValueOnce(foreign);

    const pending =
      operation === 'start'
        ? adapter.start()
        : operation === 'notify'
          ? adapter.notify({ method: 'notifications/test' })
          : adapter.close();

    await expect(pending).rejects.toMatchObject({
      code: -32_603,
      data: { operation },
    });
    await expect(pending).rejects.toBeInstanceOf(OneMcpProtocolError);
    await expect(pending).rejects.not.toBe(foreign);
  });
});
