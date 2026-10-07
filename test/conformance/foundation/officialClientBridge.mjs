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

async function recordStatus(status, reason) {
  await writeFile(statusPath(), `${JSON.stringify({ scenario, status, ...(reason ? { reason } : {}) })}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
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

async function waitForGatewayReady(child, origin) {
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
    } catch {
      // Readiness polling is outside the official scenario attempt.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('GATEWAY_READINESS_TIMEOUT');
}

function fixtureEnvironment(home, credential) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: home,
      NODE_ENV: 'test',
      NO_PROXY: '127.0.0.1,localhost,::1',
      MCP_CONFORMANCE_SCENARIO: process.env.MCP_CONFORMANCE_SCENARIO,
      MCP_CONFORMANCE_CONTEXT: process.env.MCP_CONFORMANCE_CONTEXT,
      MCP_CONFORMANCE_PROTOCOL_VERSION: process.env.MCP_CONFORMANCE_PROTOCOL_VERSION,
      ONE_MCP_CONFORMANCE_GATEWAY_TOKEN: credential?.token,
      ONE_MCP_CONFORMANCE_GATEWAY_ORIGIN: credential?.origin,
    }).filter((entry) => entry[1] !== undefined),
  );
}

function runFixture(endpoint, home, credential) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fixture, endpoint], {
      env: fixtureEnvironment(home, credential),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 65_536) stderr += String(chunk);
    });
    child.once('error', () => resolve({ kind: 'fixture-defect', exitCode: 1 }));
    child.once('close', (code, signal) => {
      const gatewayRejected = stderr
        .split(/\r?\n/u)
        .some((line) => line.includes('"classification":"gateway-rejected"'));
      const kind = code === 0 ? 'attempted' : gatewayRejected ? 'gateway-rejected' : 'fixture-defect';
      resolve({
        kind,
        exitCode: signal ? 1 : (code ?? 1),
      });
    });
  });
}

async function provisionOwnedGatewayCredential(origin) {
  const response = await fetch(`${origin}/api/auth/cli-token`, {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  let token;
  try {
    if (response.status !== 200) throw new Error('OWNED_GATEWAY_CREDENTIAL_REJECTED');
    const minted = await response.json();
    if (
      minted?.authRequired !== true ||
      typeof minted.token !== 'string' ||
      minted.token.length === 0 ||
      minted.token.length > 4096 ||
      !/^[A-Za-z0-9._~+/-]+=*$/u.test(minted.token)
    ) {
      throw new Error('OWNED_GATEWAY_CREDENTIAL_INVALID');
    }
    token = minted.token;
  } finally {
    if (!response.bodyUsed) await response.body?.cancel();
  }
  const admitted = await fetch(`${origin}/api/v1/inspect`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  try {
    if (admitted.status !== 200) throw new Error('OWNED_GATEWAY_AUTH_ADMISSION_REJECTED');
  } finally {
    await admitted.body?.cancel();
  }
  return { origin, token };
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
  const ownedIssuer = family === 'auth' ? context?.ownedOAuthIssuer : undefined;
  if (family === 'auth') {
    if (typeof ownedIssuer !== 'string') {
      await recordStatus('fixture-defect', 'oauth-fixture-context-unavailable');
      process.exitCode = 1;
      return;
    }
    ownedLoopbackUrl(ownedIssuer);
  }
  const ownsRequestStateGrant = family === 'request-state' || family === 'auth';
  const scratch = await mkdtemp(join(statusDirectory, 'bridge-'));
  const runtimeScope = join(scratch, 'runtime-scope');
  const home = join(scratch, 'home');
  await Promise.all([mkdir(runtimeScope), mkdir(home)]);
  const port = await reserveLoopbackPort();
  const origin = `http://127.0.0.1:${port}`;
  const upstream = { type: 'streamableHttp', url: endpoint.href };
  if (family === 'auth') {
    upstream.oauth = {
      issuer: ownedIssuer,
      redirectUrl: `${origin}/oauth/callback/official_conformance`,
      ...(context.client_id
        ? { clientId: context.client_id, clientSecret: context.client_secret, autoRegister: false }
        : {}),
      ...(context.client_metadata_url ? { clientMetadataUrl: context.client_metadata_url } : {}),
    };
  }

  await writeFile(
    join(runtimeScope, 'mcp.json'),
    `${JSON.stringify({
      mcpServers: { official_conformance: upstream },
    })}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );

  const createGateway = () =>
    spawn(
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
        ...(ownsRequestStateGrant ? ['--enable-scope-validation', 'true', '--credential-store', 'file'] : []),
      ],
      {
        cwd: runtimeScope,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          NODE_ENV: 'test',
          ONE_MCP_CONFIG_DIR: runtimeScope,
          ONE_MCP_LOG_LEVEL: 'error',
          ONE_MCP_ENABLE_AUTH: String(ownsRequestStateGrant),
          NO_PROXY: '127.0.0.1,localhost,::1',
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    );

  let gateway = createGateway();
  try {
    await waitForGatewayReady(gateway, origin);
    const credential = ownsRequestStateGrant ? await provisionOwnedGatewayCredential(origin) : undefined;
    if (family === 'auth') {
      const authResult = await completeOwnedOAuth(origin, ownedIssuer, credential);
      if (!authResult) {
        const expectedRejection = context.ownedOAuthReject === true;
        await recordStatus(expectedRejection ? 'attempted' : 'gateway-rejected', 'owned-oauth-rejected');
        process.exitCode = expectedRejection ? 0 : 1;
        return;
      }
    }
    let result = await runFixture(`${origin}/mcp`, home, credential);
    if (family === 'auth' && scenario === 'auth/scope-step-up' && result.kind === 'gateway-rejected') {
      // Complete the pending challenge only. The failed Tool is never replayed.
      if (await completeOwnedOAuth(origin, ownedIssuer, credential)) result = { kind: 'attempted', exitCode: 0 };
    }
    if (family === 'auth' && scenario === 'auth/authorization-server-migration' && result.kind === 'gateway-rejected') {
      // The scenario owner explicitly supplies both authorities. Simulate an
      // operator configuring the second issuer, preserving the credential store
      // so authority-bound registration reuse is tested across the restart.
      const nextIssuer = context.ownedOAuthNextIssuer;
      ownedLoopbackUrl(nextIssuer);
      await stopChild(gateway);
      upstream.oauth.issuer = nextIssuer;
      await writeFile(
        join(runtimeScope, 'mcp.json'),
        JSON.stringify({ mcpServers: { official_conformance: upstream } }) + '\n',
        { mode: 0o600 },
      );
      gateway = createGateway();
      await waitForGatewayReady(gateway, origin);
      const nextCredential = await provisionOwnedGatewayCredential(origin);
      if (await completeOwnedOAuth(origin, nextIssuer, nextCredential)) result = { kind: 'attempted', exitCode: 0 };
    }
    await recordStatus(result.kind);
    process.exitCode = result.exitCode;
  } finally {
    await stopChild(gateway);
    await rm(scratch, { recursive: true, force: true });
  }
}

function ownedLoopbackUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    url.username ||
    url.password ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('UNOWNED_OAUTH_DESTINATION');
  }
  return url;
}

async function completeOwnedOAuth(origin, issuer, credential) {
  const fetchBounded = (url, headers) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), headers });
  const started = await fetchBounded(`${origin}/oauth/authorize/official_conformance`, {
    Authorization: `Bearer ${credential.token}`,
  });
  let authorization;
  try {
    if (started.status !== 302) return false;
    authorization = ownedLoopbackUrl(started.headers.get('location'));
    const owned = ownedLoopbackUrl(issuer);
    if (
      authorization.origin !== owned.origin ||
      !authorization.pathname.startsWith(owned.pathname.replace(/\/$/u, '') + '/')
    ) {
      throw new Error('UNOWNED_OAUTH_DESTINATION');
    }
  } finally {
    await started.body?.cancel();
  }
  const approval = await fetchBounded(authorization);
  let callback;
  try {
    if (approval.status !== 302) return false;
    callback = ownedLoopbackUrl(approval.headers.get('location'));
    if (callback.origin !== origin || callback.pathname !== '/oauth/callback/official_conformance')
      throw new Error('UNOWNED_OAUTH_CALLBACK');
    if (callback.searchParams.get('state') !== authorization.searchParams.get('state'))
      throw new Error('OAUTH_STATE_MISMATCH');
  } finally {
    await approval.body?.cancel();
  }
  const finished = await fetchBounded(callback);
  try {
    return finished.status === 302 && finished.headers.get('location') === '/admin/oauth?success=1';
  } finally {
    await finished.body?.cancel();
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
