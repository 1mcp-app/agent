import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { test } from 'node:test';

import { checkSdkImportBoundary, findLegacySdkImports } from '../../scripts/sdk-boundary/import-policy.mjs';
import { formatTopologyDifferences, topologyDifferences } from '../../scripts/sdk-boundary/topology.mjs';

test('allows monolithic v1 imports only inside the legacy island and test code', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '1mcp-sdk-boundary-'));
  try {
    await mkdir(path.join(root, 'src', 'sdk', 'legacy'), { recursive: true });
    await mkdir(path.join(root, 'src', 'application'), { recursive: true });
    const source = "import { Client } from '@modelcontextprotocol/sdk/client/index.js';\n";
    await writeFile(path.join(root, 'src', 'sdk', 'legacy', 'client.ts'), source);
    await writeFile(path.join(root, 'src', 'application', 'client.test.ts'), source);
    await writeFile(path.join(root, 'src', 'application', 'client.ts'), source);

    assert.deepEqual(await checkSdkImportBoundary(root), [
      {
        file: 'src/application/client.ts',
        line: 1,
        column: 1,
        kind: 'static import',
        specifier: '@modelcontextprotocol/sdk/client/index.js',
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detects every supported monolithic v1 import form outside the legacy island', () => {
  const cases = [
    ["import { Client } from '@modelcontextprotocol/sdk/client/index.js';", 'static import'],
    ["import type { Tool } from '@modelcontextprotocol/sdk/types.js';", 'type-only import'],
    ["export { Server } from '@modelcontextprotocol/sdk/server/index.js';", 'export-from'],
    ["export type { Tool } from '@modelcontextprotocol/sdk/types.js';", 'type-only export'],
    ["const sdk = await import('@modelcontextprotocol/sdk/client/index.js');", 'dynamic import'],
    ["const sdk = require('@modelcontextprotocol/sdk/client/index.js');", 'commonjs require'],
    [
      "const legacyRequire = createRequire(import.meta.url); legacyRequire('@modelcontextprotocol/sdk/types.js');",
      'runtime loader call',
    ],
    ["type Tool = import('@modelcontextprotocol/sdk/types.js').Tool;", 'import type expression'],
  ];

  for (const [source, kind] of cases) {
    const violations = findLegacySdkImports(source, 'src/application/example.ts');
    assert.equal(violations.length, 1, source);
    assert.equal(violations[0].kind, kind, source);
  }
});

test('scans TypeScript module variants used by the production build', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '1mcp-sdk-boundary-modules-'));
  try {
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'src', 'violation.cts'),
      "require('@modelcontextprotocol/sdk/client/index.js');\n",
    );
    await writeFile(
      path.join(root, 'src', 'violation.mts'),
      "import type { Tool } from '@modelcontextprotocol/sdk/types.js';\n",
    );

    const violations = await checkSdkImportBoundary(root);
    assert.equal(violations.length, 2);
    assert.deepEqual(
      violations.map(({ file, kind }) => ({ file, kind })),
      [
        { file: 'src/violation.cts', kind: 'commonjs require' },
        { file: 'src/violation.mts', kind: 'type-only import' },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ignores v2 package imports', () => {
  const source =
    "import { Client } from '@modelcontextprotocol/client';\nexport * from '@modelcontextprotocol/core';\n";
  assert.deepEqual(findLegacySdkImports(source, 'src/application/example.ts'), []);
});

test('rejects shared imports from the internal legacy island', () => {
  const source = "import type { Tool } from '@src/sdk/legacy/types.js';\n";
  const violations = findLegacySdkImports(source, 'src/application/example.ts');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'type-only import');
});

test('rejects dynamic imports from the internal legacy island', () => {
  const source = "const legacy = await import('@src/sdk/legacy/client/index.js');\n";
  const violations = findLegacySdkImports(source, 'src/application/example.ts');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'dynamic import');
});

test('rejects runtime loaders for the internal legacy island', () => {
  const cases = [
    ["const legacy = require('@src/sdk/legacy/types.js');", 'commonjs require'],
    [
      "const legacyRequire = createRequire(import.meta.url); legacyRequire('@src/sdk/legacy/types.js');",
      'runtime loader call',
    ],
  ];

  for (const [source, kind] of cases) {
    const violations = findLegacySdkImports(source, 'src/application/example.ts');
    assert.equal(violations.length, 1, source);
    assert.equal(violations[0].kind, kind, source);
  }
});

test('allows pure compatibility shims for the internal legacy island', () => {
  const source = [
    "export * from '@src/sdk/legacy/server/runtime/serverManager.js';",
    "export type { ConnectedClient } from '@src/sdk/legacy/client/runtime/connectedClient.js';",
  ].join('\n');
  assert.deepEqual(findLegacySdkImports(source, 'src/core/server/serverManager.ts'), []);
});

test('rejects compatibility shims that contain executable code', () => {
  const source = [
    "export * from '@src/sdk/legacy/server/runtime/serverManager.js';",
    'initializeRuntime();',
  ].join('\n');
  const violations = findLegacySdkImports(source, 'src/core/server/serverManager.ts');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].kind, 'export-from');
});

test('topology diffs name the exact expected and actual values', () => {
  const differences = topologyDifferences({ root: { zod: '4.4.3' } }, { root: { zod: '4.5.0' } });
  assert.deepEqual(differences, [{ path: '$.root.zod', expected: '4.4.3', actual: '4.5.0' }]);
  assert.equal(formatTopologyDifferences(differences), '$.root.zod\n  expected: "4.4.3"\n  actual:   "4.5.0"');
});
