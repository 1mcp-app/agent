import { Client as ModernClient } from '@modelcontextprotocol/client';

import { BackendSleepAdapter } from '@src/core/server/backendSleepAdapter.js';
import { ClientStatus } from '@src/core/types/index.js';
import type { LegacyRequestId } from '@src/sdk/contracts/index.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './clientManager.js';
import { openModernSubscription, registerModernSubscriptions } from './modernSubscriptions.js';

// ---------------------------------------------------------------------------
// Production-path regression tests for #547.
//
// These do NOT copy gateway behavior into a helper. They drive the real
// ClientManager through its public API (createSingleClient / restartBackend /
// the stdio supervisor's crash recovery) with a mock MCP client, so the real
// applyBackendSupervisionState() (which clears capabilities on a 'restarting'
// snapshot) and the real InstructionAggregator are exercised. A reverted fix
// (activate() called before state is set to 'connected') makes the supervisor
// snapshot still 'restarting' when recordConnectedClient() rewrites the
// connection, so capabilities/instructions get wiped -- these tests fail.
// ---------------------------------------------------------------------------

vi.mock('@src/logger/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  debugIf: vi.fn(),
}));

vi.mock('@src/config/configManager.js', () => ({
  ConfigManager: {
    getInstance: () => ({
      loadConfigWithTemplates: vi.fn().mockResolvedValue({ staticServers: {}, templateServers: {}, errors: [] }),
      getRuntimeInstructionConfiguration: () => ({ configuredTargets: { mcpServers: {}, mcpTemplates: {} } }),
    }),
  },
}));

// registerCapabilityPaginationNotifications would touch the (mock) transport; stub it.
vi.mock('@src/core/capabilities/capabilityPagination.js', () => ({
  registerCapabilityPaginationNotifications: vi.fn(),
  notifyBackendCapabilityChanges: vi.fn(),
}));

const testEnv = vi.hoisted(() => {
  const createdClients: any[] = [];
  const makeClient = (transport: any) => {
    const client = {
      connect: vi.fn(async () => transport?.__connect?.()),
      getServerVersion: vi.fn().mockResolvedValue({ name: 'mock-backend', version: '1.0.0' }),
      getServerCapabilities: vi.fn(() => transport?.__caps),
      getInstructions: vi.fn(() => transport?.__instr),
      setNotificationHandler: vi.fn(),
      request: vi.fn().mockResolvedValue({ content: [] }),
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      onerror: undefined,
    };
    createdClients.push(client);
    return client;
  };
  return { createdClients, makeClient };
});

vi.mock('./clientFactory.js', () => ({
  ClientFactory: class {
    createClient = vi.fn((transport?: any) => testEnv.makeClient(transport));
    createClientInstance = vi.fn();
    createPooledClientInstance = vi.fn();
  },
}));

vi.mock('./connectionHandler.js', () => ({
  ConnectionHandler: class {
    connectWithRetry = vi.fn(async (client: any, transport: any) => {
      await client.connect(transport);
      return { client, transport };
    });
  },
}));

function makeTransport(caps: any, instr: string, recreate?: () => any): any {
  return {
    stdioSupervision: {
      policy: { restartOnExit: true, restartDelay: 0 },
      recreate: recreate ?? (() => makeTransport(caps, instr)),
      getLastExit: () => ({ code: 1, signal: null }),
    },
    close: vi.fn().mockResolvedValue(undefined),
    pid: 1234,
    tags: [],
    __caps: caps,
    __instr: instr,
  };
}

