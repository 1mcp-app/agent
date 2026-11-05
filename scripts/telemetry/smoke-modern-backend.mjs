// Functional harness smoke only: no accepted timing, RSS or budget samples.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createCollector } from '../../test/telemetry/fake-collector.mjs';
import { startModernBackend } from '../../test/telemetry/modern-backend-process.mjs';
import { startRuntime } from '../../test/telemetry/runtime-fixture.mjs';

const artifacts = resolve(process.argv[2] ?? '.tmp/telemetry-modern-smoke');
const baseline = process.argv[3];
assert(baseline, 'Supply the explicit prepared baseline entry for baseline and propagation smoke');
await mkdir(artifacts, { recursive: true });
const report = { kind: 'functional-smoke-no-measurements', modes: [], capacity: null };
async function owned(label, entry, toolCount, operation) {
  const collector = await createCollector();
  let backend, runtime;
  try {
    backend = await startModernBackend({ toolCount, stderrPath: join(artifacts, `${label}.backend.stderr.log`) });
    assert.notEqual(backend.pid, process.pid);
    runtime = await startRuntime({
      collector,
      entry,
      backendConfig: backend.config,
      logLevel: 'error',
      env: { OTEL_TRACES_EXPORTER: 'none', OTEL_METRICS_EXPORTER: 'none' },
    });
    await operation(runtime);
    assert.equal(collector.requests.length, 0);
  } finally {
    try {
      if (runtime) {
        await writeFile(join(artifacts, `${label}.runtime.log`), await runtime.readLog().catch(() => ''));
        await runtime.close();
      }
    } finally {
      try {
        await backend?.close();
      } finally {
        await collector.close();
      }
    }
    if (backend) assert.throws(() => process.kill(backend.pid, 0), { code: 'ESRCH' }, 'Owned fixture must be reaped');
  }
}
try {
  for (const [mode, entry] of [
    ['baseline', resolve(baseline)],
    ['propagation', resolve('build/index.js')],
  ]) {
    await owned(mode, entry, 0, async (runtime) => {
      let next = 0;
      const completed = [0, 0, 0];
      await Promise.all(
        Array.from({ length: 16 }, async () => {
          while (next < 1000) {
            const index = next++ % 100;
            if (index < 80) {
              const result = await runtime.client.listTools();
              assert(result.tools.some((tool) => tool.name === 'fixture_1mcp_echo'));
              completed[0]++;
            } else if (index < 99) {
              const result = await runtime.client.callTool({
                name: 'fixture_1mcp_echo',
                arguments: { message: 'x'.repeat(4096) },
              });
              assert(!result.isError);
              assert.equal(result.content[0].text, 'x'.repeat(4096));
              completed[1]++;
            } else {
              const result = await runtime.client.callTool({ name: 'fixture_1mcp_error', arguments: {} });
              assert(result.isError);
              completed[2]++;
            }
          }
        }),
      );
      assert.deepEqual(completed, [800, 190, 10]);
      report.modes.push({ mode, operations: 1000, concurrency: 16, completed });
    });
  }
  await owned('capacity', resolve('build/index.js'), 10000, async (runtime) => {
    const tools = runtime.tools.filter((tool) => tool.name.startsWith('fixture_1mcp_private_tool_'));
    assert.equal(tools.length, 10000);
    const call = async (i) => {
      const name = `fixture_1mcp_private_tool_${i}`;
      assert(tools.some((tool) => tool.name === name));
      const result = await runtime.client.callTool({ name, arguments: {} });
      assert(!result.isError);
      assert.equal(result.content[0].text, 'capacity-ok');
    };
    await call(0);
    await call(9999);
    await Promise.all(Array.from({ length: 32 }, (_, i) => call(i === 31 ? 9999 : i)));
    report.capacity = { inventory: 10000, first: 0, last: 9999, concurrentCalls: 32 };
  });
  report.verdict = 'pass';
} catch (error) {
  report.verdict = 'fail';
  report.error = error.message;
  throw error;
} finally {
  await writeFile(join(artifacts, 'smoke.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report));
