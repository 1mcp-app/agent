import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'node:test';

import { runConformancePreparation } from '../../../scripts/conformance-preparation.mjs';

function nodeStep(name, source, args = []) {
  return { name, command: process.execPath, args: ['-e', source, ...args], env: process.env };
}

test('preparation starts independent commands concurrently and retains step order', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conformance-preparation-'));
  try {
    const first = join(directory, 'first');
    const second = join(directory, 'second');
    const third = join(directory, 'third');
    const statuses = await runConformancePreparation([
      nodeStep(
        'build',
        `const fs = require('node:fs');
        fs.writeFileSync(process.argv[1], '');
        const deadline = Date.now() + 5000;
        const timer = setInterval(() => {
          if (process.argv.slice(2).every(path => fs.existsSync(path))) {
            clearInterval(timer);
          } else if (Date.now() > deadline) process.exit(9);
        }, 10);`,
        [first, second, third],
      ),
      nodeStep('TypeScript', "require('node:fs').writeFileSync(process.argv[1], ''); process.exit(2)", [second]),
      nodeStep('Python', "require('node:fs').writeFileSync(process.argv[1], ''); process.exit(3)", [third]),
    ]);
    assert.deepEqual(statuses, [0, 2, 3]);
    assert.ok(existsSync(first));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed command does not return before other preparation work finishes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conformance-preparation-'));
  try {
    const completed = join(directory, 'completed');
    const statuses = await runConformancePreparation([
      nodeStep('failed', 'process.exit(7)'),
      nodeStep('cleanup', "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], ''), 100)", [completed]),
    ]);
    assert.deepEqual(statuses, [7, 0]);
    assert.ok(existsSync(completed));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('spawn failures and signal termination fail closed', async () => {
  assert.deepEqual(
    await runConformancePreparation([
      { name: 'missing', command: join(tmpdir(), 'missing-conformance-command'), args: [] },
      nodeStep('signal', "process.kill(process.pid, 'SIGTERM')"),
    ]),
    [1, 1],
  );
});
