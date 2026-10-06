import { createHash } from 'node:crypto';

import { conformanceExitCode, validateConformanceBaseline } from './baseline.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  return value;
}
export function integrityDigest(payload: unknown): string {
  return `sha256:${createHash('sha256')
    .update(`${JSON.stringify(canonicalize(payload))}\n`)
    .digest('hex')}`;
}
export function validateReleaseConformance(baselineInput: unknown, integrityInput: unknown, sha: string) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Missing or invalid release SHA');
  const baseline = validateConformanceBaseline(baselineInput);
  if (!integrityInput || typeof integrityInput !== 'object') throw new Error('Missing integrity report');
  const { digest, ...payload } = integrityInput as {
    digest?: unknown;
    source?: { sha?: unknown; clean?: unknown };
    ok?: unknown;
  };
  if (digest !== integrityDigest(payload) || baseline.integrityDigest !== digest)
    throw new Error('Integrity report digest mismatch');
  if (payload.ok !== true || payload.source?.sha !== sha || payload.source.clean !== true)
    throw new Error('Integrity source mismatch');
  if (baseline.sourceSha !== sha || baseline.mode !== 'gate')
    throw new Error('Stale release conformance source or mode');
  if (conformanceExitCode('gate', baseline) !== 0) throw new Error('Release product conformance is not green');
  return baseline;
}
