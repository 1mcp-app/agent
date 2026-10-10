import { JSONRPCMessageSchema } from '@modelcontextprotocol/core';

import * as childProcess from 'node:child_process';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSanitizedWireCapture, startHttpWireTap } from '../capture/index.js';
import { startCanonicalGatewayTarget } from '../official/canonicalGatewayTarget.js';
import { type OfficialConformanceResult } from '../official/officialRunner.js';
import { startOfficialReferenceServer } from '../official/referenceServer.js';
import {
  classifyOfficialClientResult,
  runFoundationConformance,
  runQualifiedOfficialServerTarget,
  startOfficialGateway,
  stopChild,
} from './foundationRun.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
}));

describe('foundation integrity preflight', () => {
  it('compares artifacts with committed content before attempting evidence generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'conformance-integrity-failure-'));
    const execFileSync = childProcess.execFileSync;
    const git = vi.spyOn(childProcess, 'execFileSync').mockImplementation((...args) => {
      if (
        args[0] === 'git' &&
        Array.isArray(args[1]) &&
        args[1][0] === 'show' &&
        args[1][1] === 'HEAD:test/conformance/boundary/sdkBoundaryProof.ts'
      ) {
        return Buffer.from('different committed artifact content');
      }
      // Model committed artifacts independently of uncommitted files in this checkout.
      if (args[0] === 'git' && Array.isArray(args[1]) && args[1][0] === 'show') {
        const revision = args[1][1];
        if (typeof revision === 'string' && revision.startsWith('HEAD:')) {
          return readFileSync(join(process.cwd(), revision.slice('HEAD:'.length)));
        }
      }
      return execFileSync(...args);
    });
    try {
      await expect(
        runFoundationConformance({ root: process.cwd(), outputDirectory: directory, mode: 'baseline' }),
      ).rejects.toThrow('artifact-digest-mismatch:sdk-boundary-proof');
      const report = JSON.parse(await readFile(join(directory, 'conformance-integrity.json'), 'utf8'));
      expect(report).toMatchObject({
        ok: false,
        issues: expect.arrayContaining([{ code: 'artifact-digest-mismatch', subject: 'sdk-boundary-proof' }]),
      });
      expect(await readdir(directory)).toEqual(['conformance-integrity.json']);
    } finally {
      git.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function officialProductResult(): Extract<OfficialConformanceResult, { classification: 'product' }> {
  return {
    classification: 'product',
    role: 'client',
    revision: '2025-11-25',
    productVerdict: 'fail',
    scenarios: [{ scenarioId: 'tools_call', checks: [{ id: 'tools-call', status: 'FAILURE', specReferenceIds: [] }] }],
    counts: { SUCCESS: 0, FAILURE: 1, WARNING: 0, SKIPPED: 0, total: 1 },
    artifact: { artifactId: 'official/client-legacy.json', digest: `sha256:${'a'.repeat(64)}` },
  };
}

describe('official client gateway classification', () => {
  it.each([
    ['attempted', 'product'],
    ['gateway-rejected', 'product'],
    ['fixture-defect', 'fixture'],
    ['harness-defect', 'harness'],
  ] as const)('maps a %s bridge outcome to %s evidence', async (status, classification) => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    try {
      await writeFile(join(directory, 'tools_call.json'), JSON.stringify({ scenario: 'tools_call', status }), 'utf8');
      const result = await classifyOfficialClientResult(officialProductResult(), directory);
      expect(result.classification).toBe(classification);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('retains a digest-protected OAuth fixture gap after temporary bridge statuses are removed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    const statuses = join(directory, 'temporary-statuses');
    await mkdir(statuses);
    const result: OfficialConformanceResult = {
      ...officialProductResult(),
      scenarios: [{ scenarioId: 'auth/metadata-default', checks: [] }],
    };
    try {
      const bridgeStatus = {
        scenario: 'auth/metadata-default',
        status: 'fixture-defect',
        reason: 'oauth-fixture-context-unavailable',
      };
      await writeFile(join(statuses, 'auth%2Fmetadata-default.json'), JSON.stringify(bridgeStatus));
      expect(await classifyOfficialClientResult(result, statuses, directory)).toMatchObject({
        classification: 'fixture',
        reason: 'invalid-target',
      });
      await rm(statuses, { recursive: true });
      const evidence = JSON.parse(
        await readFile(join(directory, 'official-client-statuses/client.2025-11-25.json'), 'utf8'),
      );
      expect(evidence).toMatchObject({
        classification: 'fixture',
        reason: 'invalid-target',
        rawOfficialArtifact: result.artifact,
        bridgeStatuses: [bridgeStatus],
      });
      const { digest, ...payload } = evidence;
      expect(digest).toBe(`sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`);
      expect(result.classification).toBe('product');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['attempted', 'gateway-rejected'])(
    'retains owned OAuth rejection as product evidence for %s',
    async (status) => {
      const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
      const result: OfficialConformanceResult = {
        ...officialProductResult(),
        scenarios: [{ scenarioId: 'auth/iss-wrong-issuer', checks: [] }],
      };
      try {
        const bridgeStatus = { scenario: 'auth/iss-wrong-issuer', status, reason: 'owned-oauth-rejected' };
        await writeFile(join(directory, 'auth%2Fiss-wrong-issuer.json'), JSON.stringify(bridgeStatus));
        expect(await classifyOfficialClientResult(result, directory, directory)).toEqual(result);
        const evidence = JSON.parse(
          await readFile(join(directory, 'official-client-statuses/client.2025-11-25.json'), 'utf8'),
        );
        expect(evidence.bridgeStatuses).toEqual([bridgeStatus]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );

  it('rejects unbounded or unknown reason evidence without retaining it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    try {
      await writeFile(
        join(directory, 'tools_call.json'),
        JSON.stringify({
          scenario: 'tools_call',
          status: 'fixture-defect',
          reason: 'private-context'.repeat(100),
        }),
      );
      expect(await classifyOfficialClientResult(officialProductResult(), directory, directory)).toMatchObject({
        classification: 'harness',
        reason: 'artifact-invalid',
      });
      expect(await readdir(directory)).toEqual(['tools_call.json']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('treats a missing bridge outcome as a harness defect', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'official-client-status-'));
    try {
      const result = await classifyOfficialClientResult(officialProductResult(), directory);
      expect(result).toMatchObject({ classification: 'harness', reason: 'artifact-invalid' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('retained revision fixture cleanup', () => {
  it('awaits confirmed exit after bounded SIGKILL escalation', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    await once(child.stdout!, 'data');

    await stopChild(child, 250);

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(child.signalCode).toBe('SIGKILL');
  });
});

describe('official server target qualification', () => {
  it('skips scored execution when discovery cannot map the owned identities', async () => {
    const run = vi.fn();
    const target = { isQualified: () => false, close: vi.fn() };
    expect(await runQualifiedOfficialServerTarget('2026-07-28', target, run)).toEqual({
      classification: 'fixture',
      role: 'server',
      revision: '2026-07-28',
      reason: 'invalid-target',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['request-inspection-limit', 'template-projection-unsupported'])(
    'retains raw artifacts but removes the product verdict after a late %s fault',
    async () => {
      let qualified = true;
      const rawResult: OfficialConformanceResult = { ...officialProductResult(), role: 'server' };
      const target = {
        isQualified: () => qualified,
        close: vi.fn(async () => {
          qualified = false;
        }),
      };
      const run = vi.fn(async () => rawResult);
      expect(await runQualifiedOfficialServerTarget('2025-11-25', target, run)).toEqual({
        classification: 'harness',
        role: 'server',
        revision: '2025-11-25',
        reason: 'artifact-invalid',
      });
      expect(target.close).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledOnce();
      expect(rawResult).toHaveProperty('artifact');
      expect(rawResult.classification).toBe('product');
    },
  );

  it('keeps schema-invalid gateway output as a product failure when adaptation is qualified', async () => {
    const rawResult: OfficialConformanceResult = { ...officialProductResult(), role: 'server' };
    const target = { isQualified: () => true, close: vi.fn(async () => {}) };
    expect(await runQualifiedOfficialServerTarget('2025-11-25', target, async () => rawResult)).toBe(rawResult);
    expect(target.close).toHaveBeenCalledOnce();
  });
});

// Uses the exact local build; authentication and canonical forwarding are exercised over owned HTTP listeners.
it('provisions only the modern official server leg and resumes reference MRTR through the credential-stripping tap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'official-authenticated-target-'));
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const reference = await startOfficialReferenceServer(process.cwd(), directory);
    cleanup.push(reference.close);
    const gateway = await startOfficialGateway(process.cwd(), directory, reference.endpoint, '2026-07-28');
    cleanup.push(gateway.close);
    expect(gateway.accessToken).toBeDefined();
    const anonymous = await fetch(`${new URL(gateway.endpoint).origin}/api/v1/inspect`);
    expect(anonymous.status).toBe(401);
    await anonymous.body?.cancel();
    const target = await startCanonicalGatewayTarget({
      root: process.cwd(),
      referenceEndpoint: reference.endpoint,
      gatewayEndpoint: gateway.endpoint,
      gatewayAccessToken: gateway.accessToken,
      revision: '2026-07-28',
      outputDirectory: directory,
    });
    cleanup.push(target.close);
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'authenticated-target', negotiatedRevision: '2026-07-28' }],
      validateEnvelope: (envelope) => JSONRPCMessageSchema.safeParse(envelope).success,
    });
    const tap = await startHttpWireTap({
      target: target.endpoint,
      capture,
      contextId: 'authenticated-target',
      hop: 'inbound',
      authenticatedTarget: target,
    });
    cleanup.push(tap.close);
    const request = async (params: Record<string, unknown>) => {
      const response = await fetch(`${tap.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/call',
          'mcp-name': 'test_input_required_result_request_state',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'test_input_required_result_request_state',
            arguments: {},
            ...params,
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'owned-official-driver', version: '1' },
              'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
            },
          },
        }),
      });
      return response.json();
    };
    const parked = await request({});
    expect(parked.error).toBeUndefined();
    expect(parked.result).toMatchObject({ resultType: 'input_required', requestState: expect.any(String) });
    const completed = await request({
      requestState: parked.result.requestState,
      inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
    });
    expect(completed.result).toMatchObject({ content: [{ text: 'state-ok: requestState validated' }] });
    await target.close();
    const evidence = await readFile(join(directory, 'official-targets/server.2026-07-28.json'), 'utf8');
    expect(JSON.parse(evidence).gatewayAuthentication).toEqual({
      mode: 'configured-bearer',
      credentialConfigured: true,
    });
    expect(evidence.includes(gateway.accessToken!)).toBe(false);
    expect(JSON.stringify(capture.snapshot()).includes(gateway.accessToken!)).toBe(false);
    const legacy = await startOfficialGateway(process.cwd(), directory, reference.endpoint, '2025-11-25');
    cleanup.push(legacy.close);
    expect(legacy.accessToken).toBeUndefined();
    const inspected = await fetch(`${new URL(legacy.endpoint).origin}/api/v1/inspect`);
    expect(inspected.status).toBe(200);
    await inspected.body?.cancel();
  } finally {
    for (const close of cleanup.reverse()) await close();
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
