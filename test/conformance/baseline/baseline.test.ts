import { buildConformanceBaseline, conformanceExitCode, validateConformanceBaseline } from './baseline.js';

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
  };
}

const cells = ['modern-modern', 'modern-legacy', 'legacy-modern', 'legacy-legacy'] as const;
const variants = ['typescript-baseline', 'alternate-inbound', 'alternate-upstream'] as const;

function matrixPlan() {
  let profile = 0;
  return cells.flatMap((cellId) =>
    variants.map((variantKind) => ({
      id: `${cellId}.${variantKind}`,
      cellId,
      variantKind,
      profiles: profile < requiredProfiles.length ? [requiredProfiles[profile++]!] : [requiredProfiles[0]],
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
  return {
    mode: 'baseline' as const,
    sourceSha: '0123456789abcdef0123456789abcdef01234567',
    integrity: { ok: true, digest: `sha256:${'a'.repeat(64)}`, source: { clean: true } },
    officialRuns: [
      official('client', '2025-11-25'),
      official('server', '2025-11-25'),
      official('client', '2026-07-28', false),
      official('server', '2026-07-28', false),
    ],
    matrixPlan: plan,
    matrixRuns: matrixRuns(plan),
    profileProofs: [] as Array<{
      profile: (typeof requiredProfiles)[number];
      testId: string;
      evidenceDigest: `sha256:${string}`;
      attempt: 1;
    }>,
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
    expect(validateConformanceBaseline(baseline)).toEqual(baseline);
    expect(conformanceExitCode('baseline', baseline)).toBe(0);
    expect(conformanceExitCode('gate', baseline)).toBe(1);
  });

  it.each([
    ['dirty source', (value: ReturnType<typeof input>) => void (value.integrity.source.clean = false)],
    ['integrity mismatch', (value: ReturnType<typeof input>) => void (value.integrity.ok = false)],
    ['missing official run', (value: ReturnType<typeof input>) => void value.officialRuns.pop()],
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
    [
      'stale profile proof',
      (value: ReturnType<typeof input>) =>
        void value.profileProofs.push({
          profile: 'direct-serve-stdio',
          testId: 'profile.direct-serve-stdio',
          evidenceDigest: `sha256:${'3'.repeat(64)}`,
          attempt: 1,
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

  it('produces a green gate only from observed green official and matrix runs', () => {
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
