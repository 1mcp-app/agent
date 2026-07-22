import { join } from 'node:path';

import { ClientManager } from '@src/core/client/clientManager.js';
import { ClientInstancePool } from '@src/core/server/clientInstancePool.js';
import { ClientStatus } from '@src/core/types/client.js';
import type { MCPServerParams } from '@src/core/types/transport.js';
import { createTransports } from '@src/transport/transportFactory.js';
import type { ContextData } from '@src/types/context.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

const fixture = join(process.cwd(), 'test/e2e/fixtures/run-tool-server.js');
const pools: ClientInstancePool[] = [];

function supervisedConfig(template?: MCPServerParams['template']): MCPServerParams {
  return {
    type: 'stdio',
    command: process.execPath,
    args: [fixture],
    restartOnExit: true,
    restartDelay: 10,
    maxRestarts: 5,
    ...(template ? { template } : {}),
  };
}

function pidOf(transport: unknown): number {
  const pid = (transport as { pid?: number }).pid;
  if (!pid) throw new Error('stdio fixture transport did not expose a child PID');
  return pid;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.shutdown()));
  const manager = ClientManager.current;
  if (manager) {
    await Promise.all(Array.from(manager.getClients().keys(), (name) => manager.removeClient(name)));
  }
  ClientManager.resetInstance();
});

describe('backend stdio supervision with real child processes', () => {
  it('replaces a crashed static backend with a freshly initialized MCP client', async () => {
    const manager = ClientManager.getOrCreateInstance();
    const transports = createTransports({ worker: supervisedConfig() });
    await manager.createClients(transports);
    const initial = manager.getClient('worker');
    const initialPid = pidOf(initial.transport);

    process.kill(initialPid, 'SIGTERM');

    await vi.waitFor(
      () => {
        const replacement = manager.getClient('worker');
        expect(replacement.status).toBe(ClientStatus.Connected);
        expect(pidOf(replacement.transport)).not.toBe(initialPid);
      },
      { timeout: 5_000, interval: 20 },
    );
    const tools = await manager.getClient('worker').client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain('echo_args');
  });

  it('preserves one shareable template identity and both memberships across recovery', async () => {
    const pool = new ClientInstancePool();
    pools.push(pool);
    const config = supervisedConfig({ shareable: true });
    const context = {} as ContextData;
    const instance = await pool.getOrCreateClientInstance('worker-template', config, context, 'client-a');
    const shared = await pool.getOrCreateClientInstance('worker-template', config, context, 'client-b');
    const initialId = instance.id;
    const initialPid = pidOf(instance.transport);
    expect(shared).toBe(instance);

    process.kill(initialPid, 'SIGTERM');

    await vi.waitFor(
      () => {
        expect(instance.supervision?.state).toBe('connected');
        expect(pidOf(instance.transport)).not.toBe(initialPid);
      },
      { timeout: 5_000, interval: 20 },
    );
    expect(instance.id).toBe(initialId);
    expect(instance.clientIds).toEqual(new Set(['client-a', 'client-b']));
  });

  it('recovers only the crashed per-client template instance', async () => {
    const pool = new ClientInstancePool();
    pools.push(pool);
    const config = supervisedConfig({ perClient: true });
    const context = {} as ContextData;
    const first = await pool.getOrCreateClientInstance('worker-template', config, context, 'client-a');
    const second = await pool.getOrCreateClientInstance('worker-template', config, context, 'client-b');
    const firstPid = pidOf(first.transport);
    const secondPid = pidOf(second.transport);
    expect(first.id).not.toBe(second.id);

    process.kill(firstPid, 'SIGTERM');

    await vi.waitFor(
      () => {
        expect(first.supervision?.state).toBe('connected');
        expect(pidOf(first.transport)).not.toBe(firstPid);
      },
      { timeout: 5_000, interval: 20 },
    );
    expect(pidOf(second.transport)).toBe(secondPid);
    expect(second.status).toBe('active');
  });
});
