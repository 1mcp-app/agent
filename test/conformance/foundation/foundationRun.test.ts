import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type OfficialConformanceResult } from '../official/officialRunner.js';
import { classifyOfficialClientResult, stopChild } from './foundationRun.js';

function officialProductResult(): OfficialConformanceResult {
  return {
    classification: 'product',
    role: 'client',
    revision: '2025-11-25',
    productVerdict: 'fail',
    scenarios: [{ scenarioId: 'tools_call', checks: [{ id: 'tools-call', status: 'FAILURE', specReferenceIds: [] }] }],
    counts: { SUCCESS: 0, FAILURE: 1, WARNING: 0, SKIPPED: 0, total: 1 },
    artifact: { artifactId: 'official/client-legacy.json', digest: `sha256:${'a'.repeat(64)}` },
  };
}

describe('official client gateway classification', () => {
  it.each([
    ['attempted', 'product'],
    ['fixture-defect', 'fixture'],
    ['harness-defect', 'harness'],
  ] as const)('maps a %s bridge outcome to %s evidence', async (status, classification) => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    try {
      await writeFile(join(directory, 'tools_call.json'), JSON.stringify({ scenario: 'tools_call', status }), 'utf8');
      const result = await classifyOfficialClientResult(officialProductResult(), directory);
      expect(result.classification).toBe(classification);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('treats a missing bridge outcome as a harness defect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    try {
      const result = await classifyOfficialClientResult(officialProductResult(), directory);
      expect(result).toMatchObject({ classification: 'harness', reason: 'artifact-invalid' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('retained revision fixture cleanup', () => {
  it('awaits confirmed exit after bounded SIGKILL escalation', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await once(child.stdout!, 'data');

    await stopChild(child, 250);

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(child.signalCode).toBe('SIGKILL');
  });
});
