import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackgroundSupervisorState } from './backgroundRuntimeSupervisorState.js';
import { processEvidenceMatches, verifyLegacyRuntimeOwner } from './legacyRuntimeRecovery.js';
import type { ServerPidInfo } from './pidFileManager.js';
import type { ProcessEvidence } from './processEvidence.js';
import type { RuntimeScopeOwnershipRecord } from './runtimeScopeOwnership.js';

vi.mock('./processEvidence.js', () => ({ readProcessEvidence: vi.fn() }));

const actualStat = fs.statSync;

describe('legacy runtime ownership verification', () => {
  let scope: string;
  let owner: RuntimeScopeOwnershipRecord;
  let state: BackgroundSupervisorState;
  let info: ServerPidInfo;
  let caller: ProcessEvidence;
  let supervisor: ProcessEvidence;
  let worker: ProcessEvidence;
  let readEvidence: ReturnType<typeof vi.fn<(pid: number) => ProcessEvidence | undefined>>;

  function writeMetadata() {
    fs.writeFileSync(path.join(scope, 'runtime.owner', 'owner.json'), JSON.stringify(owner));
    fs.writeFileSync(path.join(scope, 'background-runtime.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(scope, 'server.pid'), JSON.stringify(info));
    fs.writeFileSync(
      path.join(scope, 'background-launch.json'),
      JSON.stringify({ version: 1, claimId: owner.claimId, appConfig: {} }),
    );
  }
  function verify() {
    return verifyLegacyRuntimeOwner(scope, owner, state, info, { readEvidence });
  }

  beforeEach(() => {
    scope = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-verifier-')));
    fs.mkdirSync(path.join(scope, 'runtime.owner'));
    owner = {
      version: 1,
      pid: 41001,
      kind: 'background-supervisor',
      claimId: '8c59f0f1-3472-4a08-9350-5f6df01d83c8',
      claimedAt: '2026-09-19T00:00:00.000Z',
    };
    state = {
      version: 1,
      supervisorPid: owner.pid,
      runtimePid: 41002,
      status: 'running',
      restartAttempt: 0,
      lastExit: null,
      nextRetryAt: null,
      readyAt: owner.claimedAt,
      updatedAt: owner.claimedAt,
    };
    info = {
      pid: 41002,
      url: 'http://localhost:3050',
      port: 3050,
      host: 'localhost',
      transport: 'http',
      startedAt: owner.claimedAt,
      configDir: scope,
    };
    caller = {
      pid: process.pid,
      ppid: 1,
      uid: process.getuid!(),
      realUid: process.getuid!(),
      executable: '/usr/local/bin/1mcp',
      argv: ['/usr/local/bin/1mcp', 'serve', '--stop'],
      birth: '1',
      context: {
        platform: 'linux',
        bootId: 'boot',
        pidNamespace: 'pid:[1]',
        mountNamespace: 'mnt:[1]',
        userNamespace: 'user:[1]',
      },
    };
    supervisor = {
      ...caller,
      pid: owner.pid,
      birth: '2',
      argv: [caller.executable, 'serve', '--background-bootstrap'],
    };
    worker = {
      ...caller,
      pid: info.pid,
      ppid: owner.pid,
      birth: '3',
      argv: [
        caller.executable,
        'serve',
        '--runtime-owner-claim-id',
        owner.claimId,
        '--background-launch-config',
        path.join(scope, 'background-launch.json'),
      ],
    };
    readEvidence = vi.fn((pid: number) =>
      structuredClone([caller, supervisor, worker].find((item) => item.pid === pid)),
    );
    writeMetadata();
    // Model the same files as observed through each Linux process root.
    vi.spyOn(fs, 'statSync').mockImplementation(((file, options) => {
      const resolved = typeof file === 'string' ? file.replace(/^\/proc\/\d+\/root/, '') : file;
      return actualStat(resolved, options);
    }) as typeof fs.statSync);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(scope, { recursive: true, force: true });
  });

  it('proves a pair with no explicit scope arguments using its launch configuration', () => {
    expect(verify()).toEqual({ supervisor, worker });
  });
  it('supports exact equals-form arguments and consistent explicit scope', () => {
    worker.argv = [
      worker.executable,
      'serve',
      `--runtime-owner-claim-id=${owner.claimId}`,
      `--background-launch-config=${scope}/background-launch.json`,
      `--config-dir=${scope}`,
    ];
    supervisor.argv.push('--config-dir', scope);
    expect(verify()).toEqual({ supervisor, worker });
  });
  it('recognizes matching Node package invocations', () => {
    fs.mkdirSync(path.join(scope, 'package', 'build'), { recursive: true });
    fs.writeFileSync(path.join(scope, 'package', 'build', 'index.js'), '');
    fs.writeFileSync(path.join(scope, 'package', 'package.json'), '{"name":"@1mcp/agent"}');
    for (const evidence of [supervisor, worker]) {
      evidence.executable = '/usr/local/bin/node';
      evidence.argv.splice(0, 1, evidence.executable, path.join(scope, 'package', 'build', 'index.js'));
    }
    expect(verify()).toEqual({ supervisor, worker });
  });
  it.each(['owner', 'supervisor', 'worker', 'pid'] as const)(
    'never falls back when %s has persisted identity',
    (record) => {
      // Presence alone disqualifies legacy recovery, regardless of whether identity is valid.
      if (record === 'owner') Object.assign(owner, { processIdentity: {} });
      if (record === 'supervisor') Object.assign(state, { supervisorIdentity: {} });
      if (record === 'worker') Object.assign(state, { runtimeIdentity: {} });
      if (record === 'pid') Object.assign(info, { processIdentity: {} });
      writeMetadata();
      expect(verify()).toBeUndefined();
    },
  );
  it.each(['claim', 'parent', 'uid', 'realUid', 'boot', 'scope', 'launch', 'invocation', 'duplicate', 'flattened'])(
    'rejects conflicting %s evidence',
    (field) => {
      if (field === 'claim') worker.argv[3] = 'other';
      if (field === 'parent') worker.ppid++;
      if (field === 'uid') worker.uid++;
      if (field === 'realUid') worker.realUid++;
      if (field === 'boot') worker.context = { ...worker.context, bootId: 'other' };
      if (field === 'scope') worker.argv.push('--config-dir', os.tmpdir());
      if (field === 'launch') worker.argv[5] += '.copied';
      if (field === 'invocation') worker.argv[1] = 'inspect';
      if (field === 'duplicate') worker.argv.push('--runtime-owner-claim-id', owner.claimId);
      if (field === 'flattened') worker.argv = [worker.argv.join(' ')];
      expect(verify()).toBeUndefined();
    },
  );
  it('rejects mismatched lifecycle records', () => {
    state.runtimePid = info.pid + 1;
    writeMetadata();
    expect(verify()).toBeUndefined();
  });
  it('rejects foreign namespace evidence', () => {
    caller.context = {
      platform: 'linux',
      bootId: 'boot',
      pidNamespace: 'pid:1',
      mountNamespace: 'mnt:1',
      userNamespace: 'usr:1',
    };
    supervisor.context = { ...caller.context };
    worker.context = { ...caller.context, mountNamespace: 'mnt:2' };
    expect(verify()).toBeUndefined();
  });
  it('rejects a different filesystem behind the process root', () => {
    vi.mocked(fs.statSync).mockImplementation(((file, options) => {
      const target = typeof file === 'string' && file.startsWith('/proc/') ? os.tmpdir() : file;
      return actualStat(target, options);
    }) as typeof fs.statSync);
    expect(verify()).toBeUndefined();
  });
  it('refuses symbolic links and writable metadata', () => {
    const file = path.join(scope, 'server.pid');
    fs.chmodSync(file, 0o666);
    expect(verify()).toBeUndefined();
    fs.chmodSync(file, 0o600);
    fs.renameSync(file, `${file}.saved`);
    fs.symlinkSync(`${file}.saved`, file);
    expect(verify()).toBeUndefined();
  });
  it('rejects changed launch claims', () => {
    fs.writeFileSync(path.join(scope, 'background-launch.json'), '{"version":1,"claimId":"other","appConfig":{}}');
    expect(verify()).toBeUndefined();
  });
  it('rejects worker turnover during acquisition', () => {
    let workerReads = 0;
    readEvidence.mockImplementation((pid) => {
      const evidence = structuredClone([caller, supervisor, worker].find((item) => item.pid === pid));
      if (pid === worker.pid && ++workerReads === 2 && evidence) evidence.birth = 'replacement';
      return evidence;
    });
    expect(verify()).toBeUndefined();
  });
  it('rejects metadata replacement during inspection', () => {
    readEvidence.mockImplementation((pid) => {
      if (pid === worker.pid) {
        fs.writeFileSync(
          path.join(scope, 'runtime.owner', 'owner.json'),
          JSON.stringify({ ...owner, claimId: 'other' }),
        );
      }
      return structuredClone([caller, supervisor, worker].find((item) => item.pid === pid));
    });
    expect(verify()).toBeUndefined();
  });
  it('refuses copied metadata in a different scope', () => {
    const copied = path.join(scope, 'copied');
    fs.mkdirSync(copied);
    fs.cpSync(path.join(scope, 'runtime.owner'), path.join(copied, 'runtime.owner'), { recursive: true });
    for (const file of ['background-runtime.json', 'server.pid', 'background-launch.json']) {
      fs.copyFileSync(path.join(scope, file), path.join(copied, file));
    }
    expect(verifyLegacyRuntimeOwner(copied, owner, state, info, { readEvidence })).toBeUndefined();
  });
  it('rejects missing process evidence without treating it as death', () => {
    readEvidence.mockImplementation((pid) =>
      pid === worker.pid ? undefined : structuredClone(pid === caller.pid ? caller : supervisor),
    );
    expect(verify()).toBeUndefined();
  });
  it('rejects an unavailable exact argv reader', () => {
    readEvidence.mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(verify()).toBeUndefined();
  });
  it('requires complete evidence on subsequent revalidation', () => {
    expect(processEvidenceMatches(worker, structuredClone(worker))).toBe(true);
    expect(processEvidenceMatches(worker, undefined)).toBe(false);
    expect(processEvidenceMatches(worker, { ...worker, ppid: 1 })).toBe(false);
    expect(processEvidenceMatches(worker, { ...worker, birth: 'reused' })).toBe(false);
    expect(processEvidenceMatches(worker, { ...worker, argv: [...worker.argv, '--extra'] })).toBe(false);
  });
});
