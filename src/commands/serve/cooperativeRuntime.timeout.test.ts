import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type RuntimeControlMethod, startRuntimeControl } from '@src/core/server/runtimeControl.js';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { restartCooperativeRuntime } from './cooperativeRuntime.js';
import type { ServeOptions } from './serve.js';

const spawn = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('fixture activation failure');
  }),
);
vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  spawn,
}));
vi.mock('@src/core/server/runtimeReplacementConfig.js', () => ({
  runtimeReplacementSnapshotSchema: z.unknown(),
  explicitLaunchInputsSchema: z.object({ version: z.literal(1), values: z.record(z.string(), z.unknown()) }),
  captureExplicitLaunchInputs: () => ({ version: 1, values: {} }),
  prepareRuntimeReplacementConfig: () => ({
    digest: 'a'.repeat(64),
    effectiveOptions: {},
    snapshot: { appConfig: {} },
  }),
}));

afterEach(() => vi.restoreAllMocks());

async function fixture(
  options: { expired?: boolean; loseStopReply?: boolean; competingOwner?: boolean; retainOwner?: boolean } = {},
) {
  spawn.mockClear();
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative timeout '));
  const claimId = randomUUID();
  const ownerDirectory = path.join(scope, 'runtime.owner');
  const ownerPath = path.join(ownerDirectory, 'owner.json');
  fs.mkdirSync(ownerDirectory, { mode: 0o700 });
  const owner = {
    version: 1,
    pid: process.pid,
    claimId,
    kind: 'background-supervisor',
    claimedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ownerPath, JSON.stringify(owner));
  const calls: RuntimeControlMethod[] = [];
  const control = await startRuntimeControl(scope, claimId, (method, _payload, operationId) => {
    calls.push(method);
    if (method === 'describe')
      return {
        runtime: null,
        runtimeScopeId: 'scope',
        version: 'old-compatible-version',
        explicitInputs: { version: 1, values: {} },
        digest: 'a'.repeat(64),
        supervisorPid: process.pid,
        state: 'running',
      };
    if (method === 'stop') {
      if (options.competingOwner) fs.writeFileSync(ownerPath, JSON.stringify({ ...owner, claimId: randomUUID() }));
      else if (!options.retainOwner) {
        fs.rmSync(ownerDirectory, { recursive: true });
        fs.rmSync(path.join(scope, 'runtime-control.json'));
      }
      if (options.loseStopReply) throw new Error('stop reply lost');
      return { accepted: true };
    }
    return {
      operationId,
      digest: 'a'.repeat(64),
      state: 'aborted',
      active: 2,
      deadlineUnixMs: Date.now() + (options.expired === false ? 30_000 : -1),
    };
  });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return {
    scope,
    calls,
    stderr,
    async close() {
      await control.close();
      fs.rmSync(scope, { recursive: true, force: true });
    },
  };
}

describe('cooperative restart drain deadline', () => {
  it.each([false, true])(
    'stops the authenticated old owner once after expiry (lost reply: %s)',
    async (loseStopReply) => {
      const f = await fixture({ loseStopReply });
      try {
        await expect(restartCooperativeRuntime({ 'config-dir': f.scope } as ServeOptions)).rejects.toThrow(
          'fixture activation failure',
        );
        expect(f.calls.filter((method) => method === 'stop')).toHaveLength(1);
        expect(f.calls).not.toContain('commit-replacement');
        expect(spawn).toHaveBeenCalledTimes(1);
        expect(f.stderr.mock.calls.flat().join('')).toContain('2 requests remain unresolved');
        expect(f.stderr.mock.calls.flat().join('')).toContain('will not be replayed');
      } finally {
        await f.close();
      }
    },
  );

  it(
    'retains ownership and gives recovery guidance when a lost stop reply is not followed by retirement',
    { timeout: 35_000 },
    async () => {
      const f = await fixture({ loseStopReply: true, retainOwner: true });
      try {
        const error = await restartCooperativeRuntime({ 'config-dir': f.scope } as ServeOptions).catch(
          (error: unknown) => error,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('retirement was not confirmed within 30s');
        expect((error as Error).message).toContain(`--config-dir '${f.scope}' --status`);
        expect((error as Error).message).toContain('--stop');
        expect(f.calls.filter((method) => method === 'stop')).toHaveLength(1);
        expect(fs.existsSync(path.join(f.scope, 'runtime.owner'))).toBe(true);
        expect(spawn).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );

  it('keeps the owner with abort policy and gives scoped recovery guidance', async () => {
    const f = await fixture();
    try {
      await expect(
        restartCooperativeRuntime({ 'config-dir': f.scope, 'on-drain-timeout': 'abort' } as ServeOptions),
      ).rejects.toThrow('--on-drain-timeout restart');
      expect(f.calls).toEqual(['describe', 'prepare-replacement']);
      expect(fs.existsSync(path.join(f.scope, 'runtime.owner'))).toBe(true);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it('does not stop an owner when preparation aborts before the deadline', async () => {
    const f = await fixture({ expired: false });
    try {
      await expect(restartCooperativeRuntime({ 'config-dir': f.scope } as ServeOptions)).rejects.toThrow(
        'before the drain deadline',
      );
      expect(f.calls).not.toContain('stop');
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it('does not launch over a competing owner after stopping the original generation', async () => {
    const f = await fixture({ competingOwner: true });
    try {
      await expect(restartCooperativeRuntime({ 'config-dir': f.scope } as ServeOptions)).rejects.toThrow(
        'Another runtime won ownership',
      );
      expect(f.calls.filter((method) => method === 'stop')).toHaveLength(1);
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });
});
