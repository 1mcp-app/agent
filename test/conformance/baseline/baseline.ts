import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  ACCEPTED_CONTRACT_TRACEABILITY_INVENTORY,
  acceptedContractTraceabilityErrors,
} from './traceabilityInventory.js';

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

const officialScenarioSchema = z.object({ scenarioId: safeIdSchema, checks: z.array(officialCheckSchema) }).strict();

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
    artifact: z
      .object({
        artifactId: safeIdSchema,
        digest: sha256Schema,
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
    peerIds: z.array(safeIdSchema).min(2),
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
    reasonCode: z.enum([
      'probe-complete',
      'unsupported-protocol-era',
      'unsupported-operation',
      'gateway-rejected',
      'schema-invalid',
    ]),
    executedProfiles: z.array(profileSchema).min(1),
    probe: z
      .object({
        negotiatedRevision: z.union([revisionSchema, z.literal('not-negotiated')]),
        operations: z
          .array(z.enum(['transport/connect', 'server/discover', 'initialize', 'ping', 'tools/list', 'tools/call']))
          .min(1),
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

const applicabilitySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('required') }).strict(),
  z
    .object({
      status: z.literal('excluded'),
      reason: z.enum(['extension', 'added-after-release', 'pending', 'version-not-applicable']),
    })
    .strict(),
]);

const requirementMetadataSchema = z
  .object({
    requirementId: safeIdSchema,
    sourceRevision: revisionSchema,
    role: roleSchema,
    scenarioId: safeIdSchema,
    strength: z.literal('normative'),
    applicability: applicabilitySchema,
    deliveryStage: z.literal('compatibility'),
    matrixCellIds: z.array(safeIdSchema).min(1),
    peerIds: z.array(safeIdSchema).min(1),
    transportProfiles: z.array(profileSchema).min(1),
    sourceDigest: sha256Schema,
    fixtureDigest: sha256Schema,
  })
  .strict();

const profileProofSchema = z
  .object({
    profile: profileSchema,
    testId: safeIdSchema,
    artifactId: safeIdSchema,
    evidenceDigest: sha256Schema,
    attempt: z.literal(1),
    status: z.enum(['passed', 'product-failed']),
    downstreamIssue: z.literal(478).optional(),
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      (proof.status === 'product-failed' && proof.downstreamIssue !== 478) ||
      (proof.status === 'passed' && proof.downstreamIssue !== undefined)
    ) {
      context.addIssue({ code: 'custom', message: 'profile result must link product failures to issue 478' });
    }
  });

