import { buildConformanceBaseline, conformanceExitCode, validateConformanceBaseline } from './baseline.js';
import { acceptedContractTraceabilityErrors } from './traceabilityInventory.js';

const requiredProfiles = [
  'inbound-streamable-http-modern',
  'inbound-streamable-http-legacy',
  'inbound-http-sse-retained',
  'direct-serve-stdio',
  'proxy-stdio',
  'upstream-streamable-http-modern',
  'upstream-streamable-http-legacy',
  'upstream-sse-retained',
  'upstream-stdio-modern',
  'upstream-stdio-legacy',
] as const;

function official(role: 'client' | 'server', revision: '2025-11-25' | '2026-07-28', pass = true) {
  return {
    classification: 'product' as const,
    role,
    revision,
    productVerdict: pass ? ('pass' as const) : ('fail' as const),
    scenarios: [
      {
        scenarioId: `${role}-${revision}`,
        checks: [
          { id: 'observed-check', status: pass ? ('SUCCESS' as const) : ('FAILURE' as const), specReferenceIds: [] },
        ],
      },
    ],
    counts: {
      SUCCESS: pass ? 1 : 0,
      FAILURE: pass ? 0 : 1,
      WARNING: 0,
      SKIPPED: 0,
      total: 1,
    },
    artifact: {
      artifactId: `official-evidence/${role}.${revision}.json`,
      digest: `sha256:${'6'.repeat(64)}` as const,
    },
  };
}

const cells = ['modern-modern', 'modern-legacy', 'legacy-modern', 'legacy-legacy'] as const;
const variants = ['typescript-baseline', 'alternate-inbound', 'alternate-upstream'] as const;
const matrixProfiles = requiredProfiles.filter((profile) => profile.includes('streamable-http'));
const focusedProfiles = requiredProfiles.filter((profile) => !matrixProfiles.includes(profile));

function matrixPlan() {
  let profile = 0;
  return cells.flatMap((cellId) =>
    variants.map((variantKind) => ({
      id: `${cellId}.${variantKind}`,
      cellId,
      variantKind,
      profiles: [matrixProfiles[profile++ % matrixProfiles.length]!],
      peerIds: ['typescript-v1-1.30.0', 'typescript-v2-2.0.0'],
    })),
  );
}

function matrixRuns(plan: ReturnType<typeof matrixPlan>, pass = false) {
  return plan.map((assignment) => ({
    classification: 'product' as const,
    assignmentId: assignment.id,
    attempt: 1 as const,
    productVerdict: pass ? ('pass' as const) : ('fail' as const),
    reasonCode: pass ? ('probe-complete' as const) : ('unsupported-protocol-era' as const),
    executedProfiles: [...assignment.profiles],
    probe: {
      negotiatedRevision: assignment.cellId.startsWith('modern') ? ('2026-07-28' as const) : ('2025-11-25' as const),
      operations: ['tools/list' as const, 'tools/call' as const],
    },
    evidence: {
      inbound: { artifactId: `wire.${assignment.id}.inbound`, digest: `sha256:${'1'.repeat(64)}`, records: 1 },
      upstream: { artifactId: `wire.${assignment.id}.upstream`, digest: `sha256:${'2'.repeat(64)}`, records: 1 },
    },
  }));
}

function input() {
  const plan = matrixPlan();
  const officialRuns = [
    official('client', '2025-11-25'),
    official('server', '2025-11-25'),
    official('client', '2026-07-28', false),
    official('server', '2026-07-28', false),
  ];
  return {
    mode: 'baseline' as const,
    sourceSha: '0123456789abcdef0123456789abcdef01234567',
    integrity: { ok: true, digest: `sha256:${'a'.repeat(64)}`, source: { clean: true } },
    requirementCatalog: officialRuns.flatMap((run) =>
      run.scenarios.map((scenario) => ({
        requirementId: `official.${run.revision}.${run.role}.${scenario.scenarioId}`,
        sourceRevision: run.revision,
        role: run.role,
        scenarioId: scenario.scenarioId,
        strength: 'normative' as const,
        applicability: { status: 'required' as const },
        deliveryStage: 'compatibility' as const,
        matrixCellIds: [...cells],
        peerIds: [run.revision === '2026-07-28' ? 'typescript-v2-2.0.0' : 'typescript-v1-1.30.0'],
        transportProfiles: [
          run.revision === '2026-07-28'
            ? ('inbound-streamable-http-modern' as const)
            : ('inbound-streamable-http-legacy' as const),
        ],
        sourceDigest: `sha256:${'4'.repeat(64)}`,
        fixtureDigest: `sha256:${'a'.repeat(64)}`,
      })),
    ),
    officialRuns,
    matrixPlan: plan,
    matrixRuns: matrixRuns(plan),
    profileProofs: focusedProfiles.map((profile) => ({
      profile,
      testId: `transport.gateway.${profile}`,
      artifactId: `profile-evidence/${profile}.json`,
      evidenceDigest: `sha256:${'3'.repeat(64)}` as const,
      attempt: 1 as const,
      status: 'passed' as const,
    })) as Array<{
      profile: (typeof requiredProfiles)[number];
      testId: string;
      artifactId: string;
      evidenceDigest: `sha256:${string}`;
      attempt: 1;
      status: 'passed' | 'product-failed';
      downstreamIssue?: 478;
    }>,
    legacyRevisionProofs: ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'].map((revision) => ({
      revision: revision as '2025-11-25' | '2025-06-18' | '2025-03-26' | '2024-11-05' | '2024-10-07',
      fixtureId: 'typescript-v1-1.30.0',
      transportProfile: 'inbound-streamable-http-legacy' as const,
      testId: `legacy.${revision}.initialize`,
      artifactId: `legacy-revisions/${revision}.json`,
      evidenceDigest: `sha256:${'5'.repeat(64)}`,
      attempt: 1 as const,
    })),
    sdkBoundaryProof: {
      classification: 'product' as const,
      productVerdict: 'pass' as const,
      artifactId: 'boundary/sdk-boundary-proof.json' as const,
      evidenceDigest: `sha256:${'7'.repeat(64)}` as const,
      attempt: 1 as const,
    },
    requiredProfiles: [...requiredProfiles],
  };
}

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
