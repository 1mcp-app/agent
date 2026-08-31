import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  executeMatrixAssignment,
  type MatrixAssignmentDescriptor,
  validateMatrixAssignments,
} from './matrixRuntime.js';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const fakeProcessSource = join(here, 'fixtures/fake-process.mjs');
const actualProbe = join(here, 'fixtures/actual-probe.mjs');

function descriptors(): MatrixAssignmentDescriptor[] {
  const result: MatrixAssignmentDescriptor[] = [];
  for (const inboundEra of ['legacy', 'modern'] as const) {
    for (const upstreamEra of ['legacy', 'modern'] as const) {
      for (const variant of ['typescript-baseline', 'alternate-inbound', 'alternate-upstream'] as const) {
        const profile = `${inboundEra}-${upstreamEra}-${variant}`;
        result.push({
          assignmentId: `case-${profile}`,
          inboundEra,
          upstreamEra,
          variant,
          claimedProfiles: [profile],
          executedProfiles: [profile],
        });
      }
    }
  }
  return result;
}

describe('matrix assignment validation', () => {
  it('accepts exactly one assignment for every era cell and variant', () => {
    expect(validateMatrixAssignments(descriptors())).toHaveLength(12);
  });

  it('rejects duplicate, missing, and unexecuted claims with fixed messages', () => {
    const duplicate = descriptors();
    duplicate[1] = { ...duplicate[0], assignmentId: 'different-id' };
    expect(() => validateMatrixAssignments(duplicate)).toThrow('matrix-assignment-duplicate');

    expect(() => validateMatrixAssignments(descriptors().slice(1))).toThrow('matrix-assignment-missing');

    const unexecuted = descriptors();
    unexecuted[0] = { ...unexecuted[0], executedProfiles: [] };
    expect(() => validateMatrixAssignments(unexecuted)).toThrow('matrix-profile-unexecuted');
  });
});

