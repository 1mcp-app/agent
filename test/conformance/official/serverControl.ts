import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import {
  type OfficialConformanceResult,
  type OfficialConformanceRevision,
  OfficialEvidenceArtifactSchema,
  officialRequiredScenarioIds,
  officialScenarioIds,
  readOfficialEvidenceArtifact,
  runOfficialConformance,
} from './officialRunner.js';

/** Direct fixture qualification only; it never supplies a gateway verdict. */
export async function runOfficialServerControl(options: {
  packageRoot: string;
  revision: OfficialConformanceRevision;
  endpoint: string;
  outputDirectory: string;
}): Promise<{ qualified: boolean; result: OfficialConformanceResult }> {
  const directory = join(options.outputDirectory, 'official-controls', `server.${options.revision}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let result = await runOfficialConformance({
    packageRoot: options.packageRoot,
    role: 'server',
    revision: options.revision,
    url: options.endpoint,
    temporaryParentDirectory: directory,
  });
  let qualified = false;
  if (result.classification === 'product') {
    try {
      // Verify persisted integrity-checked statuses, including excluded checks, rather than trusting counts or exit text.
      const artifact = await readOfficialEvidenceArtifact(directory, result.artifact);
      qualified = qualifiesControlArtifact(artifact, options.revision);
    } catch {
      result = { classification: 'harness', role: 'server', revision: options.revision, reason: 'artifact-invalid' };
    }
  }
  const report = { target: 'direct-reference-fixture', qualified, result };
  await writeFile(
    join(directory, 'control.json'),
    `${JSON.stringify({ ...report, digest: controlDigest(report) }, null, 2)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  );
  return { qualified, result };
}

function controlDigest(payload: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

function qualifiesControlArtifact(
  artifact: z.infer<typeof OfficialEvidenceArtifactSchema>,
  revision: OfficialConformanceRevision,
): boolean {
  if (artifact.role !== 'server' || artifact.revision !== revision || artifact.productVerdict !== 'pass') return false;
  const expected = officialScenarioIds(revision, 'server');
  if (artifact.scenarios.length !== expected.length) return false;
  if (!expected.every((id, index) => artifact.scenarios[index].scenarioId === id)) return false;
  const required = new Set(officialRequiredScenarioIds(revision, 'server'));
  for (const scenario of artifact.scenarios) {
    if (!required.has(scenario.scenarioId)) continue;
    if (scenario.checks.length === 0) return false;
    if (scenario.checks.some((check) => check.status !== 'SUCCESS')) return false;
  }
  return true;
}

export async function verifyQualifiedOfficialServerControl(
  outputDirectory: string,
  revision: OfficialConformanceRevision,
): Promise<void> {
  const directory = join(outputDirectory, 'official-controls', `server.${revision}`);
  const raw = JSON.parse(await readFile(join(directory, 'control.json'), 'utf8'));
  const parsed = z
    .object({
      target: z.literal('direct-reference-fixture'),
      qualified: z.literal(true),
      result: z
        .object({
          classification: z.literal('product'),
          role: z.literal('server'),
          revision: z.literal(revision),
          artifact: z.object({ artifactId: z.string(), digest: z.string() }).strict(),
        })
        .passthrough(),
      digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    })
    .strict()
    .parse(raw);
  const { digest, ...payload } = raw;
  if (digest !== controlDigest(payload)) throw new Error('official-control-digest-mismatch');
  const artifact = await readOfficialEvidenceArtifact(directory, parsed.result.artifact);
  if (!qualifiesControlArtifact(artifact, revision)) throw new Error('official-control-artifact-invalid');
}

export async function writeOfficialServerComparison(
  outputDirectory: string,
  control: OfficialConformanceResult,
  gateway: OfficialConformanceResult,
): Promise<void> {
  const scenarios = officialRequiredScenarioIds(gateway.revision, 'server').map((scenarioId) => {
    const direct =
      control.classification === 'product' ? control.scenarios.find((s) => s.scenarioId === scenarioId) : undefined;
    const observed =
      gateway.classification === 'product' ? gateway.scenarios.find((s) => s.scenarioId === scenarioId) : undefined;
    return {
      scenarioId,
      directChecks: direct?.checks ?? [],
      gatewayChecks: observed?.checks ?? [],
      missingDirectCheckIds:
        observed?.checks
          .filter((check) => !direct?.checks.some((candidate) => candidate.id === check.id))
          .map((check) => check.id) ?? [],
      missingDirectScenario: !direct,
      missingGatewayScenario: !observed,
    };
  });
  await writeFile(
    join(outputDirectory, 'official-controls', `comparison.server.${gateway.revision}.json`),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        revision: gateway.revision,
        directTarget: 'reference-fixture',
        gatewayTarget: '1mcp',
        gatewayClassification: gateway.classification,
        scenarios,
      },
      null,
      2,
    )}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}
