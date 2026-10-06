import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OfficialConformanceResult, officialScenarioIds, runOfficialConformance } from './officialRunner.js';
import { runOfficialServerControl, verifyQualifiedOfficialServerControl } from './serverControl.js';

vi.mock('./officialRunner.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./officialRunner.js')>()),
  runOfficialConformance: vi.fn(),
}));

const directories: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function setup(mutate?: (payload: ReturnType<typeof artifactPayload>) => void) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'official-control-test-'));
  directories.push(outputDirectory);
  const payload = artifactPayload();
  mutate?.(payload);
  const digest = `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}` as const;
  const artifact = { artifactId: 'official-evidence/server.2025-11-25.json', digest };
  const directory = join(outputDirectory, 'official-controls/server.2025-11-25/official-evidence');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'server.2025-11-25.json'), JSON.stringify({ ...payload, digest }));
  vi.mocked(runOfficialConformance).mockResolvedValue({ classification: 'product', ...payload, artifact });
  return {
    outputDirectory,
    directory,
    options: {
      packageRoot: '/unused',
      revision: '2025-11-25' as const,
      endpoint: 'http://127.0.0.1:1234/mcp',
      outputDirectory,
    },
  };
}

function artifactPayload() {
  return {
    schemaVersion: 1 as const,
    role: 'server' as const,
    revision: '2025-11-25' as const,
    productVerdict: 'pass' as const,
    scenarios: officialScenarioIds('2025-11-25', 'server').map((scenarioId) => ({
      scenarioId,
      checks: [
        { id: 'wire-schema-valid', status: 'SUCCESS' as 'SUCCESS' | 'FAILURE', specReferenceIds: ['MCP-Schema'] },
      ],
    })),
    counts: { SUCCESS: 33, FAILURE: 0, WARNING: 0, SKIPPED: 0, total: 33 },
  };
}

describe('official server direct control qualification', () => {
  it('qualifies only the signed complete control artifact and persists its separate target identity', async () => {
    const { options } = await setup();
    expect((await runOfficialServerControl(options)).qualified).toBe(true);
    await verifyQualifiedOfficialServerControl(options.outputDirectory, options.revision);
    expect(runOfficialConformance).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'server', url: options.endpoint }),
    );
  });

  it('rejects a modified control report on foundation readback', async () => {
    const { options } = await setup();
    await runOfficialServerControl(options);
    const path = join(options.outputDirectory, 'official-controls/server.2025-11-25/control.json');
    await writeFile(path, '{}');
    await expect(verifyQualifiedOfficialServerControl(options.outputDirectory, options.revision)).rejects.toThrow();
  });

  it.each(['missing-scenario', 'empty-checks', 'failed-check'] as const)(
    'fails closed on %s even with a reported passing verdict/counts',
    async (defect) => {
      const { options } = await setup((payload) => {
        if (defect === 'missing-scenario') payload.scenarios.pop();
        if (defect === 'empty-checks') payload.scenarios[0].checks = [];
        if (defect === 'failed-check') payload.scenarios[0].checks[0].status = 'FAILURE';
      });
      expect((await runOfficialServerControl(options)).qualified).toBe(false);
    },
  );

  it('rejects a changed or missing signed artifact', async () => {
    const { options, directory } = await setup();
    await writeFile(join(directory, 'server.2025-11-25.json'), '{}');
    expect(await runOfficialServerControl(options)).toMatchObject({
      qualified: false,
      result: { classification: 'harness', reason: 'artifact-invalid' },
    });
    await rm(directory, { recursive: true });
    expect(await runOfficialServerControl(options)).toMatchObject({
      qualified: false,
      result: { classification: 'harness', reason: 'artifact-invalid' },
    });
  });

  it.each([
    { classification: 'process', role: 'server', revision: '2025-11-25', reason: 'nonzero-exit' },
    { classification: 'harness', role: 'server', revision: '2025-11-25', reason: 'missing-output' },
  ] satisfies OfficialConformanceResult[])(
    'preserves infrastructure failure $reason without qualification',
    async (result) => {
      const { options } = await setup();
      vi.mocked(runOfficialConformance).mockResolvedValue(result);
      expect(await runOfficialServerControl(options)).toEqual({ qualified: false, result });
    },
  );
});
