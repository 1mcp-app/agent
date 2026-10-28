import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { runMatrix, runRetainedRevisionProbes } from './foundationRun.js';

it('supports all modern/legacy gateway combinations with TypeScript and Python peers', async () => {
  const { plan, results } = await runMatrix(process.cwd());
  expect(plan).toHaveLength(12);
  expect(results).toHaveLength(plan.length);
  for (const result of results) {
    expect(result, result.assignmentId).toMatchObject({ kind: 'product', status: 'pass' });
  }
}, 240_000);

it('preserves negotiation for retained legacy revisions', async () => {
  const scratch = await mkdtemp(join(tmpdir(), '1mcp-protocol-revisions-'));
  try {
    expect(await runRetainedRevisionProbes(process.cwd(), scratch)).toEqual([
      '2025-11-25',
      '2025-06-18',
      '2025-03-26',
      '2024-11-05',
      '2024-10-07',
    ]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
