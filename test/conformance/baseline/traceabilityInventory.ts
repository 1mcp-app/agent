import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ACCEPTED_CONTRACT_TRACEABILITY_INVENTORY = [
  {
    requirementId: '1mcp.contract.baseline-gate-semantics',
    testIds: ['baseline.verdict-modes'],
    testPath: 'test/conformance/baseline/baseline.test.ts',
    testNeedle: "it('records observed first-attempt product red while infrastructure remains green'",
    evidenceArtifactIds: ['conformance-baseline', 'conformance-integrity'],
  },
  {
    requirementId: '1mcp.contract.exact-source-integrity',
    testIds: ['integrity.exact-source'],
    testPath: 'test/conformance/integrity/integrity.test.ts',
    testNeedle: "it('produces a green exact-source report from actual pinned inputs'",
    evidenceArtifactIds: ['conformance-baseline', 'conformance-integrity'],
  },
  {
    requirementId: '1mcp.contract.two-hop-sanitization',
    testIds: ['capture.adversarial-corpus'],
    testPath: 'test/conformance/capture/sanitizedWireEvidence.test.ts',
    testNeedle: "it('retains only allowlisted structural facts and uses the supplied validator'",
    evidenceArtifactIds: ['conformance-baseline', 'conformance-integrity'],
  },
  {
    requirementId: '1mcp.contract.first-attempt-no-retry',
    testIds: ['baseline.first-attempt'],
    testPath: 'test/conformance/baseline/baseline.test.ts',
    testNeedle: "it('records observed first-attempt product red while infrastructure remains green'",
    evidenceArtifactIds: ['conformance-baseline', 'conformance-integrity'],
  },
  {
    requirementId: '1mcp.contract.four-era-matrix',
    testIds: ['matrix.assignment-completeness'],
    testPath: 'test/conformance/runtime/matrixRuntime.test.ts',
    testNeedle: "it('accepts exactly one assignment for every era cell and variant'",
    evidenceArtifactIds: ['conformance-baseline', 'conformance-integrity'],
  },
] as const;

interface AcceptedContractTrace {
  requirementId: string;
  strength: string;
  testIds: readonly string[];
  evidenceArtifactIds: readonly string[];
}

function exactSet(actual: readonly string[], expected: readonly string[]): boolean {
  const normalize = (items: readonly string[]) => [...items].sort((left, right) => left.localeCompare(right));
  return (
    new Set(actual).size === actual.length && JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
  );
}

function registeredTestExists(sourceRoot: string, path: string, needle: string): boolean {
  try {
    return readFileSync(resolve(sourceRoot, path), 'utf8').includes(needle);
  } catch {
    return false;
  }
}

export function acceptedContractTraceabilityErrors(
  traces: readonly AcceptedContractTrace[],
  sourceRoot = process.cwd(),
): string[] {
  const acceptedContracts = traces.filter(
    (trace) => trace.strength === 'accepted-contract' && trace.requirementId.startsWith('1mcp.contract.'),
  );
  if (
    !exactSet(
      acceptedContracts.map((trace) => trace.requirementId),
      ACCEPTED_CONTRACT_TRACEABILITY_INVENTORY.map((entry) => entry.requirementId),
    )
  ) {
    return ['accepted-contract-mapping-invalid'];
  }

  for (const expected of ACCEPTED_CONTRACT_TRACEABILITY_INVENTORY) {
    const trace = acceptedContracts.find((candidate) => candidate.requirementId === expected.requirementId);
    if (
      !trace ||
      !exactSet(trace.testIds, expected.testIds) ||
      !exactSet(trace.evidenceArtifactIds, expected.evidenceArtifactIds) ||
      !registeredTestExists(sourceRoot, expected.testPath, expected.testNeedle)
    ) {
      return ['accepted-contract-test-id-stale'];
    }
  }
  return [];
}
