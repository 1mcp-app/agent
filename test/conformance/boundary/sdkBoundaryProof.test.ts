import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateSdkBoundaryProof, readSdkBoundaryProof } from './sdkBoundaryProof.js';

describe('SDK boundary accepted-contract proof', () => {
  let outputDirectory: string;

  beforeEach(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'sdk-boundary-proof-'));
  });

  afterEach(async () => {
    await rm(outputDirectory, { recursive: true, force: true });
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
