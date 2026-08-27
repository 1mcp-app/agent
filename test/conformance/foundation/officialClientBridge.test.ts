import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { officialClientScenarioIds } from '../official/officialRunner.js';
import { OFFICIAL_CLIENT_SCENARIOS, officialClientScenarioFamily } from './officialClientScenarioCatalog.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bridge = join(here, 'officialClientBridge.mjs');
const fakeGateway = resolve(here, '../runtime/fixtures/fake-process.mjs');

describe('official client gateway bridge', () => {
  it.each([
    ['fixture-crash', 'fixture-defect'],
    ['gateway-rejected', 'attempted'],
  ] as const)('records %s client execution as %s', async (mode, expectedStatus) => {
    const scratch = await mkdtemp(join(tmpdir(), 'official-client-bridge-'));
    const fixture = join(scratch, 'fixture.mjs');
    await writeFile(
      fixture,
      mode === 'fixture-crash'
        ? `process.stderr.write('{"code":"FIXTURE_RUNTIME_ERROR"}\\n'); process.exitCode = 1;\n`
        : `process.stderr.write('{"classification":"gateway-rejected"}\\n'); process.exitCode = 1;\n`,
      'utf8',
    );
    try {
      await expect(
        execFileAsync(process.execPath, [bridge, fixture, fakeGateway, scratch, 'http://localhost:9/mcp'], {
          env: {
            ...process.env,
            MCP_CONFORMANCE_SCENARIO: 'tools_call',
            MCP_CONFORMANCE_PROTOCOL_VERSION: '2025-11-25',
          },
          timeout: 15_000,
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(join(scratch, 'tools_call.json'), 'utf8')).resolves.toContain(
        `"status":"${expectedStatus}"`,
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each([
    ['auth/metadata-default', '2025-11-25', undefined],
    ['http-standard-headers', '2026-07-28', undefined],
    ['json-schema-ref-no-deref', '2026-07-28', undefined],
    [
      'http-custom-headers',
      '2026-07-28',
      { toolCalls: [{ name: 'test_custom_headers', arguments: { region: 'us-west1' } }] },
    ],
  ] as const)('dispatches canonical %s through the gateway for %s', async (scenario, revision, context) => {
    const scratch = await mkdtemp(join(tmpdir(), 'official-client-bridge-'));
    const fixture = join(scratch, 'fixture.mjs');
    await writeFile(
      fixture,
      `process.stderr.write('{"classification":"gateway-rejected"}\\n'); process.exitCode = 1;\n`,
      'utf8',
    );
    try {
      await expect(
        execFileAsync(process.execPath, [bridge, fixture, fakeGateway, scratch, 'http://127.0.0.1:9/mcp'], {
          env: {
            ...process.env,
            MCP_CONFORMANCE_SCENARIO: scenario,
            MCP_CONFORMANCE_PROTOCOL_VERSION: revision,
            ...(context ? { MCP_CONFORMANCE_CONTEXT: JSON.stringify(context) } : {}),
          },
          timeout: 15_000,
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(join(scratch, `${encodeURIComponent(scenario)}.json`), 'utf8')).resolves.toContain(
        '"status":"attempted"',
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('classifies an unknown scenario as a fixture defect', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'official-client-bridge-'));
    const scenario = 'not-a-canonical-scenario';
    try {
      await expect(
        execFileAsync(process.execPath, [bridge, '/missing-fixture', fakeGateway, scratch, 'http://127.0.0.1:9/mcp'], {
          env: {
            ...process.env,
            MCP_CONFORMANCE_SCENARIO: scenario,
            MCP_CONFORMANCE_PROTOCOL_VERSION: '2026-07-28',
          },
          timeout: 15_000,
        }),
      ).rejects.toMatchObject({ code: 2 });
      await expect(readFile(join(scratch, `${encodeURIComponent(scenario)}.json`), 'utf8')).resolves.toContain(
        '"status":"fixture-defect"',
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('dispatches modern request metadata with the official scenario context', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'official-client-bridge-'));
    const fixture = join(scratch, 'fixture.mjs');
    await writeFile(
      fixture,
      `const context = JSON.parse(process.env.MCP_CONFORMANCE_CONTEXT);\n` +
        `if (process.env.MCP_CONFORMANCE_SCENARIO !== 'request-metadata' || context.marker !== 'metadata') process.exit(3);\n` +
        `process.stderr.write('{"classification":"gateway-rejected"}\\n'); process.exitCode = 1;\n`,
      'utf8',
    );
    try {
      await expect(
        execFileAsync(process.execPath, [bridge, fixture, fakeGateway, scratch, 'http://127.0.0.1:9/mcp'], {
          env: {
            ...process.env,
            MCP_CONFORMANCE_SCENARIO: 'request-metadata',
            MCP_CONFORMANCE_PROTOCOL_VERSION: '2026-07-28',
            MCP_CONFORMANCE_CONTEXT: JSON.stringify({ marker: 'metadata' }),
          },
          timeout: 15_000,
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(join(scratch, 'request-metadata.json'), 'utf8')).resolves.toContain('"status":"attempted"');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('accepts a bracketed IPv6 loopback scenario target', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'official-client-bridge-'));
    const fixture = join(scratch, 'fixture.mjs');
    await writeFile(
      fixture,
      `process.stderr.write('{"classification":"gateway-rejected"}\\n'); process.exitCode = 1;\n`,
      'utf8',
    );
    try {
      await expect(
        execFileAsync(process.execPath, [bridge, fixture, fakeGateway, scratch, 'http://[::1]:9/mcp'], {
          env: {
            ...process.env,
            MCP_CONFORMANCE_SCENARIO: 'tools_call',
            MCP_CONFORMANCE_PROTOCOL_VERSION: '2025-11-25',
          },
          timeout: 15_000,
        }),
      ).rejects.toMatchObject({ code: 1 });
      await expect(readFile(join(scratch, 'tools_call.json'), 'utf8')).resolves.toContain('"status":"attempted"');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it.each(['2025-11-25', '2026-07-28'] as const)(
    'dispatches every frozen %s client scenario inventory entry',
    (revision) => {
      expect(new Set(OFFICIAL_CLIENT_SCENARIOS[revision])).toEqual(new Set(officialClientScenarioIds(revision)));
      expect(
        OFFICIAL_CLIENT_SCENARIOS[revision].every((scenario) => officialClientScenarioFamily(revision, scenario)),
      ).toBe(true);
    },
  );
});
