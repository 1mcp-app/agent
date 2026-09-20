import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { type RuntimeControlMethod, startRuntimeControl } from '@src/core/server/runtimeControl.js';

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { restartCooperativeRuntime } from './cooperativeRuntime.js';
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
