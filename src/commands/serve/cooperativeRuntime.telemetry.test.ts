import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startRuntimeControl } from '@src/core/server/runtimeControl.js';
import { getTelemetryStatus } from '@src/observability/telemetry.js';

import { expect, it } from 'vitest';

import { restartCooperativeRuntime } from './cooperativeRuntime.js';
import type { ServeOptions } from './serve.js';

it('rejects invalid frozen telemetry before draining the authenticated healthy generation', async () => {
  const scope = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-replacement-'));
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
  fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}');
  fs.writeFileSync(path.join(scope, '.env'), 'OTEL_LOGS_EXPORTER=private-invalid');
  const calls: string[] = [];
  const control = await startRuntimeControl(scope, claimId, (method) => {
    calls.push(method);
    if (method !== 'describe') throw new Error('Healthy generation must not drain');
    return {
      runtime: null,
      runtimeScopeId: 'scope',
      version: 'test',
      explicitInputs: { version: 1, values: {} },
      digest: 'a'.repeat(64),
      supervisorPid: process.pid,
      state: 'running',
    };
  });
  try {
    await expect(restartCooperativeRuntime({ 'config-dir': scope } as ServeOptions)).rejects.toThrow(
      'Runtime replacement configuration is invalid',
    );
    expect(calls).toEqual(['describe']);
    expect(fs.readFileSync(ownerPath, 'utf8')).toBe(owner);
    expect(getTelemetryStatus().state).toBe('disabled');
  } finally {
    await control.close();
    fs.rmSync(scope, { recursive: true, force: true });
  }
});
