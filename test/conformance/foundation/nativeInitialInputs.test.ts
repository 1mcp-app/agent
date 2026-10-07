import { JSONRPCMessageSchema } from '@modelcontextprotocol/core';

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createSanitizedWireCapture, startHttpWireTap } from '../capture/index.js';
import { startCanonicalGatewayTarget } from '../official/canonicalGatewayTarget.js';
import { startOfficialReferenceServer } from '../official/referenceServer.js';
import { startOfficialGateway } from './foundationRun.js';

async function checks(directory: string): Promise<Array<{ id: string; status: string }>> {
  const result: Array<{ id: string; status: string }> = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...(await checks(path)));
    else if (item.name === 'checks.json') result.push(...JSON.parse(await readFile(path, 'utf8')));
  }
  return result;
}

async function runPinned(endpoint: string, output: string): Promise<number> {
  await mkdir(output);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/@modelcontextprotocol/conformance/dist/index.js'),
        'server',
        '--url',
        endpoint,
        '--scenario',
        'input-required-result-ignore-extra-params',
        '--spec-version',
        '2026-07-28',
        '--force',
        '--output-dir',
        output,
      ],
      { cwd: process.cwd(), env: { ...process.env, NO_PROXY: '127.0.0.1,localhost,::1' }, stdio: 'ignore' },
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
}

let id = 0;
async function rpc(endpoint: string, method: string, params: Record<string, unknown>) {
  const requestId = ++id;
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
      ...(typeof params.uri === 'string' ? { 'mcp-name': params.uri } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'initial-input-regression', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
        },
      },
    }),
  });
  const body = await response.text();
  const frames = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\r?\n\r?\n/).flatMap((event) => {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        return data ? [JSON.parse(data)] : [];
      })
    : [JSON.parse(body)];
  const frame = frames.find((value) => value.id === requestId);
  expect(frame, `Missing response for ${method}`).toBeDefined();
  expect(frame.error, `${method}: ${JSON.stringify(frame.error)}`).toBeUndefined();
  expect(response.status).toBe(200);
  return frame.result;
}

it('preserves pinned initial input responses on direct, authenticated and anonymous modern execution', async () => {
  const root = await mkdtemp('/tmp/1mcp-native-initial-inputs-');
  try {
    for (const mode of ['direct', 'authenticated', 'anonymous'] as const) {
      const directory = join(root, mode);
      await mkdir(directory);
      const close: Array<() => Promise<void>> = [];
      const cleanupErrors: unknown[] = [];
      try {
        const reference = await startOfficialReferenceServer(process.cwd(), directory);
        close.push(reference.close);
        const wire: Array<{ method: string; name?: string; uri?: string; inputs?: unknown; state: boolean }> = [];
        const capture = createSanitizedWireCapture({
          contexts: [{ id: mode, negotiatedRevision: '2026-07-28' }],
          validateEnvelope: (envelope) => {
            // These fields contain only fixed synthetic test values, never auth or opaque state.
            const frame = envelope as { method?: string; params?: Record<string, unknown> };
            if (['tools/call', 'prompts/get', 'resources/read'].includes(frame.method ?? ''))
              wire.push({
                method: frame.method!,
                name: frame.params?.name as string | undefined,
                uri: frame.params?.uri as string | undefined,
                inputs: frame.params?.inputResponses,
                state: frame.params?.requestState !== undefined,
              });
            return JSONRPCMessageSchema.safeParse(envelope).success;
          },
        });
        const tap = await startHttpWireTap({ target: reference.endpoint, capture, contextId: mode, hop: 'upstream' });
        close.push(tap.close);
        let endpoint = `${tap.url}/mcp`;
        if (mode !== 'direct') {
          // The legacy revision selects auth-disabled fixture setup; requests still negotiate modern on the wire.
          const gateway = await startOfficialGateway(
            process.cwd(),
            directory,
            endpoint,
            mode === 'authenticated' ? '2026-07-28' : '2025-11-25',
          );
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
          endpoint = target.endpoint;
        }
        const output = join(directory, 'pinned');
        expect(await runPinned(endpoint, output), mode).toBe(0);
        const result = await checks(output);
        expect(result.find((value) => value.id === 'sep-2322-ignore-unexpected-params')?.status, mode).toBe('SUCCESS');
        expect(
          result.every((value) => value.status === 'SUCCESS'),
          JSON.stringify(result),
        ).toBe(true);
        expect(wire, mode).toHaveLength(1);
        expect(wire[0]).toEqual({
          method: 'tools/call',
          name: 'test_input_required_result_elicitation',
          uri: undefined,
          inputs: {
            user_name: { action: 'accept', content: { name: 'Alice' } },
            unknown_extra_key: { action: 'accept', content: { foo: 'bar' } },
            another_unexpected: { action: 'accept', content: { baz: 123 } },
          },
          state: false,
        });

        const promptInputs = {
          user_context: { action: 'accept', content: { context: 'initial-context' } },
          unknown_key: { preserved: true },
        };
        const beforePrompt = wire.length;
        const prompt = await rpc(endpoint, 'prompts/get', {
          name: 'test_input_required_result_prompt',
          inputResponses: promptInputs,
        });
        expect(prompt.messages[0].content.text).toBe('Prompt with context: initial-context');
        expect(wire.slice(beforePrompt)).toEqual([
          {
            method: 'prompts/get',
            name: 'test_input_required_result_prompt',
            uri: undefined,
            inputs: promptInputs,
            state: false,
          },
        ]);

        const readInputs = { unknown_resource_key: { preserved: true } };
        const beforeRead = wire.length;
        const read = await rpc(endpoint, 'resources/read', {
          uri: 'test://stateless-static-text',
          inputResponses: readInputs,
        });
        expect(read.contents.length).toBeGreaterThan(0);
        expect(wire.slice(beforeRead)).toEqual([
          {
            method: 'resources/read',
            name: undefined,
            uri: 'test://stateless-static-text',
            inputs: readInputs,
            state: false,
          },
        ]);
        if (mode === 'authenticated') {
          const beforeEmpty = wire.length;
          const empty = await rpc(endpoint, 'tools/call', {
            name: 'test_input_required_result_elicitation',
            arguments: {},
            inputResponses: {},
          });
          expect(empty.resultType).toBe('input_required');
          expect(empty.inputRequests).toHaveProperty('user_name');
          expect(wire.slice(beforeEmpty)).toEqual([
            {
              method: 'tools/call',
              name: 'test_input_required_result_elicitation',
              uri: undefined,
              inputs: {},
              state: false,
            },
          ]);
        }
      } finally {
        for (const stop of close.reverse()) {
          try {
            await stop();
          } catch (error) {
            cleanupErrors.push(error);
          }
        }
      }
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Initial input fixture cleanup failed');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 150_000);