describe('ClientManager Backend Sleep', () => {
  it('closes catalog listeners locally before intentional process release', async () => {
    vi.useFakeTimers();
    ClientManager.resetInstance();
    const cm = ClientManager.getOrCreateInstance();
    let finishStream!: () => void;
    const closed = new Promise<'remote'>((resolve) => {
      finishStream = () => resolve('remote');
    });
    const transport = makeTransport({}, 'catalog');
    transport.send = vi.fn(async () => {});
    transport.backendSleep = {
      idleTimeoutMs: 30_000,
      release: async () => {
        finishStream();
      },
      recreate: () => makeTransport({}, 'fresh'),
      ownershipBlocker: () => undefined,
    };
    await cm.createSingleClient('catalog', transport);
    const wrapper = cm.getClient('catalog').adapter as BackendSleepAdapter;
    const client = new ModernClient({ name: 'catalog-client', version: '1' });
    vi.spyOn(client, 'listen').mockImplementation(async (filter, options) => {
      void transport.send({
        jsonrpc: '2.0',
        id: 'listen:0',
        method: 'subscriptions/listen',
        params: { notifications: filter },
      });
      options?.signal?.addEventListener('abort', finishStream, { once: true });
      return {
        honoredFilter: filter,
        closed,
        close: async () => {
          finishStream();
        },
      };
    });
    registerModernSubscriptions(wrapper.current, client, transport, async (filter) => filter);
    const coverageLost = vi.fn();
    await openModernSubscription(wrapper, { toolsListChanged: true }, vi.fn(), coverageLost);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cm.getClient('catalog').status).toBe(ClientStatus.Sleeping);
    expect(coverageLost).not.toHaveBeenCalled();
  });

  it('retains a usable awake backend and idle policy when a bulk replacement fails', async () => {
    vi.useFakeTimers();
    ClientManager.resetInstance();
    const cm = ClientManager.getOrCreateInstance();
    const initial = makeTransport({}, 'retained');
    initial.backendSleep = {
      idleTimeoutMs: 30_000,
      release: vi.fn(async () => {}),
      recreate: () => makeTransport({}, 'fresh'),
      ownershipBlocker: () => undefined,
    };
    await cm.createSingleClient('retained', initial);
    const original = cm.getClient('retained');
    const replacement = makeTransport({}, 'failed');
    let rejectReplacement!: (error: Error) => void;
    replacement.__connect = () =>
      new Promise<void>((_resolve, reject) => {
        rejectReplacement = reject;
      });
    const replacing = cm.createClients({ retained: replacement });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(initial.backendSleep.release).not.toHaveBeenCalled();
    await expect(
      original.adapter.request({
        id: 'during-replacement' as LegacyRequestId,
        method: 'tools/call',
        params: { name: 'hello' },
      }),
    ).resolves.toEqual({ content: [] });
    rejectReplacement(new Error('replacement unavailable'));
    await replacing;
    expect(cm.getClient('retained')).toBe(original);
    expect(original.status).toBe(ClientStatus.Connected);
    await expect(
      original.adapter.request({
        id: 'retained-call' as LegacyRequestId,
        method: 'tools/call',
        params: { name: 'hello' },
      }),
    ).resolves.toEqual({ content: [] });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(initial.backendSleep.release).toHaveBeenCalledOnce();
    expect(cm.getClient('retained').status).toBe(ClientStatus.Sleeping);
  });

  afterEach(async () => {
    await ClientManager.shutdownCurrent();
    ClientManager.resetInstance();
    vi.useRealTimers();
  });
  it('releases an idle backend intentionally and replaces it once for concurrent calls', async () => {
    vi.useFakeTimers();
    ClientManager.resetInstance();
    const cm = ClientManager.getOrCreateInstance();
    const replacement = makeTransport({}, 'fresh');
    replacement.pid = 5678;
    delete replacement.stdioSupervision;
    const recreate = vi.fn(() => replacement);
    const release = vi.fn(async () => {});
    const initial = makeTransport({}, 'initial');
    initial.backendSleep = { idleTimeoutMs: 30_000, release, recreate, ownershipBlocker: () => undefined };
    await cm.createSingleClient('sleepy', initial);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cm.getClient('sleepy').status).toBe(ClientStatus.Sleeping);
    expect(release).toHaveBeenCalledTimes(1);
    expect(cm.getBackendSupervision('sleepy')?.currentPid).toBeNull();
    await Promise.all([cm.ensureBackendAwake('sleepy'), cm.ensureBackendAwake('sleepy')]);
    expect(recreate).toHaveBeenCalledTimes(1);
    expect(cm.getClient('sleepy').status).toBe(ClientStatus.Connected);
    expect(cm.getClient('sleepy').instructions).toBe('fresh');
    expect(cm.getBackendSupervision('sleepy')?.attempt).toBe(0);
    expect(cm.getBackendSupervision('sleepy')?.currentPid).toBe(5678);
  });
  it.each(['remove', 'shutdown'])(
    'does not publish a replacement when %s overtakes wake initialization',
    async (action) => {
      vi.useFakeTimers();
      ClientManager.resetInstance();
      const cm = ClientManager.getOrCreateInstance();
      let finish!: () => void;
      const replacement = makeTransport({}, 'obsolete');
      delete replacement.stdioSupervision;
      replacement.__connect = () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        });
      replacement.backendSleep = { release: vi.fn(async () => {}), ownershipBlocker: () => undefined };
      const initial = makeTransport({}, 'initial');
      initial.backendSleep = {
        idleTimeoutMs: 30_000,
        release: vi.fn(async () => {}),
        recreate: () => replacement,
        ownershipBlocker: () => undefined,
      };
      await cm.createSingleClient('removed', initial);
      await vi.advanceTimersByTimeAsync(30_000);
      const waking = cm.ensureBackendAwake('removed').catch((error: Error) => error.message);
      await Promise.resolve();
      const removing = action === 'remove' ? cm.removeClient('removed') : cm.shutdown();
      finish();
      await removing;
      expect(await waking).toMatch(/removed/);
      expect(() => cm.getClient('removed')).toThrow();
      expect(replacement.backendSleep.release).toHaveBeenCalledTimes(1);
    },
  );

  it('starts a fresh idle window on policy replacement and disables sleep on a normal replacement', async () => {
    vi.useFakeTimers();
    ClientManager.resetInstance();
    const cm = ClientManager.getOrCreateInstance();
    const initial = makeTransport({}, 'initial');
    initial.backendSleep = {
      idleTimeoutMs: 60_000,
      release: vi.fn(async () => {}),
      recreate: () => makeTransport({}, 'fresh'),
      ownershipBlocker: () => undefined,
    };
    await cm.createSingleClient('policy', initial);
    await vi.advanceTimersByTimeAsync(30_000);
    const updated = makeTransport({}, 'updated');
    updated.backendSleep = { ...initial.backendSleep, idleTimeoutMs: 90_000, release: vi.fn(async () => {}) };
    await cm.createSingleClient('policy', updated);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(updated.backendSleep.release).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cm.getClient('policy').status).toBe(ClientStatus.Sleeping);
    const disabled = makeTransport({}, 'normal');
    await cm.createSingleClient('policy', disabled);
    expect(cm.getClient('policy').status).toBe(ClientStatus.Connected);
    expect(cm.getClient('policy').sleep).toBeUndefined();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(cm.getClient('policy').status).toBe(ClientStatus.Connected);
  });
  it('refuses configuration replacement while a previous owned release is uncertain', async () => {
    vi.useFakeTimers();
    ClientManager.resetInstance();
    const cm = ClientManager.getOrCreateInstance();
    const initial = makeTransport({}, 'initial');
    initial.backendSleep = {
      idleTimeoutMs: 30_000,
      release: async () => {
        throw new Error('unverified exit');
      },
      recreate: () => makeTransport({}, 'unused'),
      ownershipBlocker: () => undefined,
    };
    await cm.createSingleClient('held', initial);
    await vi.advanceTimersByTimeAsync(30_000);
    const clientsBefore = testEnv.createdClients.length;
    await expect(cm.createSingleClient('held', makeTransport({}, 'replacement'))).rejects.toThrow(/uncertain/);
    expect(testEnv.createdClients).toHaveLength(clientsBefore);
  });
});
