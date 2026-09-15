import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

// Build first: docker build --target basic -t 1mcp-recovery .
// Run: node scripts/test/runtime-container-recovery.mjs 1mcp-recovery
const image = process.argv[2];
assert.ok(image, 'Pass the packaged Docker image to test');
const scope = mkdtempSync(join(tmpdir(), '1mcp-container-recovery-'));
const prefix = `1mcp-recovery-${process.pid}-${Date.now()}`;
const containers = new Set();
const serve = ['index.js', '--config-dir', '/scope', '--host', '127.0.0.1'];

function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60_000 });
  if (!allowFailure) {
    assert.equal(result.status, 0, `docker ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

function start(suffix) {
  const name = `${prefix}-${suffix}`;
  containers.add(name);
  docker(['run', '-d', '--name', name, '--mount', `type=bind,src=${scope},dst=/scope`, image, 'node', ...serve]);
  return name;
}

async function ready(name) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = docker(
      [
        'exec',
        name,
        'node',
        '-e',
        "fetch('http://127.0.0.1:3050/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
      ],
      true,
    );
    if (result.status === 0) return;
    const running = docker(['inspect', '-f', '{{.State.Running}}', name]).stdout.trim();
    if (running !== 'true') break;
    await setTimeout(200);
  }
  assert.fail(`Packaged HTTP runtime did not become ready:\n${docker(['logs', name]).stdout}`);
}

function metadata(path) {
  return JSON.parse(readFileSync(join(scope, path), 'utf8'));
}

try {
  writeFileSync(join(scope, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const original = start('original');
  await ready(original);
  const owner = metadata('runtime.owner/owner.json');
  assert.equal(owner.pid, 1, 'The packaged runtime must run as PID 1');

  const competitor = start('competitor');
  const exit = docker(['wait', competitor]).stdout.trim();
  assert.notEqual(exit, '0', 'A live container sharing the scope must exclude another container');
  assert.equal(metadata('runtime.owner/owner.json').claimId, owner.claimId);
  await ready(original);
  console.log('PASS: live owner excludes a different container/PID namespace');

  // Persist a real stop claim, then kill its holder along with PID 1.
  docker([
    'exec',
    '-d',
    original,
    'node',
    '--input-type=module',
    '-e',
    `
    import { acquireRuntimeScopeStopLock, readRuntimeScopeOwnership } from './core/server/runtimeScopeOwnership.js';
    acquireRuntimeScopeStopLock('/scope', readRuntimeScopeOwnership('/scope'));
    setInterval(() => {}, 1000);
  `,
  ]);
  const stopDeadline = Date.now() + 10_000;
  while (!existsSync(join(scope, 'runtime.stop/lock.json')) && Date.now() < stopDeadline) await setTimeout(100);
  assert.ok(existsSync(join(scope, 'runtime.stop/lock.json')), 'Stop holder must publish metadata');

  docker(['kill', '--signal', 'KILL', original]);
  docker(['rm', original]);
  containers.delete(original);
  const replacement = start('replacement');
  await ready(replacement);
  assert.equal(metadata('runtime.owner/owner.json').pid, 1);
  assert.notEqual(metadata('runtime.owner/owner.json').claimId, owner.claimId);
  assert.equal(existsSync(join(scope, 'runtime.stop')), false);
  console.log('PASS: packaged HTTP PID 1 recovers owner, stop, and PID metadata after external SIGKILL/recreate');

  // An unrelated live PID in this namespace must not receive stop signals.
  docker([
    'exec',
    '-d',
    replacement,
    'node',
    '--input-type=module',
    '-e',
    `
    import fs from 'node:fs';
    fs.writeFileSync('/scope/unrelated.pid', String(process.pid));
    setInterval(() => {}, 1000);
  `,
  ]);
  const unrelatedDeadline = Date.now() + 10_000;
  while (!existsSync(join(scope, 'unrelated.pid')) && Date.now() < unrelatedDeadline) await setTimeout(100);
  const unrelatedPid = Number(readFileSync(join(scope, 'unrelated.pid'), 'utf8'));
  assert.ok(unrelatedPid > 1);
  docker([
    'exec',
    replacement,
    'node',
    '--input-type=module',
    '-e',
    `
    import fs from 'node:fs';
    import { readProcessIdentity } from './core/server/processIdentity.js';
    const info = JSON.parse(fs.readFileSync('/scope/server.pid', 'utf8'));
    info.pid = ${unrelatedPid};
    info.configDir = '/scope/stale';
    info.processIdentity = { ...readProcessIdentity(info.pid), startTime: '0' };
    fs.mkdirSync('/scope/stale');
    fs.writeFileSync('/scope/stale/server.pid', JSON.stringify(info));
  `,
  ]);
  docker(['exec', replacement, 'node', 'index.js', 'serve', '--stop', '--config-dir', '/scope/stale']);
  docker(['exec', replacement, 'node', '-e', `process.kill(${unrelatedPid}, 0)`]);
  assert.equal(existsSync(join(scope, 'stale/server.pid')), false);
  await ready(replacement);
  console.log('PASS: stop removes stale incarnation metadata without signalling the unrelated live PID');
} finally {
  for (const name of containers) docker(['rm', '-f', name], true);
  rmSync(scope, { recursive: true, force: true });
}
