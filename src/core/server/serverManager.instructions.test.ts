import { createMockOutboundConnection } from '@test/unit-utils/MockFactories.js';

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { createCapabilityVisibility } from '@src/core/capabilities/capabilityVisibility.js';
import { acquireRuntimeCapabilityCatalog } from '@src/core/capabilities/runtimeCapabilityCatalog.js';
import { ClientStatus, type OutboundConnections } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/transport.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstructionAggregator } from '../instructions/instructionAggregator.js';
import { ServerManager } from './serverManager.js';

const runtimeConfiguration = vi.hoisted(() => ({
  templateServers: {} as Record<string, MCPServerParams>,
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
      loadConfigWithTemplates: vi.fn(async () => ({
        staticServers: {},
        templateServers: runtimeConfiguration.templateServers,
        errors: [],
      })),
      getRuntimeInstructionConfiguration: () => runtimeConfiguration.current,
    }),
  },
}));

// Replace only the backend launch boundary; pooling, template routing and outbound snapshots remain real.
vi.mock('@src/sdk/legacy/server/runtime/clientInstanceFactory.js', () => ({
  createPooledClientInstance: vi.fn(async (params) => ({
    ...params,
    id: params.instanceId,
    client: {
      close: vi.fn().mockResolvedValue(undefined),
      getInstructions: () => 'Use this project template',
      getServerCapabilities: () => ({ tools: {} }),
      request: vi.fn(async () => ({ tools: [] })),
      setNotificationHandler: vi.fn(),
    },
    transport: { close: vi.fn().mockResolvedValue(undefined) },
    referenceCount: 1,
    createdAt: new Date(),
    lastUsedAt: new Date(),
    status: 'active',
    ...(params.processedConfig.restartOnExit
      ? {
          supervision: {
            backendId: params.instanceId,
            state: 'connected',
            attempt: 0,
            limit: 5,
            nextRetryAt: null,
            lastExit: null,
            lastError: null,
            currentPid: 101,
          },
        }
      : {}),
    outboundKeys: new Set(),
    clientIds: new Set([params.clientId]),
  })),
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
    runtimeConfiguration.templateServers = {};
    runtimeConfiguration.current = {
      configuredTargets: {
        mcpServers: { upstream: { command: 'node', instructionOverride: 'first override' } },
        mcpTemplates: {},
      },
    };
  });

  it('repeated and concurrent logical preparation preserves outbound continuation identity', async () => {
    runtimeConfiguration.templateServers = {
      worker: { command: 'node', args: ['{{project.path}}'], template: { perClient: true } },
    };
    const context = { project: { path: '/project' }, user: {}, environment: {}, sessionId: 'proxy-session' };
    await manager.prepareLogicalTemplateSession('proxy-session', context, { tagFilterMode: 'none' });
    const [key, connection] = Array.from(manager.getClients()).find(([, outbound]) => outbound.name === 'worker')!;
    expect(connection?.instructions).toBe('Use this project template');
    await Promise.all([
      manager.prepareLogicalTemplateSession('proxy-session', context, { tagFilterMode: 'none' }),
      manager.prepareLogicalTemplateSession('proxy-session', context, { tagFilterMode: 'none' }),
    ]);
    expect(manager.getClients().get(key)).toBe(connection);
    expect(manager.getTemplateServerManager().getClientInstancePool().getTemplateInstances('worker')).toHaveLength(1);
  });

  it.each([false, true])(
    'joining a shareable template preserves catalog/provider with supervision %s',
    async (restartOnExit) => {
      runtimeConfiguration.templateServers = {
        worker: { command: 'node', args: ['{{project.path}}'], restartOnExit, template: { shareable: true } },
      };
      const context = { project: { path: '/project' }, user: {}, environment: {} };
      await manager.prepareLogicalTemplateSession('proxy-a', { ...context, sessionId: 'proxy-a' });
      const [key, connection] = Array.from(manager.getClients()).find(([, outbound]) => outbound.name === 'worker')!;
      const snapshot = await acquireRuntimeCapabilityCatalog(
        manager.getClients(),
        createCapabilityVisibility([[key, 'worker']], 'proxy-a'),
      );
      expect(snapshot.isCurrent()).toBe(true);
      await manager.prepareLogicalTemplateSession('proxy-b', { ...context, sessionId: 'proxy-b' });
      expect(manager.getClients().get(key)).toBe(connection);
      expect(snapshot.isCurrent()).toBe(true);
      const instances = manager.getTemplateServerManager().getClientInstancePool().getTemplateInstances('worker');
      expect(instances).toHaveLength(1);
      expect(instances[0].referenceCount).toBe(2);
    },
  );

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
    manager.getClients().set('backend:proxy-session', createMockOutboundConnection({ capabilities: {} }));
    const snapshot = await acquireRuntimeCapabilityCatalog(
      manager.getClients(),
      createCapabilityVisibility([['backend:proxy-session', 'backend']], 'proxy-session'),
    );
    await manager.disconnectTransport('bridge-one');
    await manager.disconnectTransport('bridge-two');
    expect(expired).toEqual([]);
    expect(snapshot.isCurrent()).toBe(true);
    expect(connectTransport).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(300001);
      await manager.getTemplateServerManager().cleanupIdleInstances();
      expect(expired).toEqual(['proxy-session']);
      expect(snapshot.isCurrent()).toBe(false);
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
