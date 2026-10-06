import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildConformanceBaseline } from '../../test/conformance/baseline/baseline.js';
import { input, matrixRuns, official } from '../../test/conformance/baseline/baselineFixtures.js';
import { integrityDigest, validateReleaseConformance } from '../../test/conformance/baseline/releaseGate.js';

function fixture(green = true) {
  const value = input();
  const payload = { ok: true, source: { sha: value.sourceSha, clean: true }, issues: [] };
  const digest = integrityDigest(payload);
  if (green) {
    value.officialRuns = value.officialRuns.map((run) => official(run.role, run.revision));
    value.matrixRuns = matrixRuns(value.matrixPlan, true);
    value.sdkBoundaryProof = { ...value.sdkBoundaryProof, productVerdict: 'pass' };
  }
  return {
    baseline: buildConformanceBaseline({ ...value, mode: 'gate', integrity: { ...value.integrity, digest } }),
    integrity: { ...payload, digest },
    sha: value.sourceSha,
  };
}
describe('actual release conformance evidence validator', () => {
  it('accepts green exact-source evidence using the existing baseline validator', () => {
    const f = fixture();
    expect(validateReleaseConformance(f.baseline, f.integrity, f.sha).productVerdict).toBe('green');
  });
  it('rejects infrastructure-green product-red baseline evidence', () => {
    const f = fixture(false);
    expect(f.baseline.infrastructureVerdict).toBe('green');
    expect(f.baseline.productVerdict).toBe('red');
    expect(() => validateReleaseConformance(f.baseline, f.integrity, f.sha)).toThrow('not green');
  });
  it.each([
    'missing',
    'malformed',
    'stale',
    'mode',
    'baseline-digest',
    'integrity-digest',
    'integrity-source',
    'not-evaluated',
  ])('rejects %s evidence before publication', (kind) => {
    const f = fixture();
    const baseline: unknown =
      kind === 'missing'
        ? undefined
        : kind === 'malformed'
          ? {}
          : kind === 'baseline-digest'
            ? { ...f.baseline, artifactDigest: `sha256:${'0'.repeat(64)}` }
            : kind === 'mode'
              ? { ...f.baseline, mode: 'baseline' }
              : kind === 'not-evaluated'
                ? { ...f.baseline, productVerdict: 'not-evaluated' }
                : f.baseline;
    const integrity: unknown =
      kind === 'integrity-digest'
        ? { ...f.integrity, digest: `sha256:${'0'.repeat(64)}` }
        : kind === 'integrity-source'
          ? { ...f.integrity, source: { sha: 'b'.repeat(40), clean: true } }
          : f.integrity;
    expect(() => validateReleaseConformance(baseline, integrity, kind === 'stale' ? 'b'.repeat(40) : f.sha)).toThrow();
  });
  const directory = process.env.RELEASE_CONFORMANCE_DIR;
  it.skipIf(!directory)('validates retained reports in the actual release-result job', () => {
    const baseline = JSON.parse(fs.readFileSync(path.join(directory!, 'conformance-baseline.json'), 'utf8'));
    const integrity = JSON.parse(fs.readFileSync(path.join(directory!, 'conformance-integrity.json'), 'utf8'));
    validateReleaseConformance(baseline, integrity, process.env.RELEASE_SHA || '');
  });
});
