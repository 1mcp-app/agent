import assert from 'node:assert/strict';

import test from 'node:test';

import { runCapacityWorkers, startCapacityClients } from './capacity-clients.mjs';
import { createCollector } from './fake-collector.mjs';
import { startRuntime, waitUntil } from './runtime-fixture.mjs';
import { createModernBackend } from './workload-modern-backend.mjs';

async function closeSmokeResources(...resources) {
  const errors = [];
  for (const resource of resources) {
    try {
      await resource?.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Smoke cleanup failed');
}

test('smoke cleanup attempts every owner and reports all cleanup failures', async () => {
  const called = [];
  const first = new Error('owners cleanup failed');
  const second = new Error('runtime cleanup failed');
  const resources = [
    {
      close: async () => {
        called.push('owners');
        throw first;
      },
    },
    {
      close: () => {
        called.push('runtime');
        throw second;
      },
    },
    {
      close: async () => {
        called.push('backend');
      },
    },
    {
      close: async () => {
        called.push('collector');
      },
    },
  ];
  await assert.rejects(closeSmokeResources(...resources), (error) => {
    assert.deepEqual(called, ['owners', 'runtime', 'backend', 'collector']);
    assert(error instanceof AggregateError);
    assert.deepEqual(error.errors, [first, second]);
    return true;
  });
});

test(
  'two independent owners admit 32 held calls while one owner rejects its 17th call',
  { timeout: 45000 },
  async () => {
    let release;
    let entered = 0;
    let gate = new Promise((resolve) => {
      release = resolve;
    });
    let backend, collector, runtime, owners;
    let pending = [];
    try {
      backend = await createModernBackend({
        toolCount: 1,
        onCapacityCall: async () => {
          entered++;
          await gate;
        },
      });
      collector = await createCollector();
      runtime = await startRuntime({
        collector,
        logLevel: 'error',
        backendConfig: { type: 'http', url: backend.url, protocolVersion: '2026-07-28' },
      });
      owners = await startCapacityClients(runtime.url, 2);
      const tool = runtime.tools.find((tool) => tool.name.endsWith('private_tool_0'));
      assert(tool);
      const call = (client) => client.callTool({ name: tool.name, arguments: {} });
      pending = Array.from({ length: 16 }, () => call(owners.clients[0]));
      await waitUntil(() => entered === 16, 'First owner did not admit its 16 calls');
      await assert.rejects(
        call(owners.clients[0]),
        (error) => error.data?.['app.1mcp/failure']?.code === 'interaction_capacity_exceeded',
      );
      release();
      await Promise.all(pending);
      entered = 0;
      gate = new Promise((resolve) => {
        release = resolve;
      });
      const pressure = runCapacityWorkers(owners.clients, 32, call);
      pending = [pressure];
      await Promise.race([
        waitUntil(() => entered === 32, 'Two owners did not admit aggregate 32 calls'),
        pressure.then(() => {
          throw new Error('Calls finished before the upstream gate opened');
        }),
      ]);
      assert.equal(entered, 32);
      release();
      const results = await pressure;
      assert.equal(results.length, 32);
      for (const result of results) {
        assert.equal(result.content[0].text, 'capacity-ok');
        assert(!result.isError);
      }
    } finally {
      release();
      await Promise.allSettled(pending);
      await closeSmokeResources(owners, runtime, backend, collector);
    }
  },
);
