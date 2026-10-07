import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { digest, ORIGINAL_TOOLKIT_DIGEST, prepareToolkitRepairs, repairToolkit } from './fixtureRepairs.mjs';

const packageRoot = dirname(createRequire(import.meta.url).resolve('@modelcontextprotocol/conformance/package.json'));

describe('owned official toolkit fixture repairs', () => {
  it('binds repairs to the exact published distribution and refuses drift', async () => {
    const original = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
    expect(digest(original)).toBe(ORIGINAL_TOOLKIT_DIGEST);
    expect(() => repairToolkit(original + '\n')).toThrow('source mismatch');
    const repaired = repairToolkit(original);
    expect(() => repairToolkit(repaired.source)).toThrow('source mismatch');
    expect(await readFile(join(packageRoot, 'dist/index.js'), 'utf8')).toBe(original);
  });

  it('retains a sealed repair receipt and refuses a tampered generated executable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'toolkit-repairs-'));
    try {
      await mkdir(join(directory, 'dist'));
      const original = await readFile(join(packageRoot, 'dist/index.js'));
      await writeFile(join(directory, 'dist/index.js'), original);
      const entry = await prepareToolkitRepairs(directory, directory);
      const { digest: receiptDigest, ...receipt } = JSON.parse(
        await readFile(join(directory, 'official-toolkit-repairs.json'), 'utf8'),
      );
      expect(receiptDigest).toBe(digest(JSON.stringify(receipt)));
      expect(receipt.repairedDigest).toBe(digest(await readFile(entry)));
      expect(await readFile(join(directory, 'dist/index.js'))).toEqual(original);
      await writeFile(entry, 'tampered');
      await expect(prepareToolkitRepairs(directory, directory)).rejects.toThrow('artifact mismatch');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('supplies explicit modern completion, schema-valid omission, and independently owned issuer context', async () => {
    const original = await readFile(join(packageRoot, 'dist/index.js'), 'utf8');
    const { source, repairs } = repairToolkit(original);
    expect(source).toContain(
      'result:{resultType:`complete`,content:[{type:`text`,text:`explicit-result-type-test-ok`}]}',
    );
    expect(source).not.toContain('priority:1,verbose:null,query:`SELECT 1`');
    expect(source).toContain('priority:1,query:`SELECT 1`');
    expect(source).toContain('ownedOAuthIssuer:c()');
    expect(source).toContain('ownedOAuthIssuer:this.authServer?.getUrl()??this.as1?.getUrl()');
    expect(source).toContain('ownedOAuthReject:!!this.allowClientError');
    expect(repairs.map((repair) => repair.id)).toEqual([
      'modern-complete-result',
      'modern-complete-check-id',
      'modern-complete-check-name',
      'modern-complete-check-description',
      'modern-complete-check-error',
      'schema-valid-omission',
      'metadata-owned-issuer',
      'scenario-owned-issuer',
      'credential-scenario-owned-issuer',
    ]);
  });
});
