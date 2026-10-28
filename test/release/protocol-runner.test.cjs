const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

for (const failure of [-1, 0, 1, 2, 3]) {
  test(`protocol command builds once and stops on failed stage ${failure}`, (t) => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'protocol-command-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const report = path.join(scratch, 'calls.json');
    const preload = path.join(scratch, 'preload.cjs');
    writeFileSync(
      preload,
      `
const calls = [];
require('node:child_process').spawnSync = (command, args, options) => {
  calls.push({ command, args, cwd: options.cwd, thread: options.env.CODEX_THREAD_ID });
  require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify(calls));
  return { status: calls.length - 1 === ${failure} ? 7 : 0 };
};
require('node:module').syncBuiltinESMExports();
`,
    );
    const result = spawnSync(
      process.execPath,
      ['--require', preload, 'scripts/run-protocol.mjs', '--', '--reporter=minimal'],
      {
        encoding: 'utf8',
        env: { ...process.env, CODEX_THREAD_ID: 'must-not-reach-tests' },
      },
    );
    assert.equal(result.status, failure < 0 ? 0 : 7, result.stderr);
    const calls = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(calls.length, failure < 0 ? 4 : failure + 1);
    assert.deepEqual(calls[0].args, ['build']);
    assert.equal(calls.filter((call) => call.args.includes('build')).length, 1);
    assert.ok(calls.every((call) => call.thread === ''));
    if (failure < 0) {
      assert.deepEqual(calls[1].args, ['check']);
      assert.deepEqual(calls[2].args, ['run', '--frozen', 'pytest', '-q']);
      assert.ok(calls[3].args.includes('vitest.protocol.config.ts'));
      assert.ok(calls[3].args.includes('--reporter=minimal'));
    }
  });
}
