#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { officialClientScenarioFamily } from './officialClientScenarioCatalog.mjs';

const [fixture, builtEntryPath, statusDirectory, upstreamEndpoint] = process.argv.slice(2);
const scenario = process.env.MCP_CONFORMANCE_SCENARIO;
const protocolVersion = process.env.MCP_CONFORMANCE_PROTOCOL_VERSION;

function statusPath() {
  if (!scenario || !/^[A-Za-z0-9][A-Za-z0-9/_-]*$/u.test(scenario)) throw new Error('INVALID_SCENARIO');
  return join(statusDirectory, `${encodeURIComponent(scenario)}.json`);
}

async function recordStatus(status) {
  await writeFile(statusPath(), `${JSON.stringify({ scenario, status })}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PORT_RESERVATION_FAILED');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', exited);
      resolve(false);
    }, timeoutMs);
    const exited = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', exited);
  });
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForExit(child, 3_000)) return;
  child.kill('SIGKILL');
  if (!(await waitForExit(child, 3_000))) throw new Error('CHILD_CLEANUP_TIMEOUT');
}

async function waitForGatewayReady(child, origin, allowUnreadyProductFailure) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('GATEWAY_EXITED');
    try {
      const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) {
        await response.body?.cancel();
        return;
      }
      await response.body?.cancel();
      if (allowUnreadyProductFailure && response.status === 503) {
        const backend = await fetch(`${origin}/health/mcp/official_conformance`, {
          signal: AbortSignal.timeout(500),
        });
        const status = await backend.json().catch(() => undefined);
        if (backend.status === 401 && status?.name === 'official_conformance' && status?.state === 'awaiting_oauth') {
          return;
        }
      }
    } catch {
      // Readiness polling is outside the official scenario attempt.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('GATEWAY_READINESS_TIMEOUT');
}

function fixtureEnvironment(home) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: home,
      NODE_ENV: 'test',
      NO_PROXY: '127.0.0.1,localhost,::1',
      MCP_CONFORMANCE_SCENARIO: process.env.MCP_CONFORMANCE_SCENARIO,
      MCP_CONFORMANCE_CONTEXT: process.env.MCP_CONFORMANCE_CONTEXT,
      MCP_CONFORMANCE_PROTOCOL_VERSION: process.env.MCP_CONFORMANCE_PROTOCOL_VERSION,
    }).filter((entry) => entry[1] !== undefined),
  );
}

function runFixture(endpoint, home) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fixture, endpoint], {
      env: fixtureEnvironment(home),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 65_536) stderr += String(chunk);
    });
    child.once('error', () => resolve({ kind: 'fixture-defect', exitCode: 1 }));
    child.once('exit', (code, signal) => {
      const gatewayRejected = stderr
        .split(/\r?\n/u)
        .some((line) => line.includes('"classification":"gateway-rejected"'));
      resolve({
        kind: code === 0 || gatewayRejected ? 'attempted' : 'fixture-defect',
        exitCode: signal ? 1 : (code ?? 1),
      });
    });
  });
}

async function main() {
  if (!fixture || !builtEntryPath || !statusDirectory || !upstreamEndpoint) throw new Error('INVALID_ARGUMENTS');
  await mkdir(statusDirectory, { recursive: true, mode: 0o700 });
  const endpoint = new URL(upstreamEndpoint);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.username ||
    endpoint.password ||
    !['127.0.0.1', '::1', '[::1]', 'localhost'].includes(endpoint.hostname)
  ) {
    throw new Error('INVALID_ENDPOINT');
  }
  const family = officialClientScenarioFamily(protocolVersion, scenario);
  if (!family) {
    await recordStatus('fixture-defect');
    process.exitCode = 2;
    return;
  }
  const context = process.env.MCP_CONFORMANCE_CONTEXT ? JSON.parse(process.env.MCP_CONFORMANCE_CONTEXT) : undefined;
  if (context !== undefined && (!context || typeof context !== 'object' || Array.isArray(context))) {
    throw new Error('INVALID_CONTEXT');
  }
  const scratch = await mkdtemp(join(statusDirectory, 'bridge-'));
  const runtimeScope = join(scratch, 'runtime-scope');
  const home = join(scratch, 'home');
  await Promise.all([mkdir(runtimeScope), mkdir(home)]);
  const oauthEnvironment = {};
  const upstream = { type: 'streamableHttp', url: endpoint.href };
  if (family === 'auth') {
    const oauth = { autoRegister: typeof context?.client_id !== 'string' };
    if (typeof context?.client_id === 'string') {
      oauth.clientId = '${MCP_CONFORMANCE_FIXTURE_CLIENT_ID}';
      oauthEnvironment.MCP_CONFORMANCE_FIXTURE_CLIENT_ID = context.client_id;
    }
    if (typeof context?.client_secret === 'string') {
      oauth.clientSecret = '${MCP_CONFORMANCE_FIXTURE_CLIENT_SECRET}';
      oauthEnvironment.MCP_CONFORMANCE_FIXTURE_CLIENT_SECRET = context.client_secret;
    }
    upstream.oauth = oauth;
  }
  await writeFile(
    join(runtimeScope, 'mcp.json'),
    `${JSON.stringify({
      mcpServers: { official_conformance: upstream },
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const gateway = spawn(
    process.execPath,
    [
      builtEntryPath,
      'serve',
      '--transport',
      'http',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--config-dir',
      runtimeScope,
      '--async-max-retries',
      '0',
      '--no-async-background-retry',
    ],
    {
      cwd: runtimeScope,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NODE_ENV: 'test',
        ONE_MCP_CONFIG_DIR: runtimeScope,
        ONE_MCP_LOG_LEVEL: 'error',
        ONE_MCP_ENABLE_AUTH: 'false',
        NO_PROXY: '127.0.0.1,localhost,::1',
        ...oauthEnvironment,
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );

  try {
    await waitForGatewayReady(gateway, origin, family === 'auth');
    const result = await runFixture(`${origin}/mcp`, home);
    await recordStatus(result.kind);
    process.exitCode = result.exitCode;
  } finally {
    await stopChild(gateway);
    await rm(scratch, { recursive: true, force: true });
  }
}

main().catch(async () => {
  try {
    await recordStatus('harness-defect');
  } catch {
    // The parent treats a missing status as a harness defect.
  }
  process.exitCode = 1;
});
