import { buildConformanceBaseline, conformanceExitCode, validateConformanceBaseline } from './baseline.js';
import { input, matrixRuns, official } from './baselineFixtures.js';
import { acceptedContractTraceabilityErrors } from './traceabilityInventory.js';

describe('Conformance Baseline aggregation', () => {
  it('records observed first-attempt product red while infrastructure remains green', () => {
    const baseline = buildConformanceBaseline(input());

    expect(baseline.infrastructureVerdict).toBe('green');
    expect(baseline.productVerdict).toBe('red');
    expect(baseline.officialRuns).toHaveLength(4);
    expect(baseline.matrixRuns).toHaveLength(12);
    expect(baseline.traceability.every((trace) => trace.testIds.length > 0)).toBe(true);
    expect(
      baseline.traceability.every(
        (trace) =>
          trace.matrixCellIds.length > 0 &&
          trace.peerIds.length > 0 &&
          trace.transportProfiles.length > 0 &&
          trace.sourceDigest.startsWith('sha256:') &&
          trace.fixtureDigest.startsWith('sha256:'),
      ),
    ).toBe(true);
    expect(validateConformanceBaseline(baseline)).toEqual(baseline);
    expect(conformanceExitCode('baseline', baseline)).toBe(0);
    expect(conformanceExitCode('gate', baseline)).toBe(1);
  });

  it('retains a classified exclusion from the frozen requirement inventory', () => {
    const value = input();
    value.requirementCatalog[0]!.applicability = { status: 'excluded', reason: 'pending' } as never;

    const baseline = buildConformanceBaseline(value);
    expect(
      baseline.traceability.find((trace) => trace.requirementId === value.requirementCatalog[0]!.requirementId),
    ).toMatchObject({ applicability: { status: 'excluded', reason: 'pending' } });
  });

  it('persists an infrastructure-red baseline when execution stops before matrix planning', () => {
    const value = input();
    value.integrity.ok = false;
    value.requirementCatalog = [];
    value.officialRuns = [];
    value.matrixPlan = [];
    value.matrixRuns = [];
    value.profileProofs = [];
    value.legacyRevisionProofs = [];
    value.sdkBoundaryProof = { classification: 'harness', reason: 'proof-missing', attempt: 1 } as never;

    const baseline = buildConformanceBaseline(value);
    expect(baseline).toMatchObject({ infrastructureVerdict: 'red', productVerdict: 'not-evaluated' });
    expect(baseline.traceability).toEqual([]);
    expect(baseline.infrastructureErrorCodes).toContain('integrity-failed');
  });

  it.each([
    ['missing', undefined],
    ['malformed', { classification: 'product', productVerdict: 'pass' }],
    ['validator failure', { classification: 'harness', reason: 'proof-malformed', attempt: 1 }],
  ])('marks a %s SDK boundary proof as infrastructure red', (_name, proof) => {
    const value = input();
    value.sdkBoundaryProof = proof as never;

    const baseline = buildConformanceBaseline(value);
    expect(baseline.infrastructureVerdict).toBe('red');
    expect(baseline.productVerdict).toBe('not-evaluated');
  });

  it('independently classifies a failed SDK boundary contract as product red', () => {
    const value = input();
    value.officialRuns = value.officialRuns.map((run) => official(run.role, run.revision));
    value.matrixRuns = matrixRuns(value.matrixPlan, true);
    value.profileProofs = value.profileProofs.map((proof) => ({ ...proof, status: 'passed' as const }));
    value.sdkBoundaryProof = { ...value.sdkBoundaryProof, productVerdict: 'fail' } as never;

    const baseline = buildConformanceBaseline(value);
    expect(baseline.infrastructureVerdict).toBe('green');
    expect(baseline.productVerdict).toBe('red');
    expect(baseline.infrastructureErrorCodes).toEqual([]);
  });

  it('keeps a passing SDK boundary contract green when all product evidence passes', () => {
    const value = input();
    value.officialRuns = value.officialRuns.map((run) => official(run.role, run.revision));
    value.matrixRuns = matrixRuns(value.matrixPlan, true);
    value.profileProofs = value.profileProofs.map((proof) => ({ ...proof, status: 'passed' as const }));

    const baseline = buildConformanceBaseline(value);
    expect(baseline).toMatchObject({ infrastructureVerdict: 'green', productVerdict: 'green' });
  });

  it.each([
    ['dirty source', (value: ReturnType<typeof input>) => void (value.integrity.source.clean = false)],
    ['integrity mismatch', (value: ReturnType<typeof input>) => void (value.integrity.ok = false)],
    ['missing official run', (value: ReturnType<typeof input>) => void value.officialRuns.pop()],
    ['missing requirement mapping', (value: ReturnType<typeof input>) => void value.requirementCatalog.pop()],
    ['missing matrix cell', (value: ReturnType<typeof input>) => void value.matrixRuns.pop()],
    [
      'missing upstream evidence',
      (value: ReturnType<typeof input>) => void (value.matrixRuns[0]!.evidence.upstream = undefined as never),
    ],
    ['retry result', (value: ReturnType<typeof input>) => void (value.matrixRuns[0]!.attempt = 2 as never)],
    [
      'claimed but unexecuted profile',
      (value: ReturnType<typeof input>) => void value.matrixRuns[0]!.executedProfiles.pop(),
    ],
    ['unexecuted profile', (value: ReturnType<typeof input>) => void value.matrixPlan[0]!.profiles.pop()],
    ['missing legacy revision', (value: ReturnType<typeof input>) => void value.legacyRevisionProofs.pop()],
    [
      'stale profile proof',
      (value: ReturnType<typeof input>) =>
        void value.profileProofs.push({
          profile: 'direct-serve-stdio',
          testId: 'profile.direct-serve-stdio',
          artifactId: 'profile.direct-serve-stdio.json',
          evidenceDigest: `sha256:${'3'.repeat(64)}`,
          attempt: 1,
          status: 'passed',
        }),
    ],
  ])('marks infrastructure red for %s', (_name, mutate) => {
    const value = structuredClone(input());
    mutate(value);

    const baseline = buildConformanceBaseline(value);
    expect(baseline.infrastructureVerdict).toBe('red');
    expect(baseline.productVerdict).toBe('not-evaluated');
    expect(conformanceExitCode('baseline', baseline)).toBe(1);
    expect(conformanceExitCode('gate', baseline)).toBe(1);
  });

  it('rejects any post-write mutation through independently recomputed digests', () => {
    const baseline = structuredClone(buildConformanceBaseline(input()));
    const firstRun = baseline.matrixRuns[0]!;
    if (firstRun.classification !== 'product') throw new Error('Expected product run');
    firstRun.productVerdict = 'pass';

    expect(() => validateConformanceBaseline(baseline)).toThrow();
  });

  it('rejects missing accepted-contract mappings and stale registered test IDs independently', () => {
    const traceability = buildConformanceBaseline(input()).traceability;
    const withoutContract = traceability.filter(
      (trace) => trace.requirementId !== '1mcp.contract.exact-source-integrity',
    );
    expect(acceptedContractTraceabilityErrors(withoutContract)).toEqual(['accepted-contract-mapping-invalid']);

    const stale = structuredClone(traceability);
    const exactSource = stale.find((trace) => trace.requirementId === '1mcp.contract.exact-source-integrity');
    if (!exactSource) throw new Error('Expected exact-source contract trace');
    exactSource.testIds = ['integrity.renamed-test'];
    expect(acceptedContractTraceabilityErrors(stale)).toEqual(['accepted-contract-test-id-stale']);
    expect(acceptedContractTraceabilityErrors(traceability, '/nonexistent-conformance-source')).toEqual([
      'accepted-contract-test-id-stale',
    ]);
  });

  it('keeps gate mode red for a required transport profile product failure linked to issue 478', () => {
    const value = input();
    const proxyProof = value.profileProofs.find((proof) => proof.profile === 'proxy-stdio');
    if (!proxyProof) throw new Error('Expected proxy profile proof');
    proxyProof.status = 'product-failed';
    Object.assign(proxyProof, { downstreamIssue: 478 as const });

    const baseline = buildConformanceBaseline(value);
    expect(baseline.infrastructureVerdict).toBe('green');
    expect(baseline.productVerdict).toBe('red');
    expect(conformanceExitCode('gate', baseline)).toBe(1);
  });

  it('produces a green gate only from observed green official, matrix, and profile runs', () => {
    const value = input();
    value.officialRuns = [
      official('client', '2025-11-25'),
      official('server', '2025-11-25'),
      official('client', '2026-07-28'),
      official('server', '2026-07-28'),
    ];
    value.matrixRuns = matrixRuns(value.matrixPlan, true);

    const baseline = buildConformanceBaseline(value);
    expect(baseline.productVerdict).toBe('green');
    expect(conformanceExitCode('gate', baseline)).toBe(0);
  });
});
