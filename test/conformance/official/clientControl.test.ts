import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const cli = join(root, 'node_modules/@modelcontextprotocol/conformance/dist/index.js');
const control = join(root, 'test/conformance/official/fixtures/client-control.mjs');

function checkFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? checkFiles(path) : entry.name === 'checks.json' ? [path] : [];
  });
}

describe('pinned official direct client controls', () => {
  for (const [scenario, revision, count] of [
    ['auth/metadata-default', '2025-11-25', 15],
    ['elicitation-sep1034-client-defaults', '2025-11-25', 5],
    ['sep-2322-client-request-state', '2026-07-28', 5],
  ] as const) {
    it(`executes ${scenario} with a valid direct stimulus`, () => {
      const output = mkdtempSync(join(tmpdir(), '1mcp-client-control-'));
      try {
        const child = spawnSync(
          process.execPath,
          [
            cli,
            'client',
            '--scenario',
            scenario,
            '--spec-version',
            revision,
            '--command',
            `${process.execPath} ${control}`,
            '--output-dir',
            output,
          ],
          {
            cwd: root,
            timeout: 20_000,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
          },
        );
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
        const paths = checkFiles(output);
        expect(paths).toHaveLength(1);
        const checks = JSON.parse(readFileSync(paths[0], 'utf8')).filter(
          (check: { status: string }) => check.status !== 'INFO',
        );
        expect(checks).toHaveLength(count);
        expect(checks.every((check: { status: string }) => check.status === 'SUCCESS')).toBe(true);
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    });
  }
  for (const [scenario, revision] of [
    ['elicitation-sep1034-client-defaults', '2025-11-25'],
    ['sep-2322-client-request-state', '2026-07-28'],
  ] as const) {
    it(`qualifies the repaired official TypeScript fixture for ${scenario}`, () => {
      const output = mkdtempSync(join(tmpdir(), '1mcp-client-fixture-'));
      try {
        const fixture = join(root, 'test/conformance/fixtures/typescript/src/fixture.mjs');
        const child = spawnSync(
          process.execPath,
          [
            cli,
            'client',
            '--scenario',
            scenario,
            '--spec-version',
            revision,
            '--command',
            `${process.execPath} ${fixture}`,
            '--output-dir',
            output,
          ],
          {
            cwd: root,
            timeout: 20_000,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
          },
        );
        expect(child.error).toBeUndefined();
        expect(child.status).toBe(0);
        const paths = checkFiles(output);
        expect(paths).toHaveLength(1);
        const checks = JSON.parse(readFileSync(paths[0], 'utf8')).filter(
          (check: { status: string }) => check.status !== 'INFO',
        );
        expect(checks).toHaveLength(5);
        expect(checks.every((check: { status: string }) => check.status === 'SUCCESS')).toBe(true);
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    });
  }
});
