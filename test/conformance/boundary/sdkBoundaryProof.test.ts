import { copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { generateSdkBoundaryProof, readSdkBoundaryProof } from './sdkBoundaryProof.js';

describe('SDK boundary accepted-contract proof', () => {
  let outputDirectory: string;
  const fixtureRoots: string[] = [];

  async function createTopologyRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'sdk-boundary-topology-'));
    fixtureRoots.push(root);
    await mkdir(join(root, 'test/sdk-boundary'), { recursive: true });
    await Promise.all([
      copyFile(join(process.cwd(), 'package.json'), join(root, 'package.json')),
      copyFile(join(process.cwd(), 'pnpm-lock.yaml'), join(root, 'pnpm-lock.yaml')),
      copyFile(
        join(process.cwd(), 'test/sdk-boundary/sdk-topology.snapshot.json'),
        join(root, 'test/sdk-boundary/sdk-topology.snapshot.json'),
      ),
    ]);
    return root;
  }

  beforeEach(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'sdk-boundary-proof-'));
  });

  afterEach(async () => {
    await rm(outputDirectory, { recursive: true, force: true });
    await Promise.all(fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('generates a digest-checked proof with actual v1 and v2 SDK objects', async () => {
    const reference = await generateSdkBoundaryProof(process.cwd(), outputDirectory);
    expect(reference).toMatchObject({ classification: 'product', productVerdict: 'pass', attempt: 1 });
    if (reference.classification !== 'product') throw new Error('Expected product proof');

    const artifact = JSON.parse(await readFile(join(outputDirectory, reference.artifactId), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      classification: 'product',
      productVerdict: 'pass',
      attempt: 1,
    });
    expect(Object.keys(artifact).sort()).toEqual([
      'attempt',
      'checks',
      'classification',
      'evidenceDigest',
      'packageIdentities',
      'productVerdict',
      'schemaVersion',
      'topologyDigest',
    ]);
    expect(JSON.stringify(artifact)).not.toContain('boundary-proof');
    expect(await readSdkBoundaryProof(outputDirectory, reference)).toEqual(reference);
  });

  it('classifies a proof fixture crash as infrastructure evidence', async () => {
    await expect(generateSdkBoundaryProof('/nonexistent-sdk-boundary-root', outputDirectory)).resolves.toEqual({
      classification: 'fixture',
      reason: 'fixture-crash',
      attempt: 1,
    });
  });

  it.each([
    [
      'manifest',
      async (root: string) => {
        const path = join(root, 'package.json');
        const manifest = JSON.parse(await readFile(path, 'utf8')) as {
          dependencies: Record<string, string>;
        };
        manifest.dependencies['@modelcontextprotocol/sdk'] = '1.29.0';
        await writeFile(path, JSON.stringify(manifest));
      },
    ],
    [
      'lockfile',
      async (root: string) => {
        const path = join(root, 'pnpm-lock.yaml');
        const lock = parseYaml(await readFile(path, 'utf8')) as {
          importers: { '.': { dependencies: Record<string, { specifier: string }> } };
        };
        lock.importers['.'].dependencies['@modelcontextprotocol/sdk']!.specifier = '1.29.0';
        await writeFile(path, stringifyYaml(lock));
      },
    ],
    [
      'snapshot',
      async (root: string) => {
        const path = join(root, 'test/sdk-boundary/sdk-topology.snapshot.json');
        const snapshot = JSON.parse(await readFile(path, 'utf8')) as {
          rootPackages: Record<string, { resolved: string }>;
        };
        snapshot.rootPackages['@modelcontextprotocol/sdk']!.resolved = '1.29.0';
        await writeFile(path, JSON.stringify(snapshot));
      },
    ],
  ])('records stale %s topology as product-failed evidence', async (_name, mutate) => {
    const root = await createTopologyRoot();
    await mutate(root);

    const reference = await generateSdkBoundaryProof(root, outputDirectory);
    expect(reference).toMatchObject({ classification: 'product', productVerdict: 'fail' });
    if (reference.classification !== 'product') throw new Error('Expected product proof');
    const artifact = JSON.parse(await readFile(join(outputDirectory, reference.artifactId), 'utf8')) as {
      checks: { id: string; status: string }[];
    };
    expect(artifact.checks).toContainEqual({ id: 'sdk-boundary.topology-matches-snapshot', status: 'failed' });
    await expect(readSdkBoundaryProof(outputDirectory, reference)).resolves.toEqual(reference);
  });

  it.each([
    ['missing lockfile', async (root: string) => unlink(join(root, 'pnpm-lock.yaml'))],
    [
      'malformed snapshot',
      async (root: string) => writeFile(join(root, 'test/sdk-boundary/sdk-topology.snapshot.json'), '{'),
    ],
  ])('classifies %s machinery as infrastructure evidence', async (_name, mutate) => {
    const root = await createTopologyRoot();
    await mutate(root);

    await expect(generateSdkBoundaryProof(root, outputDirectory)).resolves.toEqual({
      classification: 'fixture',
      reason: 'fixture-crash',
      attempt: 1,
    });
  });

  it.each([
    ['missing', async (path: string) => unlink(path), 'proof-missing'],
    ['malformed', async (path: string) => writeFile(path, '{'), 'proof-malformed'],
    [
      'digest mismatch',
      async (path: string) => {
        const artifact = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
        artifact.topologyDigest = `sha256:${'0'.repeat(64)}`;
        await writeFile(path, JSON.stringify(artifact));
      },
      'proof-digest-mismatch',
    ],
  ])('classifies a %s artifact as infrastructure evidence', async (_name, mutate, reason) => {
    const reference = await generateSdkBoundaryProof(process.cwd(), outputDirectory);
    if (reference.classification !== 'product') throw new Error('Expected product proof');
    const artifactPath = join(outputDirectory, reference.artifactId);
    await mutate(artifactPath);

    await expect(readSdkBoundaryProof(outputDirectory, reference)).resolves.toMatchObject({
      classification: 'harness',
      reason,
    });
  });
});
