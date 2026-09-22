import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type RuntimeControlMethod, startRuntimeControl } from '@src/core/server/runtimeControl.js';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { restartCooperativeRuntime, stopCooperativeRuntime } from './cooperativeRuntime.js';
import type { ServeOptions } from './serve.js';

const spawn = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('Replacement must not spawn');
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

describe('cooperative restart commit reconciliation', () => {
  it.each(['aborted', 'drained', 'draining'] as const)(
    'retains the owner and never retries commit or launches after definitive %s status',
    async (state) => {
      const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-reconcile-'));
      const claimId = randomUUID();
      fs.mkdirSync(path.join(scope, 'runtime.owner'), { mode: 0o700 });
      const ownerPath = path.join(scope, 'runtime.owner', 'owner.json');
      const owner = JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId,
        kind: 'background-supervisor',
        claimedAt: new Date().toISOString(),
      });
      fs.writeFileSync(ownerPath, owner);
      const calls: Array<{ method: RuntimeControlMethod; operationId: string }> = [];
      const control = await startRuntimeControl(scope, claimId, (method, _payload, operationId) => {
        calls.push({ method, operationId });
        if (method === 'describe')
          return {
            runtime: null,
            runtimeScopeId: 'scope',
            version: 'test',
            explicitInputs: { version: 1, values: {} },
            digest: 'a'.repeat(64),
            supervisorPid: process.pid,
            state: 'running',
          };
        if (method === 'commit-replacement') throw new Error('Commit rejected');
        return {
          operationId,
          digest: 'a'.repeat(64),
          state: method === 'prepare-replacement' ? 'drained' : state,
          deadlineUnixMs: Date.now() + 30_000,
          active: 0,
        };
      });
      const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        await expect(restartCooperativeRuntime({ 'config-dir': scope } as ServeOptions)).rejects.toThrow(
          'Runtime commit was not accepted; existing owner retained',
        );
        expect(calls.map(({ method }) => method)).toEqual([
          'describe',
          'prepare-replacement',
          'commit-replacement',
          'operation-status',
        ]);
        expect(new Set(calls.slice(1).map(({ operationId }) => operationId)).size).toBe(1);
        expect(spawn).not.toHaveBeenCalled();
        expect(fs.readFileSync(ownerPath, 'utf8')).toBe(owner);
      } finally {
        stderr.mockRestore();
        await control.close();
        fs.rmSync(scope, { recursive: true, force: true });
      }
    },
  );
});

describe('stopCooperativeRuntime', () => {
  it('returns false when runtime control does not exist', async () => {
    const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-stop-none-'));
    try {
      expect(await stopCooperativeRuntime(scope)).toBe(false);
    } finally {
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });

  it('returns false when runtime control endpoint is unreachable', async () => {
    const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-stop-unreachable-'));
    const claimId = randomUUID();
    fs.mkdirSync(path.join(scope, 'runtime.owner'), { mode: 0o700 });
    fs.writeFileSync(
      path.join(scope, 'runtime.owner', 'owner.json'),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId,
        kind: 'background-supervisor',
        claimedAt: new Date().toISOString(),
      }),
    );
    // Start control, then immediately close it so the listener is closed but descriptor/secret files remain
    const control = await startRuntimeControl(scope, claimId, () => ({ accepted: true }));
    const descriptor = control.descriptor;
    await control.close();
    // Re-write descriptor and a dummy secret file so connect succeeds but HTTP requests fail
    fs.writeFileSync(path.join(scope, 'runtime-control.json'), JSON.stringify(descriptor));
    const secretFile = fs.readdirSync(scope).find((name) => name.endsWith('.secret'));
    if (!secretFile) {
      // If closed removed secret, write one
      fs.writeFileSync(path.join(scope, `runtime-control-test.secret`), Buffer.alloc(32).toString('base64url'));
    }

    try {
      expect(await stopCooperativeRuntime(scope)).toBe(false);
    } finally {
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });

  it('stops a live cooperative runtime when control endpoint accepts stop and owner retires', async () => {
    const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'cooperative-stop-success-'));
    const claimId = randomUUID();
    fs.mkdirSync(path.join(scope, 'runtime.owner'), { mode: 0o700 });
    const ownerPath = path.join(scope, 'runtime.owner', 'owner.json');
    fs.writeFileSync(
      ownerPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        claimId,
        kind: 'background-supervisor',
        claimedAt: new Date().toISOString(),
      }),
    );

    const control = await startRuntimeControl(scope, claimId, (method) => {
      if (method === 'describe')
        return {
          runtime: null,
          runtimeScopeId: 'scope',
          version: 'test',
          digest: 'a'.repeat(64),
          supervisorPid: process.pid,
          state: 'running',
        };
      if (method === 'stop') {
        // Simulate retirement by releasing ownership directory
        fs.rmSync(path.join(scope, 'runtime.owner'), { recursive: true, force: true });
        return { accepted: true };
      }
      return {};
    });

    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const result = await stopCooperativeRuntime(scope);
      expect(result).toBe(true);
      expect(stdout).toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      await control.close();
      fs.rmSync(scope, { recursive: true, force: true });
    }
  });
});
