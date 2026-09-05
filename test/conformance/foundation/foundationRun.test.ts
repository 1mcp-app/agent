import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as conformanceIntegrity from '../integrity/index.js';
import { type OfficialConformanceResult } from '../official/officialRunner.js';
import { classifyOfficialClientResult, runFoundationConformance, stopChild } from './foundationRun.js';

describe('foundation integrity preflight', () => {
  it('reports a stale artifact pin before attempting evidence generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conformance-integrity-failure-'));
    const verify = conformanceIntegrity.verifyConformanceIntegrity;
    const verifier = vi.spyOn(conformanceIntegrity, 'verifyConformanceIntegrity').mockImplementation((options) =>
      verify({
        ...options,
        artifacts: options.artifacts.map((artifact) =>
          artifact.id === 'sdk-boundary-proof' ? { ...artifact, expectedDigest: `sha256:${'0'.repeat(64)}` } : artifact,
        ),
      }),
    );
    try {
      await expect(
        runFoundationConformance({ root: process.cwd(), outputDirectory: directory, mode: 'baseline' }),
      ).rejects.toThrow('artifact-digest-mismatch:sdk-boundary-proof');
      const report = JSON.parse(await readFile(join(directory, 'conformance-integrity.json'), 'utf8'));
      expect(report).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([{ code: 'artifact-digest-mismatch', subject: 'sdk-boundary-proof' }]),
      });
      expect(await readdir(directory)).toEqual(['conformance-integrity.json']);
    } finally {
      verifier.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

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
