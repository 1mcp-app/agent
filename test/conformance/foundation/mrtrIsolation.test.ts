import { JSONRPCMessageSchema } from '@modelcontextprotocol/core';

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createSanitizedWireCapture, startHttpWireTap } from '../capture/index.js';
import { startCanonicalGatewayTarget } from '../official/canonicalGatewayTarget.js';
import { startOfficialReferenceServer } from '../official/referenceServer.js';
import { startOfficialGateway } from './foundationRun.js';

const failures = ['non-tool-request', 'result-type', 'tampered-state', 'capability-check'];
async function reportFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) files.push(...(await reportFiles(path)));
    else if (item.name === 'checks.json') files.push(path);
  }
  return files;
}

it('keeps each pinned MRTR operation isolated after an abandoned interaction', async () => {
  const evidenceRoot = await mkdtemp('/tmp/1mcp-mrtr-isolation-');
  try {
    for (const suffix of failures) {
      for (const abandoned of [false, true]) {
        const directory = join(evidenceRoot, `${suffix}-${abandoned ? 'after-abandon' : 'fresh'}`);
        await mkdir(directory, { recursive: true });
        const close: Array<() => Promise<void>> = [];
        const cleanupErrors: unknown[] = [];
        try {
          const reference = await startOfficialReferenceServer(process.cwd(), directory);
          close.push(reference.close);
          const capture = createSanitizedWireCapture({
            contexts: [{ id: 'selected-provider', negotiatedRevision: '2026-07-28' }],
            validateEnvelope: (envelope) => JSONRPCMessageSchema.safeParse(envelope).success,
          });
          const upstream = await startHttpWireTap({
            target: reference.endpoint,
            capture,
            contextId: 'selected-provider',
            hop: 'upstream',
          });
          close.push(upstream.close);
          const gateway = await startOfficialGateway(process.cwd(), directory, `${upstream.url}/mcp`, '2026-07-28');
          close.push(gateway.close);
          const target = await startCanonicalGatewayTarget({
            root: process.cwd(),
            referenceEndpoint: reference.endpoint,
            gatewayEndpoint: gateway.endpoint,
            gatewayAccessToken: gateway.accessToken,
            revision: '2026-07-28',
            outputDirectory: directory,
          });
          close.push(target.close);
          const dispatches = () =>
            capture
              .snapshot()
              .records.filter(
                (record) =>
                  record.direction === 'gateway_to_peer' && ['tools_call', 'prompts_get'].includes(record.method ?? ''),
              ).length;
          const run = async (scenario: string) => {
            const output = join(directory, scenario);
            const before = dispatches();
            await mkdir(output);
            const code = await new Promise<number>((resolve, reject) => {
              const child = spawn(
                process.execPath,
                [
                  join(process.cwd(), 'node_modules/@modelcontextprotocol/conformance/dist/index.js'),
                  'server',
                  '--url',
                  target.endpoint,
                  '--scenario',
                  scenario,
                  '--spec-version',
                  '2026-07-28',
                  '--force',
                  '--output-dir',
                  output,
                ],
                {
                  cwd: process.cwd(),
                  env: { ...process.env, NO_PROXY: '127.0.0.1,localhost,::1' },
                  stdio: ['ignore', 'ignore', 'ignore'],
                },
              );
              const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
              child.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
              });
              child.once('exit', (code) => {
                clearTimeout(timer);
                resolve(code ?? -1);
              });
            });
            const checks: unknown[] = [];
            for (const file of await reportFiles(output)) {
              const raw = JSON.parse(await readFile(file, 'utf8'));
              for (const check of raw)
                checks.push({
                  id: check.id,
                  status: check.status,
                  ...(check.errorMessage ? { error: String(check.errorMessage).slice(0, 1200) } : {}),
                });
            }
            const fact = { suffix, abandoned, scenario, code, dispatchCount: dispatches() - before, checks };
            expect(fact.code, scenario).toBe(0);
            expect(checks.length).toBeGreaterThan(0);
            expect(
              checks.every((check) => (check as { status: string }).status === 'SUCCESS'),
              JSON.stringify(fact),
            ).toBe(true);
            expect(fact.dispatchCount, scenario).toBe(scenario.endsWith('non-tool-request') ? 2 : 1);
          };
          if (abandoned) await run('input-required-result-missing-input-response');
          await run(`input-required-result-${suffix}`);
        } finally {
          for (const stop of close.reverse()) {
            try {
              await stop();
            } catch (error) {
              cleanupErrors.push(error);
            }
          }
        }
        if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Owned MRTR fixture cleanup failed');
      }
    }
  } finally {
    await rm(evidenceRoot, { recursive: true, force: true });
  }
}, 240_000);
