import { InstructionAggregator } from '@src/core/instructions/instructionAggregator.js';
import { ClientStatus } from '@src/core/types/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientManager } from './clientManager.js';

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
}));

const testEnv = vi.hoisted(() => {
  const createdClients: any[] = [];
  const makeClient = (transport: any) => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      getServerVersion: vi.fn().mockResolvedValue({ name: 'mock-backend', version: '1.0.0' }),
      getServerCapabilities: vi.fn(() => transport?.__caps),
      getInstructions: vi.fn(() => transport?.__instr),
      setNotificationHandler: vi.fn(),
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
    connectWithRetry = vi.fn(async (client: any, transport: any) => ({ client, transport }));
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

describe('ClientManager backend supervision recovery (#547)', () => {
  let cm: ClientManager;
  let aggregator: InstructionAggregator;

  beforeEach(() => {
    ClientManager.resetInstance();
    cm = ClientManager.getOrCreateInstance();
    aggregator = new InstructionAggregator();
    cm.setInstructionAggregator(aggregator);
    testEnv.createdClients.length = 0;
  });

  afterEach(async () => {
    await ClientManager.shutdownCurrent().catch(() => undefined);
  });

  it('keeps recovered capabilities and instructions after a manual restart (#547)', async () => {
    const initialCaps = { tools: { listChanged: true }, resources: {} };
    const initialInstr = 'initial docker instructions';
    const recoveredCaps = { tools: { listChanged: false }, prompts: {} };
    const recoveredInstr = 'recovered docker instructions';

    const recoveredTransport = makeTransport(recoveredCaps, recoveredInstr);
    const initialTransport = makeTransport(initialCaps, initialInstr, () => recoveredTransport);

    await cm.createSingleClient('docker', initialTransport);
    expect(cm.getClient('docker').capabilities).toEqual(initialCaps);
    expect(aggregator.getServerInstructions('docker')).toBe(initialInstr);

    await cm.restartBackend('docker');

    // After the supervisor recovers, the gateway must select the *recovered*
    // capabilities (not the stale initial ones, and not undefined) and the
    // aggregator must carry the recovered instructions.
    expect(cm.getClient('docker').capabilities).toEqual(recoveredCaps);
    expect(cm.getClient('docker').status).toBe(ClientStatus.Connected);
    expect(aggregator.getServerInstructions('docker')).toBe(recoveredInstr);
  });

  it('keeps recovered capabilities and instructions after an automatic crash recovery (#547)', async () => {
    const initialCaps = { tools: {} };
    const initialInstr = 'initial docker instructions';
    const recoveredCaps = { tools: {}, prompts: {} };
    const recoveredInstr = 'recovered docker instructions';

    const recoveredTransport = makeTransport(recoveredCaps, recoveredInstr);
    const initialTransport = makeTransport(initialCaps, initialInstr, () => recoveredTransport);

    await cm.createSingleClient('docker', initialTransport);
    const initialClient = testEnv.createdClients[0];

    // Simulate the stdio child process exiting unexpectedly -> supervisor auto-restarts.
    initialClient.onclose?.();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cm.getClient('docker').capabilities).toEqual(recoveredCaps);
    expect(cm.getClient('docker').status).toBe(ClientStatus.Connected);
    expect(aggregator.getServerInstructions('docker')).toBe(recoveredInstr);
  });

  it('drops stale instructions when recovery replaces them with absent metadata (#547)', async () => {
    const initialCaps = { tools: {} };
    const initialInstr = 'initial docker instructions';
    const recoveredCaps = { tools: {}, resources: {} };

    // Recovered backend advertises NO instructions (absent replacement metadata).
    const recoveredTransport = makeTransport(recoveredCaps, undefined as unknown as string);
    const initialTransport = makeTransport(initialCaps, initialInstr, () => recoveredTransport);

    await cm.createSingleClient('docker', initialTransport);
    expect(aggregator.hasInstructions('docker')).toBe(true);

    await cm.restartBackend('docker');

    // Stale initial instructions must not survive; the gateway still selects the
    // recovered capabilities (which a reverted fix would have wiped to undefined).
    expect(cm.getClient('docker').capabilities).toEqual(recoveredCaps);
    expect(aggregator.hasInstructions('docker')).toBe(false);
  });
});
