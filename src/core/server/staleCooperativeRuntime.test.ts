import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readStaleCooperativeRuntime, retireStaleCooperativeRuntime } from './staleCooperativeRuntime.js';

const scopes: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const scope of scopes.splice(0)) fs.rmSync(scope, { recursive: true, force: true });
});

function fixture(options: { supervisorPid?: number; workerPid?: number; stateWorkerPid?: number | null } = {}) {
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-cooperative-'));
  scopes.push(scope);
  const claimId = randomUUID();
  const owner = {
    version: 1,
    pid: options.supervisorPid ?? 99999991,
    claimId,
    kind: 'background-supervisor',
    cooperative: true,
    claimedAt: new Date().toISOString(),
  };
  const runtime = {
    pid: options.workerPid ?? 99999992,
    ownerClaimId: claimId,
    url: 'http://127.0.0.1:3050/mcp',
    port: 3050,
    host: '127.0.0.1',
    transport: 'http',
    startedAt: owner.claimedAt,
    configDir: scope,
  };
  const supervisor = {
    version: 1,
    status: 'running',
    supervisorPid: owner.pid,
    claimId,
    runtimePid: options.stateWorkerPid === undefined ? runtime.pid : options.stateWorkerPid,
    restartAttempt: 0,
    lastExit: null,
    nextRetryAt: null,
    readyAt: null,
    updatedAt: owner.claimedAt,
  };
  fs.mkdirSync(path.join(scope, 'runtime.owner'), { mode: 0o700 });
  fs.writeFileSync(path.join(scope, 'runtime.owner/owner.json'), JSON.stringify(owner));
  fs.writeFileSync(path.join(scope, 'server.pid'), JSON.stringify(runtime));
  fs.writeFileSync(path.join(scope, 'background-runtime.json'), JSON.stringify(supervisor));
  fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}');
  return { scope, claimId, owner, supervisor, runtime };
}

describe('explicit stale cooperative recovery', () => {
  it('retires the matching absent generation and preserves application configuration', () => {
    const f = fixture();
    const observed = readStaleCooperativeRuntime(f.scope, f.claimId);
    if (!observed) throw new Error('Expected stale fixture');
    retireStaleCooperativeRuntime(f.scope, observed);
    for (const name of ['runtime.owner', 'server.pid', 'background-runtime.json', 'runtime.stop']) {
      expect(fs.existsSync(path.join(f.scope, name))).toBe(false);
    }
    expect(fs.readFileSync(path.join(f.scope, 'mcp.json'), 'utf8')).toBe('{"mcpServers":{}}');
  });

  it.each(['supervisor', 'worker', 'state-worker'])('preserves records when the %s is alive', (role) => {
    const f = fixture({
      supervisorPid: role === 'supervisor' ? process.pid : undefined,
      workerPid: role === 'worker' ? process.pid : undefined,
      stateWorkerPid: role === 'state-worker' ? process.pid : undefined,
    });
    expect(readStaleCooperativeRuntime(f.scope)).toBeNull();
    expect(fs.existsSync(path.join(f.scope, 'runtime.owner'))).toBe(true);
  });

  it.each(['EPERM', 'EACCES', 'EIO'])('does not treat %s as process absence', (code) => {
    const f = fixture();
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Process inspection unavailable'), { code });
    });
    expect(readStaleCooperativeRuntime(f.scope)).toBeNull();
    expect(fs.existsSync(path.join(f.scope, 'server.pid'))).toBe(true);
  });

  it('checks the PID record when supervisor state has no worker', () => {
    const f = fixture({ workerPid: process.pid, stateWorkerPid: null });
    expect(readStaleCooperativeRuntime(f.scope)).toBeNull();
  });

  it('refuses a changed ownership generation before retirement', () => {
    const f = fixture();
    const observed = readStaleCooperativeRuntime(f.scope);
    if (!observed) throw new Error('Expected stale fixture');
    fs.writeFileSync(
      path.join(f.scope, 'runtime.owner/owner.json'),
      JSON.stringify({ ...f.owner, claimId: randomUUID() }),
    );
    expect(() => retireStaleCooperativeRuntime(f.scope, observed)).toThrow('ownership changed');
    expect(fs.existsSync(path.join(f.scope, 'server.pid'))).toBe(true);
    expect(fs.existsSync(path.join(f.scope, 'background-runtime.json'))).toBe(true);
  });

  it('refuses worker evidence changed after preflight', () => {
    const f = fixture();
    const observed = readStaleCooperativeRuntime(f.scope);
    if (!observed) throw new Error('Expected stale fixture');
    fs.writeFileSync(path.join(f.scope, 'server.pid'), JSON.stringify({ ...f.runtime, pid: process.pid }));
    expect(() => retireStaleCooperativeRuntime(f.scope, observed)).toThrow('evidence changed');
    expect(fs.existsSync(path.join(f.scope, 'runtime.owner'))).toBe(true);
  });

  it('preserves all records when the control descriptor belongs to another generation', () => {
    const f = fixture();
    fs.writeFileSync(
      path.join(f.scope, 'runtime-control.json'),
      JSON.stringify({
        version: 1,
        configDir: f.scope,
        claimId: randomUUID(),
        url: 'http://127.0.0.1:3051/',
      }),
      { mode: 0o600 },
    );
    const observed = readStaleCooperativeRuntime(f.scope);
    if (!observed) throw new Error('Expected stale fixture');
    expect(() => retireStaleCooperativeRuntime(f.scope, observed)).toThrow('control metadata changed');
    for (const name of ['runtime.owner', 'server.pid', 'background-runtime.json']) {
      expect(fs.existsSync(path.join(f.scope, name))).toBe(true);
    }
  });

  it.each(['worker-claim', 'state-claim', 'foreign-scope', 'malformed-pid', 'noncooperative'])(
    'does not recover %s evidence',
    (conflict) => {
      const f = fixture();
      if (conflict === 'worker-claim')
        fs.writeFileSync(
          path.join(f.scope, 'server.pid'),
          JSON.stringify({ ...f.runtime, ownerClaimId: randomUUID() }),
        );
      if (conflict === 'state-claim')
        fs.writeFileSync(
          path.join(f.scope, 'background-runtime.json'),
          JSON.stringify({ ...f.supervisor, claimId: randomUUID() }),
        );
      if (conflict === 'foreign-scope')
        fs.writeFileSync(path.join(f.scope, 'server.pid'), JSON.stringify({ ...f.runtime, configDir: os.tmpdir() }));
      if (conflict === 'malformed-pid') fs.writeFileSync(path.join(f.scope, 'server.pid'), '{broken');
      if (conflict === 'noncooperative')
        fs.writeFileSync(
          path.join(f.scope, 'runtime.owner/owner.json'),
          JSON.stringify({ ...f.owner, cooperative: undefined }),
        );
      expect(readStaleCooperativeRuntime(f.scope)).toBeNull();
      expect(fs.existsSync(path.join(f.scope, 'runtime.owner'))).toBe(true);
    },
  );
});
