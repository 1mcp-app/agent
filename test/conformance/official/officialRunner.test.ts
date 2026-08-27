import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  OFFICIAL_REQUIREMENT_DIGESTS,
  readOfficialEvidenceArtifact,
  runOfficialConformance,
  verifyOfficialConformancePackage,
} from './officialRunner.js';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const require = createRequire(import.meta.url);
const temporaryDirectories: string[] = [];
let fixturePackageRoot: string;
let temporaryParent: string;

function installedPackageRoot(): string {
  const explicitRoot = process.env.MCP_CONFORMANCE_TEST_PACKAGE_ROOT;
  if (explicitRoot) return explicitRoot;
  return dirname(require.resolve('@modelcontextprotocol/conformance/package.json'));
}

beforeEach(async () => {
  temporaryParent = await mkdtemp(join(tmpdir(), 'official-runner-test-'));
  temporaryDirectories.push(temporaryParent);
  fixturePackageRoot = join(temporaryParent, 'package');
  await cp(installedPackageRoot(), fixturePackageRoot, { recursive: true });
  await cp(join(fixtureDirectory, 'fake-conformance-cli.mjs'), join(fixturePackageRoot, 'dist', 'index.js'));
});

afterEach(async () => {
  delete process.env.OFFICIAL_RUNNER_PARENT_SECRET;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('verifyOfficialConformancePackage', () => {
  it('verifies the exact package and both frozen requirement digests', async () => {
    const verified = await verifyOfficialConformancePackage(fixturePackageRoot);

    expect(verified).toEqual({
      name: '@modelcontextprotocol/conformance',
      version: '0.2.0-alpha.11',
      requirementDigests: OFFICIAL_REQUIREMENT_DIGESTS,
    });
  });

  it('rejects a modified frozen requirement file', async () => {
    const requirementPath = join(fixturePackageRoot, 'requirements', '2025-11-25.yaml');
    await writeFile(requirementPath, `${await readFile(requirementPath, 'utf8')}\n# modified\n`);

    await expect(verifyOfficialConformancePackage(fixturePackageRoot)).rejects.toMatchObject({
      name: 'OfficialConformanceFixtureError',
      code: 'requirement-integrity',
    });
  });
});

describe('runOfficialConformance', () => {
  it('runs a server requirement set once and returns only sanitized structured observations', async () => {
    process.env.OFFICIAL_RUNNER_PARENT_SECRET = 'parent-secret';

    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2025-11-25',
      url: 'http://127.0.0.1:3050/mcp',
      temporaryParentDirectory: temporaryParent,
    });

    expect(result.classification).toBe('product');
    if (result.classification !== 'product') return;

    expect(result.productVerdict).toBe('pass');
    expect(result.role).toBe('server');
    expect(result.revision).toBe('2025-11-25');
    expect(result.counts.FAILURE).toBe(0);
    expect(result.counts.WARNING).toBe(0);
    expect(result.counts.SUCCESS).toBeGreaterThan(result.scenarios.length);
    expect(result.scenarios[0].checks.filter((check) => check.id === 'official-check')).toHaveLength(2);
    expect(result.scenarios[0].checks[0]).toEqual({
      id: 'official-check',
      status: 'SUCCESS',
      specReferenceIds: ['MCP-Lifecycle'],
    });
    const artifact = await readOfficialEvidenceArtifact(temporaryParent, result.artifact);
    expect(artifact).toMatchObject({
      role: 'server',
      revision: '2025-11-25',
      productVerdict: 'pass',
      digest: result.artifact.digest,
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|stdout|stderr|Users|timestamp|description|errorMessage|details/);
    expect(await readdir(temporaryParent)).toEqual(['official-evidence', 'package']);
  });

  it('rejects a retained official artifact after its sanitized contents are changed', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2025-11-25',
      url: 'http://127.0.0.1:3050/mcp',
      temporaryParentDirectory: temporaryParent,
    });
    expect(result.classification).toBe('product');
    if (result.classification !== 'product') return;

    const artifactPath = join(temporaryParent, result.artifact.artifactId);
    const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Record<string, unknown>;
    artifact.productVerdict = 'fail';
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`);

    await expect(readOfficialEvidenceArtifact(temporaryParent, result.artifact)).rejects.toThrow(
      'Official evidence artifact digest mismatch',
    );
  });

  it('preserves first-attempt warnings as a red client product verdict', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'client',
      revision: '2025-11-25',
      command: `${process.execPath} client-fixture.mjs`,
      temporaryParentDirectory: temporaryParent,
    });

    expect(result.classification).toBe('product');
    if (result.classification !== 'product') return;
    expect(result.productVerdict).toBe('fail');
    expect(result.counts.WARNING).toBe(1);
    expect(result.scenarios.some((scenario) => scenario.scenarioId.startsWith('auth/'))).toBe(true);
  });

  it.each([
    ['zero-no-output', 'missing-output'],
    ['malformed-output', 'artifact-invalid'],
  ] as const)('classifies %s as a harness failure without outcomes', async (path, reason) => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2026-07-28',
      url: `http://127.0.0.1:3050/${path}`,
      temporaryParentDirectory: temporaryParent,
    });

    expect(result).toEqual({
      classification: 'harness',
      role: 'server',
      revision: '2026-07-28',
      reason,
    });
  });

  it('continues after a nonzero product scenario and preserves later first-attempt reports', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2026-07-28',
      url: 'http://127.0.0.1:3050/continue-after-nonzero',
      temporaryParentDirectory: temporaryParent,
    });

    expect(result.classification).toBe('product');
    if (result.classification !== 'product') return;
    expect(result.productVerdict).toBe('fail');
    expect(result.scenarios.length).toBeGreaterThan(1);
    expect(result.scenarios[0].checks.some((check) => check.status === 'FAILURE')).toBe(true);
    expect(result.scenarios.at(-1)?.checks.length).toBeGreaterThan(0);
  });

  it('keeps a nonzero scenario with no report and no target traffic as process infrastructure', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2026-07-28',
      url: 'http://127.0.0.1:3050/nonzero-no-output',
      temporaryParentDirectory: temporaryParent,
    });

    expect(result).toEqual({
      classification: 'process',
      role: 'server',
      revision: '2026-07-28',
      reason: 'nonzero-exit',
    });
  });

  it('retains only the reviewed schema-invalid target fallback for Tasks capability negotiation', async () => {
    const observedPaths: string[] = [];
    let schemaValid = false;
    const target = createServer((request, response) => {
      observedPaths.push(request.url ?? '');
      request.resume();
      request.once('end', () => {
        response.writeHead(200, { 'content-type': 'application/json', 'x-private': 'private-header' });
        response.end(
          JSON.stringify({
            ...(schemaValid ? { jsonrpc: '2.0', id: 1 } : {}),
            error: { code: -32601, message: 'private target status text' },
          }),
        );
      });
    });
    await new Promise<void>((resolvePromise) => target.listen(0, '127.0.0.1', resolvePromise));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('Target did not bind');
    try {
      const result = await runOfficialConformance({
        packageRoot: fixturePackageRoot,
        role: 'server',
        revision: '2026-07-28',
        url: `http://127.0.0.1:${address.port}/target-error-no-output-tasks-capability-negotiation?case=preserved`,
        temporaryParentDirectory: temporaryParent,
      });

      expect(result.classification).toBe('product');
      if (result.classification !== 'product') return;
      expect(result.productVerdict).toBe('pass');
      const fallback = result.scenarios.find((scenario) => scenario.scenarioId === 'tasks-capability-negotiation');
      expect(fallback?.checks).toEqual([
        { id: 'official-target-schema-invalid', status: 'FAILURE', specReferenceIds: [] },
      ]);
      expect(result.scenarios.at(-1)?.checks.length).toBeGreaterThan(0);
      expect(observedPaths[0]).toBe('/target-error-no-output-tasks-capability-negotiation?case=preserved');
      const serialized = JSON.stringify(fallback);
      expect(serialized).not.toMatch(/stdout|stderr|detail|private target|private-header/iu);

      schemaValid = true;
      await expect(
        runOfficialConformance({
          packageRoot: fixturePackageRoot,
          role: 'server',
          revision: '2026-07-28',
          url: `http://127.0.0.1:${address.port}/target-error-no-output-tasks-capability-negotiation?case=valid-error`,
          temporaryParentDirectory: temporaryParent,
        }),
      ).resolves.toEqual({
        classification: 'process',
        role: 'server',
        revision: '2026-07-28',
        reason: 'nonzero-exit',
      });
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        target.close((error) => (error ? reject(error) : resolvePromise())),
      );
    }
  });

  it('keeps an expected tools-call-error response with no report as process infrastructure', async () => {
    const target = createServer((request, response) => {
      request.resume();
      request.once('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'expected' } }));
      });
    });
    await new Promise<void>((resolvePromise) => target.listen(0, '127.0.0.1', resolvePromise));
    const address = target.address();
    if (!address || typeof address === 'string') throw new Error('Target did not bind');
    try {
      const result = await runOfficialConformance({
        packageRoot: fixturePackageRoot,
        role: 'server',
        revision: '2025-11-25',
        url: `http://127.0.0.1:${address.port}/target-error-no-output-tools-call-error`,
        temporaryParentDirectory: temporaryParent,
      });

      expect(result).toEqual({
        classification: 'process',
        role: 'server',
        revision: '2025-11-25',
        reason: 'nonzero-exit',
      });
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        target.close((error) => (error ? reject(error) : resolvePromise())),
      );
    }
  });

  it('keeps client-role nonzero missing output as process infrastructure', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'client',
      revision: '2026-07-28',
      command: 'nonzero-no-output',
      temporaryParentDirectory: temporaryParent,
    });

    expect(result).toEqual({
      classification: 'process',
      role: 'client',
      revision: '2026-07-28',
      reason: 'nonzero-exit',
    });
  });

  it('honors cancellation without starting a run and still removes the owned workspace', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2025-11-25',
      url: 'http://127.0.0.1:3050/mcp',
      temporaryParentDirectory: temporaryParent,
      signal: controller.signal,
    });

    expect(result).toEqual({
      classification: 'process',
      role: 'server',
      revision: '2025-11-25',
      reason: 'aborted',
    });
    expect(await readdir(temporaryParent)).toEqual(['package']);
  });

  it('terminates the owned process group on timeout and removes its workspace', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2025-11-25',
      url: 'http://127.0.0.1:3050/hang',
      temporaryParentDirectory: temporaryParent,
      timeoutMs: 50,
    });

    expect(result).toEqual({
      classification: 'process',
      role: 'server',
      revision: '2025-11-25',
      reason: 'timeout',
    });
    expect(await readdir(temporaryParent)).toEqual(['package']);
  });

  it('rejects non-loopback server targets as fixture failures', async () => {
    const result = await runOfficialConformance({
      packageRoot: fixturePackageRoot,
      role: 'server',
      revision: '2025-11-25',
      url: 'https://example.com/mcp',
      temporaryParentDirectory: temporaryParent,
    });

    expect(result).toEqual({
      classification: 'fixture',
      role: 'server',
      revision: '2025-11-25',
      reason: 'invalid-target',
    });
  });
});
