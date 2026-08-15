import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { ClientStatus, type OutboundConnections } from '@src/core/types/client.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstructionAggregator } from '../instructions/instructionAggregator.js';
import { ServerManager } from './serverManager.js';

const runtimeConfiguration = vi.hoisted(() => ({
  current: {
    configuredTargets: {
      mcpServers: { upstream: { command: 'node', instructionOverride: 'first override' } },
      mcpTemplates: {},
    },
  },
}));

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: () => ({
      loadConfigWithTemplates: vi.fn().mockResolvedValue({ staticServers: {}, templateServers: {}, errors: [] }),
      getRuntimeInstructionConfiguration: () => runtimeConfiguration.current,
    }),
  },
}));

describe('ServerManager instruction initialization', () => {
  let manager: ServerManager;
  let connectTransport: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const outboundConnections: OutboundConnections = new Map([
      [
        'upstream',
        {
          name: 'upstream',
          status: ClientStatus.Connected,
          transport: {} as any,
          client: {} as any,
        },
      ],
    ]);
    manager = ServerManager.getOrCreateInstance(
      { name: 'test', version: '1.0.0' },
      { capabilities: {} },
      outboundConnections,
      {},
    );
    const aggregator = new InstructionAggregator();
    aggregator.setInstructions({ source: 'mcpServers', name: 'upstream' }, 'raw upstream', 'upstream');
    manager.setInstructionAggregator(aggregator);
    connectTransport = vi.fn().mockResolvedValue(undefined);
    (manager as any).connectionManager = {
      connectTransport,
      getInboundConnections: vi.fn(() => new Map()),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(async () => {
    await ServerManager.resetInstance();
    runtimeConfiguration.current = {
      configuredTargets: {
        mcpServers: { upstream: { command: 'node', instructionOverride: 'first override' } },
        mcpTemplates: {},
      },
    };
  });

  it('keeps delivered instructions unchanged while a new initialization sees a refreshed override', async () => {
    await manager.connectTransport({} as Transport, 'first-session', { tagFilterMode: 'none' });
    const firstDelivered = connectTransport.mock.calls[0][4] as string;

    runtimeConfiguration.current = {
      configuredTargets: {
        mcpServers: { upstream: { command: 'node', instructionOverride: 'second override' } },
        mcpTemplates: {},
      },
    };
    await manager.connectTransport({} as Transport, 'second-session', { tagFilterMode: 'none' });

    expect(firstDelivered).toContain('first override');
    expect(connectTransport.mock.calls[0][4]).toBe(firstDelivered);
    expect(connectTransport.mock.calls[1][4]).toContain('second override');
  });
});
