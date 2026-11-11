import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
      const child = spawn(process.execPath, [worker, artifact, base + '/mcp', era], {
        env: {
          ...process.env,
          ONE_MCP_CONFIG_DIR: path.join(directory, era),
          CODEX_THREAD_ID: '',
          CODEX_SESSION_ID: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      try {
        const exit = await new Promise<number | null>((resolve, reject) => {
          child.once('exit', resolve);
          child.once('error', reject);
        });
        expect(exit, stderr + stdout).toBe(0);
        expect(stdout).toContain('"refreshed":true');
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
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }, 30_000);
  });
