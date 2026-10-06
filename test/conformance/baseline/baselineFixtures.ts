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

export function official(role: 'client' | 'server', revision: '2025-11-25' | '2026-07-28', pass = true) {
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

export function matrixRuns(plan: ReturnType<typeof matrixPlan>, pass = false) {
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

export function input() {
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
