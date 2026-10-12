import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

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
        createMockOutboundConnection({
          name: 'upstream',
          status: ClientStatus.Connected,
        }),
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
      disconnectTransport: vi.fn().mockResolvedValue(undefined),
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

  it('prepares logical templates before discovery without creating a transport connection', async () => {
    const context = { project: { path: '/project' }, user: {}, environment: {}, sessionId: 'proxy-session' };
    await manager.prepareLogicalTemplateSession('proxy-session', context, { tagFilterMode: 'none' });
    expect(connectTransport).not.toHaveBeenCalled();
    const expired: string[] = [];
    const stop = manager.registerLogicalTemplateSessionCleanup((sessionId) => expired.push(sessionId));
    const release = manager.retainLogicalTemplateSession('proxy-session');
    release();
    stop();
    expect(expired).toEqual([]);
  });

  it('closing private bridges preserves their logical session until idle expiry', async () => {
    const context = { project: { path: '/project' }, user: {}, environment: {}, sessionId: 'proxy-session' };
    const expired: string[] = [];
    manager.registerLogicalTemplateSessionCleanup((sessionId) => expired.push(sessionId));
    await Promise.all([
      manager.connectTransport({} as Transport, 'bridge-one', { logicalTemplateSessionId: 'proxy-session' }, context),
      manager.connectTransport({} as Transport, 'bridge-two', { logicalTemplateSessionId: 'proxy-session' }, context),
    ]);
    await manager.disconnectTransport('bridge-one');
    await manager.disconnectTransport('bridge-two');
    expect(expired).toEqual([]);
    expect(connectTransport).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(300001);
      await manager.getTemplateServerManager().cleanupIdleInstances();
      expect(expired).toEqual(['proxy-session']);
    } finally {
      vi.useRealTimers();
    }
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