const legacyRevisionProofSchema = z
  .object({
    revision: z.enum(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07']),
    fixtureId: safeIdSchema,
    transportProfile: profileSchema,
    testId: safeIdSchema,
    artifactId: safeIdSchema,
    evidenceDigest: sha256Schema,
    attempt: z.literal(1),
  })
  .strict();

const traceSchema = z
  .object({
    requirementId: safeIdSchema,
    sourceRevision: z.enum(['2025-11-25', '2026-07-28', '1mcp-accepted-contracts']),
    strength: z.enum(['normative', 'accepted-contract']),
    role: roleSchema.optional(),
    scenarioId: safeIdSchema.optional(),
    applicability: applicabilitySchema,
    deliveryStage: z.enum(['foundation', 'compatibility']),
    matrixCellIds: z.array(safeIdSchema).min(1),
    peerIds: z.array(safeIdSchema).min(1),
    transportProfiles: z.array(profileSchema).min(1),
    testIds: z.array(safeIdSchema).min(1),
    evidenceArtifactIds: z.array(safeIdSchema).min(1),
    sourceDigest: sha256Schema,
    fixtureDigest: sha256Schema,
  })
  .strict();

const baselineInputSchema = z
  .object({
    mode: z.enum(['baseline', 'gate']),
    sourceSha: sourceShaSchema,
    integrity: z
      .object({ ok: z.boolean(), digest: sha256Schema, source: z.object({ clean: z.boolean() }).strict() })
      .strict(),
    requirementCatalog: z.array(requirementMetadataSchema),
    officialRuns: z.array(officialRunSchema),
    matrixPlan: z.array(matrixAssignmentSchema),
    matrixRuns: z.array(matrixRunSchema),
    profileProofs: z.array(profileProofSchema),
    legacyRevisionProofs: z.array(legacyRevisionProofSchema),
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
    requirementCatalog: z.array(requirementMetadataSchema),
    officialRuns: z.array(officialRunSchema),
    matrixPlan: z.array(matrixAssignmentSchema),
    matrixRuns: z.array(matrixRunSchema),
    profileProofs: z.array(profileProofSchema),
    legacyRevisionProofs: z.array(legacyRevisionProofSchema),
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
  const observedRequirementIds = input.officialRuns.flatMap((run) =>
    run.classification === 'product'
      ? run.scenarios.map((scenario) => `official.${run.revision}.${run.role}.${scenario.scenarioId}`)
      : [],
  );
  if (
    !exactSet(
      input.requirementCatalog.map((requirement) => requirement.requirementId),
      observedRequirementIds,
    )
  ) {
    errors.push('requirement-catalog-mismatch');
  }

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
  if (
    !exactSet(
      input.legacyRevisionProofs.map((proof) => proof.revision),
      ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'],
    )
  ) {
    errors.push('legacy-revision-proof-set-invalid');
  }
  return [...new Set(errors)];
}

function buildTraceability(input: z.infer<typeof baselineInputSchema>): z.infer<typeof traceSchema>[] {
  const metadataById = new Map(input.requirementCatalog.map((requirement) => [requirement.requirementId, requirement]));
  const official = input.officialRuns.flatMap((run) => {
    if (run.classification !== 'product') return [];
    return run.scenarios.flatMap((scenario) => {
      const requirementId = `official.${run.revision}.${run.role}.${scenario.scenarioId}`;
      const metadata = metadataById.get(requirementId);
      if (!metadata) return [];
      return [
        {
          ...metadata,
          testIds:
            scenario.checks.length > 0
              ? scenario.checks.map(
                  (check) => `official.${run.role}.${run.revision}.${scenario.scenarioId}.${check.id}`,
                )
              : [`official.${run.role}.${run.revision}.${scenario.scenarioId}.no-checks-observed`],
          evidenceArtifactIds: [run.artifact.artifactId],
        },
      ];
    });
  });
  const matrix = input.matrixRuns.flatMap((run) => {
    if (run.classification !== 'product') return [];
    const assignment = input.matrixPlan.find((candidate) => candidate.id === run.assignmentId);
    if (!assignment) return [];
    return [
      {
        requirementId: `1mcp.matrix.${run.assignmentId}`,
        sourceRevision: '1mcp-accepted-contracts' as const,
        strength: 'accepted-contract' as const,
        applicability: { status: 'required' as const },
        deliveryStage: 'foundation' as const,
        matrixCellIds: [assignment.cellId],
        peerIds: assignment.peerIds,
        transportProfiles: assignment.profiles,
        testIds: [`matrix.${run.assignmentId}`],
        evidenceArtifactIds: [run.evidence.inbound.artifactId, run.evidence.upstream.artifactId],
        sourceDigest: input.integrity.digest,
        fixtureDigest: input.integrity.digest,
      },
    ];
  });
  const profiles = input.profileProofs.map((proof) => ({
    requirementId: `1mcp.profile.${proof.profile}`,
    sourceRevision: '1mcp-accepted-contracts' as const,
    strength: 'accepted-contract' as const,
    applicability: { status: 'required' as const },
    deliveryStage: 'foundation' as const,
    matrixCellIds: ['profile-evidence'],
    peerIds: ['fixture-profile-suite'],
    transportProfiles: [proof.profile],
    testIds: [proof.testId],
    evidenceArtifactIds: [proof.artifactId],
    sourceDigest: input.integrity.digest,
    fixtureDigest: proof.evidenceDigest,
  }));
  const legacyRevisions = input.legacyRevisionProofs.map((proof) => ({
    requirementId: `1mcp.legacy-revision.${proof.revision}`,
    sourceRevision: '1mcp-accepted-contracts' as const,
    strength: 'accepted-contract' as const,
    applicability: { status: 'required' as const },
    deliveryStage: 'foundation' as const,
    matrixCellIds: ['modern-legacy', 'legacy-modern', 'legacy-legacy'],
    peerIds: [proof.fixtureId],
    transportProfiles: [proof.transportProfile],
    testIds: [proof.testId],
    evidenceArtifactIds: [proof.artifactId],
    sourceDigest: input.integrity.digest,
    fixtureDigest: proof.evidenceDigest,
  }));
  const acceptedContracts = ACCEPTED_CONTRACT_TRACEABILITY_INVENTORY.map((entry) => ({
    requirementId: entry.requirementId,
    sourceRevision: '1mcp-accepted-contracts' as const,
    strength: 'accepted-contract' as const,
    applicability: { status: 'required' as const },
    deliveryStage: 'foundation' as const,
    matrixCellIds: input.matrixPlan.map((assignment) => assignment.cellId),
    peerIds: [...new Set(input.matrixPlan.flatMap((assignment) => assignment.peerIds))],
    transportProfiles: input.requiredProfiles,
    testIds: [...entry.testIds],
    evidenceArtifactIds: [...entry.evidenceArtifactIds],
    sourceDigest: input.integrity.digest,
    fixtureDigest: input.integrity.digest,
  }));
  return [...official, ...matrix, ...profiles, ...legacyRevisions, ...acceptedContracts];
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
    requirementCatalog: [],
    officialRuns: [],
    matrixPlan: [],
    matrixRuns: [],
    profileProofs: [],
    legacyRevisionProofs: [],
    requiredProfiles: [],
    traceability: [],
  });
}

