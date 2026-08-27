import { once } from 'node:events';

import { describe, expect, it } from 'vitest';

import { createSanitizedWireCapture, serializeEvidence } from './sanitizedWireEvidence.js';
import { startStdioWireTap } from './stdioWireTap.js';

describe('stdio wire tap', () => {
  it('forwards newline JSON-RPC while retaining no raw lines, stderr, arguments, results, or env', async () => {
    const secrets = ['AlphaNumericSecret42', 'punctuation!@#$%^&*()[]{}', 'path-/Users/private/project'];
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-stdio', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: (value) => value.jsonrpc === '2.0',
    });
    const childScript = [
      "import readline from 'node:readline';",
      'console.error(process.env.WIRE_TEST_SECRET);',
      'const lines = readline.createInterface({ input: process.stdin });',
      "lines.on('line', (line) => {",
      '  const request = JSON.parse(line);',
      "  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.params }) + '\\n');",
      '});',
    ].join('\n');
    const tap = await startStdioWireTap({
      command: process.execPath,
      args: ['--input-type=module', '-e', childScript],
      env: { ...process.env, WIRE_TEST_SECRET: secrets[0] },
      capture,
      contextId: 'case-stdio',
    });

    const outputChunks: Buffer[] = [];
    tap.stdout.on('data', (chunk: Buffer) => outputChunks.push(chunk));
    for (const [index, secret] of secrets.entries()) {
      tap.stdin.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: secret, method: 'tools/call', params: { token: secret, index } })}\n`,
      );
    }
    tap.stdin.end();
    await once(tap.stdout, 'end');
    const status = await tap.closed;

    const rawOutput = Buffer.concat(outputChunks).toString('utf8');
    for (const secret of secrets) expect(rawOutput).toContain(secret);
    expect(status).toEqual({ exitKind: 'zero', stderr: 'present' });

    const evidence = capture.snapshot();
    expect(evidence.records).toHaveLength(6);
    expect(evidence.records.map((record) => record.direction)).toEqual([
      'gateway_to_peer',
      'gateway_to_peer',
      'gateway_to_peer',
      'peer_to_gateway',
      'peer_to_gateway',
      'peer_to_gateway',
    ]);
    const serialized = serializeEvidence(evidence);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(JSON.stringify(status)).not.toContain(secrets[0]);
  });

  it('uses a generic spawn failure with no command or path disclosure', async () => {
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-spawn', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    await expect(
      startStdioWireTap({
        command: '/private/SecretPath/does-not-exist',
        capture,
        contextId: 'case-spawn',
      }),
    ).rejects.toThrow('Stdio wire tap spawn failure');
  });

  it('force-kills a child that ignores stdin closure and SIGTERM', async () => {
    const capture = createSanitizedWireCapture({
      contexts: [{ id: 'case-stubborn', negotiatedRevision: '2025-11-25' }],
      validateEnvelope: () => true,
    });
    const childScript = [
      "process.on('SIGTERM', () => undefined);",
      'process.stdin.resume();',
      'process.stdout.write(\'{"jsonrpc":"2.0","id":1,"result":{}}\\n\');',
      'setInterval(() => undefined, 1_000);',
    ].join('\n');
    const tap = await startStdioWireTap({
      command: process.execPath,
      args: ['--input-type=module', '-e', childScript],
      env: process.env,
      capture,
      contextId: 'case-stubborn',
    });
    await once(tap.stdout, 'data');

    const startedAt = Date.now();
    await expect(tap.close()).resolves.toEqual({ exitKind: 'signal', stderr: 'absent' });
    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });
});
