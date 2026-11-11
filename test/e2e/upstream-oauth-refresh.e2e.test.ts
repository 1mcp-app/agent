import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestProcessEnvironment, isolatedTestEnvironment } from '../../scripts/test-process-environment.mjs';

const worker = fileURLToPath(new URL('./fixtures/upstream-refresh-worker.mjs', import.meta.url));
let directory: string;
let artifact: string;

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-refresh-package-'));
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { encoding: 'utf8' }),
  ) as Array<{ filename: string }>;
  execFileSync('tar', ['-xzf', path.join(directory, packed[0].filename), '-C', directory]);
  artifact = path.join(directory, 'package');
  // Runtime imports resolve from the extracted npm payload; unchanged dependencies remain external.
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(artifact, 'node_modules'), 'dir');
}, 60_000);
afterAll(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

for (const era of ['legacy', 'modern'])
  describe(`packaged ${era} upstream refresh`, () => {
    it('coordinates separate factory-created transports through the shipped auth adapter', async () => {
      let base = '';
      let refreshes = 0;
      let challenges = 0;
      let pending: http.ServerResponse | undefined;
      const resourceBodies: Array<{ body: string; authorized: boolean }> = [];
      const release = () => {
        if (!pending || challenges < 2) return;
        pending.end(
          JSON.stringify({ access_token: 'winner', refresh_token: 'rotated', token_type: 'Bearer', scope: 'read' }),
        );
        pending = undefined;
      };
      const server = http.createServer(async (request, response) => {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        response.setHeader('content-type', 'application/json');
        if (request.url?.includes('oauth-protected-resource'))
          return response.end(
            JSON.stringify({ resource: base + '/mcp', authorization_servers: [base], scopes_supported: ['read'] }),
          );
        if (request.url?.includes('oauth-authorization-server'))
          return response.end(
            JSON.stringify({
              issuer: base,
              authorization_endpoint: base + '/authorize',
              token_endpoint: base + '/token',
              registration_endpoint: base + '/register',
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code', 'refresh_token'],
              code_challenge_methods_supported: ['S256'],
              authorization_response_iss_parameter_supported: true,
            }),
          );
        if (request.url === '/register')
          return response.end(JSON.stringify({ ...JSON.parse(body), client_id: 'fixture-client' }));
        if (request.url === '/token') {
          if (new URLSearchParams(body).get('grant_type') === 'authorization_code')
            return response.end(
              JSON.stringify({
                access_token: 'expired',
                refresh_token: 'initial',
                token_type: 'Bearer',
                scope: 'read',
              }),
            );
          refreshes++;
          pending = response;
          release();
          return;
        }
        if (request.url === '/mcp') {
          const message = body
            ? (JSON.parse(body) as { id?: string | number; method?: string; params?: { protocolVersion?: string } })
            : undefined;
          const authorized = request.headers.authorization === 'Bearer winner';
          if (message?.method === 'initialize' || message?.method === 'server/discover')
            resourceBodies.push({ body, authorized });
          if (authorized) {
            if (message?.method === 'initialize' || message?.method === 'server/discover') {
              response.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id: message.id,
                  result: {
                    ...(message.method === 'server/discover'
                      ? { resultType: 'complete', ttlMs: 0, cacheScope: 'private', supportedVersions: ['2026-07-28'] }
                      : { protocolVersion: message.params?.protocolVersion }),
                    capabilities: {},
                    serverInfo: { name: 'refresh-fixture', version: '1.0.0' },
                  },
                }),
              );
              return;
            }
            response.statusCode = request.method === 'GET' ? 405 : 202;
            response.end();
            return;
          }
          challenges++;
          response.writeHead(401, {
            'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
          });
          response.end('{}');
          release();
          return;
        }
        response.statusCode = 404;
        response.end('{}');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No fixture port');
      base = `http://127.0.0.1:${address.port}`;
      const isolated = isolatedTestEnvironment();
      const environment = createTestProcessEnvironment({}, isolated.env);
      expect(environment.ONE_MCP_PRODUCT_TELEMETRY_TEST_SUPPRESSED).toBe('true');
      expect(environment.HOME).not.toBe(process.env.HOME);

      try {
        const result = await runOwnedWorker(
          process.execPath,
          [worker, artifact, base + '/mcp', era],
          environment,
          20_000,
        );
        expect(result.code, result.stderr + result.stdout).toBe(0);
        expect(result.stdout).toContain('"refreshed":true');
        expect(refreshes).toBe(1);
        expect(resourceBodies).toHaveLength(4);
        expect(
          resourceBodies
            .filter((entry) => entry.authorized)
            .map((entry) => entry.body)
            .sort(),
        ).toEqual(
          resourceBodies
            .filter((entry) => !entry.authorized)
            .map((entry) => entry.body)
            .sort(),
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        isolated.cleanup();
      }
    }, 30_000);
  });

async function runOwnedWorker(
  command: string,
  args: string[],
  env: Record<string, string | undefined>,
  timeout: number,
) {
  const child = spawn(command, args, { env, timeout, killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  const closed = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let onError!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    onError = reject;
    child.once('error', onError);
  });
  try {
    const result = await Promise.race([closed, failed]);
    return { ...result, stdout, stderr };
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    child.removeListener('error', onError);
  }
}

it('terminates a stalled owned worker before its test deadline', async () => {
  const isolated = isolatedTestEnvironment();
  try {
    const result = await runOwnedWorker(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], isolated.env, 250);
    expect(result.signal).toBe('SIGKILL');
  } finally {
    isolated.cleanup();
  }
});

it('settles a spawn failure before removing its owned scope', async () => {
  const isolated = isolatedTestEnvironment();
  try {
    await expect(
      runOwnedWorker(path.join(directory, 'missing-executable'), [], isolated.env, 250),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    isolated.cleanup();
  }
});
