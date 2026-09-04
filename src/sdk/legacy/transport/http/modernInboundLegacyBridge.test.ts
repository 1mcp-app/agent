import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createModernInboundLegacyBridge } from './modernInboundLegacyBridge.js';

const mocks = vi.hoisted(() => ({
  createLinkedPair: vi.fn(),
  clientConnect: vi.fn(),
  legacyClose: vi.fn(),
  legacyStart: vi.fn(),
  outbound: { role: 'outbound', pin: { era: 'legacy', revision: '2025-11-25' } },
}));

vi.mock('@modelcontextprotocol/sdk/inMemory.js', () => ({
  InMemoryTransport: { createLinkedPair: mocks.createLinkedPair },
}));
vi.mock('@src/sdk/legacy/client/index.js', () => ({
  Client: class {
    connect = mocks.clientConnect;
  },
}));
vi.mock('@src/sdk/legacy/client/runtime/legacySdkClientAdapter.js', () => ({
  LegacySdkClientAdapter: class {
    close = mocks.legacyClose;
    start = mocks.legacyStart;
  },
}));
vi.mock('@src/gateway/adapters/legacy/legacyOutboundEraAdapter.js', () => ({
  LegacyOutboundEraAdapter: class {
    role = mocks.outbound.role;
    pin = mocks.outbound.pin;
  },
}));

describe('modern inbound legacy bridge lifecycle', () => {
  const clientTransport = { close: vi.fn() };
  const serverTransport = { close: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    clientTransport.close.mockResolvedValue(undefined);
    serverTransport.close.mockResolvedValue(undefined);
    mocks.createLinkedPair.mockReturnValue([clientTransport, serverTransport]);
    mocks.clientConnect.mockResolvedValue(undefined);
    mocks.legacyStart.mockResolvedValue(undefined);
    mocks.legacyClose.mockResolvedValue(undefined);
  });

  it('rolls back both transports and server registration after a partial connect failure', async () => {
    const failure = new Error('server connect failed');
    const serverManager = {
      connectTransport: vi.fn().mockRejectedValue(failure),
      disconnectTransport: vi.fn().mockResolvedValue(undefined),
    };

    await expect(createModernInboundLegacyBridge(serverManager as never, {})).rejects.toBe(failure);
    expect(clientTransport.close).toHaveBeenCalledTimes(1);
    expect(serverTransport.close).toHaveBeenCalledTimes(1);
    expect(serverManager.disconnectTransport).toHaveBeenCalledTimes(1);
  });

  it('closes all sides once and still disconnects when the client close fails', async () => {
    const failure = new Error('client close failed');
    mocks.legacyClose.mockRejectedValue(failure);
    const serverManager = {
      connectTransport: vi.fn().mockResolvedValue(undefined),
      disconnectTransport: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = await createModernInboundLegacyBridge(serverManager as never, {});

    const first = bridge.close();
    const second = bridge.close();
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    expect(mocks.legacyClose).toHaveBeenCalledTimes(1);
    expect(serverManager.disconnectTransport).toHaveBeenCalledTimes(1);
  });
});
