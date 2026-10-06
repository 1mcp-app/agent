import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    it(`records the selected SDK fixture outcome for ${scenario}`, () => {
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
        // The selected SDK2.0 modern codec rejects the pinned peer's final
        // absent-resultType response before result-schema validation. All peer
        // checks being green must not turn that SDK rejection into qualification.
        expect(child.status).toBe(scenario === 'sep-2322-client-request-state' ? 1 : 0);
        const paths = checkFiles(output);
        expect(paths).toHaveLength(1);
        const checks = JSON.parse(readFileSync(paths[0], 'utf8')).filter(
          (check: { status: string }) => check.status !== 'INFO',
        );
        expect(checks).toHaveLength(5);
        expect(checks.every((check: { status: string }) => check.status === 'SUCCESS')).toBe(true);
        if (scenario === 'sep-2322-client-request-state') {
          expect(JSON.parse(readFileSync(join(dirname(paths[0]), 'stderr.txt'), 'utf8'))).toEqual({
            kind: 'conformance-client',
            ok: false,
            classification: 'fixture-sdk-rejected',
            reasonCode: 'missing-result-type',
          });
        }
      } finally {
        rmSync(output, { recursive: true, force: true });
      }
    });
  }

  it('classifies a non-JSON HTTP failure before parsing its body', async () => {
    const server = createServer((_req, res) => res.writeHead(503).end('non-json failure'));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('control-listen-failed');
      const module = await import(pathToFileURL(control).href);
      await expect(module.runRequestStateControl(`http://127.0.0.1:${address.port}/mcp`)).rejects.toThrow(
        'CONTROL_RPC_REJECTED',
      );
    } finally {
      await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
    }
  });
});