export function buildConformanceBaseline(rawInput: ConformanceBaselineInput): ConformanceBaseline {
  const parsed = baselineInputSchema.safeParse(rawInput);
  if (!parsed.success) return invalidBaseline(rawInput, 'baseline-input-invalid');

  const traceability = buildTraceability(parsed.data);
  const errors = [...infrastructureErrors(parsed.data), ...acceptedContractTraceabilityErrors(traceability)];
  const infrastructureVerdict = errors.length === 0 ? 'green' : 'red';
  const productRed =
    parsed.data.officialRuns.some((run) => run.classification === 'product' && run.productVerdict === 'fail') ||
    parsed.data.matrixRuns.some((run) => run.classification === 'product' && run.productVerdict === 'fail') ||
    parsed.data.profileProofs.some((proof) => proof.status === 'product-failed');
  return finalize({
    schemaVersion: 1,
    mode: parsed.data.mode,
    sourceSha: parsed.data.sourceSha,
    attempt: 1,
    integrityDigest: parsed.data.integrity.digest,
    infrastructureVerdict,
    productVerdict: infrastructureVerdict === 'red' ? 'not-evaluated' : productRed ? 'red' : 'green',
    infrastructureErrorCodes: errors,
    requirementCatalog: parsed.data.requirementCatalog,
    officialRuns: parsed.data.officialRuns,
    matrixPlan: parsed.data.matrixPlan,
    matrixRuns: parsed.data.matrixRuns,
    profileProofs: parsed.data.profileProofs,
    legacyRevisionProofs: parsed.data.legacyRevisionProofs,
    requiredProfiles: parsed.data.requiredProfiles,
    traceability,
  });
}

export function validateConformanceBaseline(input: unknown): ConformanceBaseline {
  const baseline = conformanceBaselineSchema.parse(input);
  const { artifactDigest, ...payload } = baseline;
  if (digest(payload) !== artifactDigest) throw new Error('Conformance baseline artifact digest mismatch');
  const traceInput = baselineInputSchema.parse({
    mode: baseline.mode,
    sourceSha: baseline.sourceSha,
    integrity: { ok: true, digest: baseline.integrityDigest, source: { clean: true } },
    requirementCatalog: baseline.requirementCatalog,
    officialRuns: baseline.officialRuns,
    matrixPlan: baseline.matrixPlan,
    matrixRuns: baseline.matrixRuns,
    profileProofs: baseline.profileProofs,
    legacyRevisionProofs: baseline.legacyRevisionProofs,
    requiredProfiles: baseline.requiredProfiles,
  });
  if (
    JSON.stringify(canonicalize(buildTraceability(traceInput))) !== JSON.stringify(canonicalize(baseline.traceability))
  ) {
    throw new Error('Conformance baseline traceability mismatch');
  }
  const inventoryErrors = acceptedContractTraceabilityErrors(baseline.traceability);
  if (inventoryErrors.length > 0) throw new Error(`Conformance traceability inventory mismatch: ${inventoryErrors[0]}`);
  return baseline;
}

export function conformanceExitCode(mode: 'baseline' | 'gate', baseline: ConformanceBaseline): 0 | 1 {
  if (baseline.infrastructureVerdict === 'red') return 1;
  return mode === 'gate' && baseline.productVerdict !== 'green' ? 1 : 0;
}
