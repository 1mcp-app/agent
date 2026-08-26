import { createHash } from 'node:crypto';

import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const sourceShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const safeIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9$._/-]{0,255}$/u);
const revisionSchema = z.enum(['2025-11-25', '2026-07-28']);
const roleSchema = z.enum(['client', 'server']);
const profileSchema = z.enum([
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
]);

const officialCheckSchema = z
  .object({
    id: safeIdSchema,
    status: z.enum(['SUCCESS', 'FAILURE', 'WARNING', 'SKIPPED']),
    specReferenceIds: z.array(safeIdSchema),
  })
  .strict();

const officialScenarioSchema = z
  .object({ scenarioId: safeIdSchema, checks: z.array(officialCheckSchema).min(1) })
  .strict();

const officialProductRunSchema = z
  .object({
    classification: z.literal('product'),
    role: roleSchema,
    revision: revisionSchema,
    productVerdict: z.enum(['pass', 'fail']),
    scenarios: z.array(officialScenarioSchema).min(1),
    counts: z
      .object({
        SUCCESS: z.number().int().nonnegative(),
        FAILURE: z.number().int().nonnegative(),
        WARNING: z.number().int().nonnegative(),
        SKIPPED: z.number().int().nonnegative(),
        total: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const officialInfrastructureRunSchema = z
  .object({
    classification: z.enum(['fixture', 'process', 'harness']),
    role: roleSchema,
    revision: revisionSchema,
    reason: safeIdSchema,
  })
  .strict();

const officialRunSchema = z.union([officialProductRunSchema, officialInfrastructureRunSchema]);

const matrixAssignmentSchema = z
  .object({
    id: safeIdSchema,
    cellId: z.enum(['modern-modern', 'modern-legacy', 'legacy-modern', 'legacy-legacy']),
    variantKind: z.enum(['typescript-baseline', 'alternate-inbound', 'alternate-upstream']),
    profiles: z.array(profileSchema).min(1),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({ artifactId: safeIdSchema, digest: sha256Schema, records: z.number().int().nonnegative() })
  .strict();

const matrixProductRunSchema = z
  .object({
    classification: z.literal('product'),
    assignmentId: safeIdSchema,
    attempt: z.literal(1),
    productVerdict: z.enum(['pass', 'fail']),
    reasonCode: z.enum(['probe-complete', 'unsupported-protocol-era', 'unsupported-operation', 'gateway-rejected']),
    executedProfiles: z.array(profileSchema).min(1),
    probe: z
      .object({
        negotiatedRevision: revisionSchema,
        operations: z.array(z.enum(['server/discover', 'initialize', 'ping', 'tools/list', 'tools/call'])).min(1),
      })
      .strict(),
    evidence: z.object({ inbound: evidenceReferenceSchema, upstream: evidenceReferenceSchema }).strict(),
  })
  .strict();

const matrixInfrastructureRunSchema = z
  .object({
    classification: z.enum(['fixture', 'process', 'harness']),
    assignmentId: safeIdSchema,
    attempt: z.literal(1),
    reasonCode: safeIdSchema,
  })
  .strict();

const matrixRunSchema = z.union([matrixProductRunSchema, matrixInfrastructureRunSchema]);

const profileProofSchema = z
  .object({
    profile: profileSchema,
    testId: safeIdSchema,
    evidenceDigest: sha256Schema,
    attempt: z.literal(1),
  })
  .strict();

const traceSchema = z
  .object({
    requirementId: safeIdSchema,
    sourceRevision: z.enum(['2025-11-25', '2026-07-28', '1mcp-accepted-contracts']),
    strength: z.enum(['normative', 'accepted-contract']),
    testIds: z.array(safeIdSchema).min(1),
    evidenceArtifactIds: z.array(safeIdSchema).min(1),
  })
  .strict();

const baselineInputSchema = z
  .object({
    mode: z.enum(['baseline', 'gate']),
    sourceSha: sourceShaSchema,
    integrity: z
      .object({ ok: z.boolean(), digest: sha256Schema, source: z.object({ clean: z.boolean() }).strict() })
      .strict(),
    officialRuns: z.array(officialRunSchema),
    matrixPlan: z.array(matrixAssignmentSchema),
    matrixRuns: z.array(matrixRunSchema),
    profileProofs: z.array(profileProofSchema),
    requiredProfiles: z.array(profileSchema),
  })
  .strict();

const baselinePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(['baseline', 'gate']),
    sourceSha: sourceShaSchema,
    attempt: z.literal(1),
    integrityDigest: sha256Schema,
    infrastructureVerdict: z.enum(['green', 'red']),
    productVerdict: z.enum(['green', 'red', 'not-evaluated']),
    infrastructureErrorCodes: z.array(safeIdSchema),
    officialRuns: z.array(officialRunSchema),
    matrixPlan: z.array(matrixAssignmentSchema),
    matrixRuns: z.array(matrixRunSchema),
    profileProofs: z.array(profileProofSchema),
    requiredProfiles: z.array(profileSchema),
    traceability: z.array(traceSchema),
  })
  .strict();

export const conformanceBaselineSchema = baselinePayloadSchema.extend({ artifactDigest: sha256Schema }).strict();

export type ConformanceBaseline = z.infer<typeof conformanceBaselineSchema>;
export type ConformanceBaselineInput = z.input<typeof baselineInputSchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')}`;
}

function exactSet(actual: string[], expected: string[]): boolean {
  const normalize = (items: string[]) =>
    [...items].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  return (
    new Set(actual).size === actual.length && JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
  );
}

function infrastructureErrors(input: z.infer<typeof baselineInputSchema>): string[] {
  const errors: string[] = [];
  if (!input.integrity.ok) errors.push('integrity-failed');
  if (!input.integrity.source.clean) errors.push('source-dirty');

  const officialIdentities = input.officialRuns.map((run) => `${run.role}.${run.revision}`);
  const requiredOfficial = ['client.2025-11-25', 'server.2025-11-25', 'client.2026-07-28', 'server.2026-07-28'];
  if (!exactSet(officialIdentities, requiredOfficial)) errors.push('official-run-set-invalid');
  if (input.officialRuns.some((run) => run.classification !== 'product')) errors.push('official-infrastructure-failed');

  const requiredAssignments = input.matrixPlan.map((assignment) => assignment.id);
  const observedAssignments = input.matrixRuns.map((run) => run.assignmentId);
  if (input.matrixPlan.length !== 12 || !exactSet(observedAssignments, requiredAssignments)) {
    errors.push('matrix-run-set-invalid');
  }
  const expectedCombinations = input.matrixPlan.map((assignment) => `${assignment.cellId}.${assignment.variantKind}`);
  const requiredCombinations = [
    'modern-modern.typescript-baseline',
    'modern-modern.alternate-inbound',
    'modern-modern.alternate-upstream',
    'modern-legacy.typescript-baseline',
    'modern-legacy.alternate-inbound',
    'modern-legacy.alternate-upstream',
    'legacy-modern.typescript-baseline',
    'legacy-modern.alternate-inbound',
    'legacy-modern.alternate-upstream',
    'legacy-legacy.typescript-baseline',
    'legacy-legacy.alternate-inbound',
    'legacy-legacy.alternate-upstream',
  ];
  if (!exactSet(expectedCombinations, requiredCombinations)) errors.push('matrix-plan-invalid');
  if (input.matrixRuns.some((run) => run.classification !== 'product')) errors.push('matrix-infrastructure-failed');

  const planById = new Map(input.matrixPlan.map((assignment) => [assignment.id, assignment]));
  if (
    input.matrixRuns.some(
      (run) =>
        run.classification === 'product' &&
        !exactSet(run.executedProfiles, planById.get(run.assignmentId)?.profiles ?? []),
    )
  ) {
    errors.push('matrix-profile-execution-mismatch');
  }

  const observedProfiles = [
    ...input.matrixRuns.flatMap((run) => (run.classification === 'product' ? run.executedProfiles : [])),
    ...input.profileProofs.map((proof) => proof.profile),
  ];
  if (!exactSet([...new Set(observedProfiles)], input.requiredProfiles)) {
    errors.push('transport-profile-coverage-invalid');
  }
  if (new Set(input.profileProofs.map((proof) => proof.profile)).size !== input.profileProofs.length) {
    errors.push('transport-profile-proof-duplicate');
  }
  const matrixProfiles = new Set(
    input.matrixRuns.flatMap((run) => (run.classification === 'product' ? run.executedProfiles : [])),
  );
  if (input.profileProofs.some((proof) => matrixProfiles.has(proof.profile))) {
    errors.push('transport-profile-proof-stale');
  }
  return [...new Set(errors)];
}

function buildTraceability(input: z.infer<typeof baselineInputSchema>): z.infer<typeof traceSchema>[] {
  const official = input.officialRuns.flatMap((run) => {
    if (run.classification !== 'product') return [];
    return run.scenarios.map((scenario) => ({
      requirementId: `official.${run.revision}.${run.role}.${scenario.scenarioId}`,
      sourceRevision: run.revision,
      strength: 'normative' as const,
      testIds: scenario.checks.map(
        (check) => `official.${run.role}.${run.revision}.${scenario.scenarioId}.${check.id}`,
      ),
      evidenceArtifactIds: [`official.${run.role}.${run.revision}.${scenario.scenarioId}`],
    }));
  });
  const matrix = input.matrixRuns.flatMap((run) => {
    if (run.classification !== 'product') return [];
    return [
      {
        requirementId: `1mcp.matrix.${run.assignmentId}`,
        sourceRevision: '1mcp-accepted-contracts' as const,
        strength: 'accepted-contract' as const,
        testIds: [`matrix.${run.assignmentId}`],
        evidenceArtifactIds: [run.evidence.inbound.artifactId, run.evidence.upstream.artifactId],
      },
    ];
  });
  const profiles = input.profileProofs.map((proof) => ({
    requirementId: `1mcp.profile.${proof.profile}`,
    sourceRevision: '1mcp-accepted-contracts' as const,
    strength: 'accepted-contract' as const,
    testIds: [proof.testId],
    evidenceArtifactIds: [
      `profile.${proof.profile}.${proof.evidenceDigest.slice('sha256:'.length, 'sha256:'.length + 16)}`,
    ],
  }));
  return [...official, ...matrix, ...profiles];
}

function finalize(payload: z.infer<typeof baselinePayloadSchema>): ConformanceBaseline {
  const parsed = baselinePayloadSchema.parse(payload);
  return conformanceBaselineSchema.parse({ ...parsed, artifactDigest: digest(parsed) });
}

function invalidBaseline(raw: unknown, code: string): ConformanceBaseline {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = record.mode === 'gate' ? 'gate' : 'baseline';
  const sourceSha = sourceShaSchema.safeParse(record.sourceSha).success
    ? (record.sourceSha as string)
    : '0000000000000000000000000000000000000000';
  return finalize({
    schemaVersion: 1,
    mode,
    sourceSha,
    attempt: 1,
    integrityDigest: `sha256:${'0'.repeat(64)}`,
    infrastructureVerdict: 'red',
    productVerdict: 'not-evaluated',
    infrastructureErrorCodes: [code],
    officialRuns: [],
    matrixPlan: [],
    matrixRuns: [],
    profileProofs: [],
    requiredProfiles: [],
    traceability: [],
  });
}

export function buildConformanceBaseline(rawInput: ConformanceBaselineInput): ConformanceBaseline {
  const parsed = baselineInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidBaseline(rawInput, 'baseline-input-invalid');

  const errors = infrastructureErrors(parsed.data);
  const infrastructureVerdict = errors.length === 0 ? 'green' : 'red';
  const productRed =
    parsed.data.officialRuns.some((run) => run.classification === 'product' && run.productVerdict === 'fail') ||
    parsed.data.matrixRuns.some((run) => run.classification === 'product' && run.productVerdict === 'fail');
  return finalize({
    schemaVersion: 1,
    mode: parsed.data.mode,
    sourceSha: parsed.data.sourceSha,
    attempt: 1,
    integrityDigest: parsed.data.integrity.digest,
    infrastructureVerdict,
    productVerdict: infrastructureVerdict === 'red' ? 'not-evaluated' : productRed ? 'red' : 'green',
    infrastructureErrorCodes: errors,
    officialRuns: parsed.data.officialRuns,
    matrixPlan: parsed.data.matrixPlan,
    matrixRuns: parsed.data.matrixRuns,
    profileProofs: parsed.data.profileProofs,
    requiredProfiles: parsed.data.requiredProfiles,
    traceability: buildTraceability(parsed.data),
  });
}

export function validateConformanceBaseline(input: unknown): ConformanceBaseline {
  const baseline = conformanceBaselineSchema.parse(input);
  const { artifactDigest, ...payload } = baseline;
  if (digest(payload) !== artifactDigest) throw new Error('Conformance baseline artifact digest mismatch');
  return baseline;
}

export function conformanceExitCode(mode: 'baseline' | 'gate', baseline: ConformanceBaseline): 0 | 1 {
  if (baseline.infrastructureVerdict === 'red') return 1;
  return mode === 'gate' && baseline.productVerdict !== 'green' ? 1 : 0;
}