describe('matrix runtime execution', () => {
  it.each([
    { mode: 'invalid-probe', defect: 'fixture', reason: 'probe_output_invalid' },
    { mode: 'crash-probe', defect: 'process', reason: 'probe_process_failed' },
  ] as const)('runs a $mode once, returns safe infrastructure facts, and cleans up children', async (expected) => {
    const scratch = await mkdtemp(join(tmpdir(), 'matrix-fake-case-'));
    const fakeEntry = join(scratch, 'fake-entry.mjs');
    const pidFile = join(scratch, 'gateway.pid');
    const attemptFile = join(scratch, 'attempts.txt');
    const secretCanary = 'AlphaNumericSecret473';
    await copyFile(fakeProcessSource, fakeEntry);

    try {
      const assignmentId = `case-fake-${expected.mode}`;
      const result = await executeMatrixAssignment({
        assignmentId,
        inboundProbe: {
          command: process.execPath,
          args: [fakeEntry, expected.mode, attemptFile, secretCanary, '{{gatewayEndpoint}}'],
        },
        upstreamPeer: {
          command: process.execPath,
          args: [fakeEntry, 'unused-stdio-peer'],
          readiness: { kind: 'runtime-owned' },
        },
        upstreamTransport: { type: 'stdio' },
        eras: { inbound: 'legacy', upstream: 'legacy' },
        revisions: { inbound: '2025-11-25', upstream: '2025-11-25' },
        captureContexts: {
          inbound: { id: 'fake-inbound', negotiatedRevision: '2025-11-25' },
          upstream: { id: 'fake-upstream', negotiatedRevision: '2025-11-25' },
        },
        builtEntryPath: fakeEntry,
        gatewayArgs: ['--fake-pid-file', pidFile],
        timeouts: { startupMs: 2_000, probeMs: 2_000, shutdownMs: 1_000 },
      });

      expect(result).toEqual({
        kind: 'infrastructure',
        defect: expected.defect,
        reason: expected.reason,
        assignmentId,
      });
      expect(await readFile(attemptFile, 'utf8')).toBe('1');
      expect(JSON.stringify(result)).not.toContain(secretCanary);

      const gatewayPid = Number(await readFile(pidFile, 'utf8'));
      expect(() => process.kill(gatewayPid, 0)).toThrow();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('rejects a probe whose observed revision differs from the matrix expectation', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'matrix-revision-case-'));
    const fakeEntry = join(scratch, 'fake-entry.mjs');
    const attemptFile = join(scratch, 'attempts.txt');
    await copyFile(fakeProcessSource, fakeEntry);

    try {
      const result = await executeMatrixAssignment({
        assignmentId: 'case-negotiated-revision-mismatch',
        inboundProbe: {
          command: process.execPath,
          args: [fakeEntry, 'mismatched-revision-probe', attemptFile, '{{gatewayEndpoint}}'],
        },
        upstreamPeer: {
          command: process.execPath,
          args: [fakeEntry, 'unused-stdio-peer'],
          readiness: { kind: 'runtime-owned' },
        },
        upstreamTransport: { type: 'stdio' },
        eras: { inbound: 'legacy', upstream: 'legacy' },
        revisions: { inbound: '2025-11-25', upstream: '2025-11-25' },
        captureContexts: {
          inbound: { id: 'revision-inbound', negotiatedRevision: '2025-11-25' },
          upstream: { id: 'revision-upstream', negotiatedRevision: '2025-11-25' },
        },
        builtEntryPath: fakeEntry,
        timeouts: { startupMs: 2_000, probeMs: 2_000, shutdownMs: 1_000 },
      });

      expect(result).toEqual({
        kind: 'infrastructure',
        defect: 'harness',
        reason: 'wire_evidence_invalid',
        assignmentId: 'case-negotiated-revision-mismatch',
      });
      expect(await readFile(attemptFile, 'utf8')).toBe('1');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('observes both hops through the actual 1MCP gateway and Python upstream fixture', async () => {
    const builtEntryPath = join(repositoryRoot, 'build/index.js');
    const scratch = await mkdtemp(join(tmpdir(), 'matrix-python-case-'));
    const fixtureRoot = join(repositoryRoot, 'test/conformance/fixtures/python');
    const python = join(fixtureRoot, '.venv/bin/python');
    const driver = join(fixtureRoot, 'driver.py');
    const canaryName = 'MATRIX_SECRET_CANARY';
    const canaryValue = 'AlphaNumericGatewaySecret473';
    process.env[canaryName] = canaryValue;
    try {
      const result = await executeMatrixAssignment({
        assignmentId: 'case-python-http-through-gateway',
        inboundProbe: {
          command: process.execPath,
          args: [actualProbe, '{{gatewayEndpoint}}'],
        },
        upstreamPeer: {
          command: python,
          args: [driver, 'server', '--transport', 'streamable-http', '--protocol-era', 'legacy'],
          readiness: { kind: 'stdout-json', fixtureId: 'python-sdk' },
        },
        upstreamTransport: { type: 'streamableHttp' },
        eras: { inbound: 'legacy', upstream: 'legacy' },
        revisions: { inbound: '2025-11-25', upstream: '2025-11-25' },
        captureContexts: {
          inbound: { id: 'python-inbound', negotiatedRevision: '2025-11-25' },
          upstream: { id: 'python-upstream', negotiatedRevision: '2025-11-25' },
        },
        builtEntryPath,
        timeouts: { startupMs: 20_000, probeMs: 20_000, shutdownMs: 3_000 },
      });

      expect(result.kind, JSON.stringify(result)).toBe('product');
      if (result.kind !== 'product') return;
      expect(result.status).toBe('pass');
      expect(result.firstAttempt).toBe(true);
      expect(result.evidence.inbound.records.length).toBeGreaterThan(0);
      expect(result.evidence.upstream.records.length).toBeGreaterThan(0);
      expect(new Set(result.evidence.inbound.records.map((record) => record.hop))).toEqual(new Set(['inbound']));
      expect(new Set(result.evidence.upstream.records.map((record) => record.hop))).toEqual(new Set(['upstream']));
      expect(JSON.stringify(result)).not.toContain(canaryValue);
    } finally {
      delete process.env[canaryName];
      await rm(scratch, { recursive: true, force: true });
    }
  }, 90_000);
});
