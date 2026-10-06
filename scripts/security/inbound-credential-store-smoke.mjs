import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Writes only synthetic records in a disposable Runtime Scope. Never enumerates
// the user's keychain; real helpers (not mocks) supply all native operations.
const args = process.argv.slice(2);
if (!args.includes('--allow-native-write')) {
  console.error('Pass --allow-native-write to test synthetic inbound credentials.');
  process.exit(2);
}
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex < 0 ? undefined : args[binaryIndex + 1];
if (binaryIndex >= 0 && !binary) throw new Error('--binary requires an executable path');
const executable = binary ? path.resolve(binary) : process.execPath;
const prefix = binary ? [] : [path.resolve('build/index.js')];
const load = (file) => import(pathToFileURL(path.resolve(`build/${file}.js`)).href);
const { OAuthStorageService } = await load('auth/storage/oauthStorageService');
const { activateInboundOAuthStore } = await load('auth/storage/inboundOAuthStorage');
const { DockerNativeCredentialStore } = await load('auth/storage/nativeCredentialStore');
const { RuntimeIdentityService } = await load('core/runtime/runtimeIdentityService');
const { AUTH_CONFIG } = await load('constants');
const { AdminIdentityService } = await load('domains/admin/adminIdentityService');
const native = new DockerNativeCredentialStore();
const scope = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-inbound-native-'));
const base = path.join(scope, 'state');
const scopeId = new RuntimeIdentityService({ storageDir: scope }).getRuntimeScopeId();
const upstreamDirectory = path.join(scope, 'clientSessions', 'sessions', 'client');
const upstreamSource = path.join(upstreamDirectory, `oauth-bound-${randomBytes(32).toString('hex')}.json`);
const secret = randomBytes(3000).toString('base64');
const clientId = `native-smoke-${randomUUID()}`;
const clientKey = AUTH_CONFIG.CLIENT.PREFIXES.CLIENT + clientId;
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const resource = 'https://synthetic.1mcp.invalid/mcp';
const redirectUri = 'http://127.0.0.1:39999/callback';
const scopes = ['tag:synthetic'];
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('ONE_MCP_')) delete env[key];
let running = false;
let clean = false;
let stage = 'prepare';
let storage;
let refreshToken;
let references = [];
let blockedMetadata;
let metadataBackup;
let exportedUpstreamBackup;
const adminPassword = randomBytes(32).toString('base64url');
let adminSessionToken;
const issuedSecrets = new Set();
const protectedIdentifiers = new Set();

function run(commandArgs) {
  const result = spawnSync(
    executable,
    [...prefix, ...commandArgs, '--config-dir', scope, '--session-storage-path', base],
    {
      env,
      encoding: 'utf8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const value of [secret, refreshToken, adminPassword, adminSessionToken, ...issuedSecrets].filter(Boolean)) {
    assert.ok(!result.stdout?.includes(value) && !result.stderr?.includes(value), 'CLI exposed synthetic secret');
  }
  return result;
}
function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
function refs() {
  return files(scope)
    .filter((file) => file.endsWith('.ref'))
    .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
}
function chunkKey(ref, index) {
  return `https://oauth.1mcp.invalid/${ref.scope}/${ref.record}/${ref.revision}/${index}`;
}
function assertProtected() {
  for (const file of files(scope)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!text.includes(secret), 'Managed disk file exposed a whole-record synthetic secret');
    assert.ok(!text.includes(refreshToken), 'Managed disk file persisted inbound refresh-token plaintext');
    for (const token of issuedSecrets)
      assert.ok(!text.includes(token), 'Managed disk file persisted an issued bearer token');
    for (const identifier of protectedIdentifiers) {
      assert.ok(
        !path.relative(scope, file).includes(identifier),
        'Managed native filename exposed a bearer identifier',
      );
      assert.ok(!text.includes(identifier), 'Managed native metadata exposed a bearer identifier');
    }
  }
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}
async function startRuntime(authEnabled, inboundReady = true) {
  const port = await freePort();
  running = true;
  const started = run([
    'serve',
    '--background',
    '--credential-store',
    'native',
    `--enable-auth=${authEnabled}`,
    '--port',
    String(port),
    '--host',
    '127.0.0.1',
  ]);
  assert.ok(started.status === 0, 'Synthetic runtime startup failed');
  const origin = `http://127.0.0.1:${port}`;
  let readiness;
  try {
    const response = await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(15000) });
    readiness = await response.json();
  } catch {
    assert.fail('Synthetic runtime credential-domain readiness could not be verified');
  }
  if (inboundReady) {
    assert.ok(
      readiness?.credentialStorage?.inbound?.ready === true,
      'Synthetic inbound native credential domain unavailable',
    );
  } else {
    assert.ok(
      readiness?.credentialStorage?.inbound?.ready === false,
      'Blocked synthetic inbound domain unexpectedly became ready',
    );
  }
  assert.ok(
    readiness?.credentialStorage?.upstream?.ready === true,
    'Synthetic upstream native credential domain unavailable',
  );
  return origin;
}
async function startAndStop(authEnabled) {
  await startRuntime(authEnabled);
  stop();
  assertProtected();
}
function stop() {
  const result = run(['serve', '--stop']);
  assert.ok(result.status === 0, 'Synthetic runtime stop failed');
  running = false;
}
async function openNative() {
  assert.ok(!running, 'Fixture activation requires a stopped child runtime');
  await activateInboundOAuthStore({ baseDir: base, mode: 'native', runtimeScope: scope });
  storage = new OAuthStorageService(base, scopeId, { credentialStore: 'native', runtimeScope: scope });
  await storage.ready();
  assert.ok(storage.isReady(), 'Inbound native storage did not become ready');
  return storage;
}
async function openFile() {
  assert.ok(!running, 'Fixture activation requires a stopped child runtime');
  await activateInboundOAuthStore({ baseDir: base, mode: 'file', runtimeScope: scope });
  storage = new OAuthStorageService(base, scopeId, { credentialStore: 'file', runtimeScope: scope });
  await storage.ready();
  assert.ok(storage.isReady(), 'Inbound file storage did not become ready');
  return storage;
}
function snapshot(service, ids) {
  return {
    session: service.sessionRepository.get(ids.session),
    client: service.clientDataRepository.get(clientKey),
    code: service.authCodeRepository.get(ids.code),
    consent: service.authRequestRepository.get(ids.consent),
    family: service.refreshTokenFamilyRepository.findByToken(refreshToken),
  };
}
try {
  fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}', { mode: 0o600 });
  const upstreamPayload = {
    createdAt: Date.now(),
    expires: Date.now() + 3600000,
    tokens: JSON.stringify({ access_token: secret, token_type: 'Bearer' }),
    extension: { secret },
  };
  fs.mkdirSync(upstreamDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(upstreamSource, JSON.stringify(upstreamPayload), { mode: 0o600 });
  await openFile();
  storage.clientDataRepository.save(
    clientKey,
    {
      client_id: clientId,
      client_secret: secret,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      extension: { secret },
    },
    3600000,
  );
  const ids = {
    session: storage.sessionRepository.create(clientId, resource, scopes, 3600000),
    code: storage.authCodeRepository.create(clientId, redirectUri, resource, scopes, 3600000, challenge),
    consent: storage.createAuthorizationRequest(clientId, redirectUri, challenge, secret, resource, scopes),
  };
  for (const identifier of Object.values(ids)) {
    protectedIdentifiers.add(identifier);
    protectedIdentifiers.add(identifier.slice(identifier.indexOf('-') + 1));
  }
  // Secret-bearing extensions must be protected even in otherwise non-secret records.
  const sessionFile = path.join(
    storage.getStorageDir(),
    `${AUTH_CONFIG.SERVER.SESSION.FILE_PREFIX}${ids.session}.json`,
  );
  const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
  sessionData.extension = { secret };
  fs.writeFileSync(sessionFile, JSON.stringify(sessionData), { mode: 0o600 });
  const accessId = randomUUID();
  protectedIdentifiers.add(accessId);
  const created = await storage.refreshTokenFamilyRepository.create(
    clientId,
    scopes,
    resource,
    accessId,
    (familyId) => {
      storage.sessionRepository.createRefreshFamilyAccessSession({
        tokenId: accessId,
        clientId,
        resource,
        scopes,
        ttlMs: 3600000,
        familyId,
      });
    },
  );
  refreshToken = created.refreshToken;
  const expected = snapshot(storage, ids);
  assert.ok(
    expected.family.currentTokenDigest === createHash('sha256').update(refreshToken).digest('hex'),
    'Seeded refresh lookup mismatch',
  );
  const originalFiles = files(storage.getStorageDir()).filter(
    (file) => file.endsWith('.json') && !file.includes(`${path.sep}.native-oauth${path.sep}`),
  );
  const temporaryFile = `${sessionFile}.abandoned.tmp`;
  const temporaryText = `{"extension":"${secret}"`;
  storage.shutdown();
  storage = undefined;
  fs.writeFileSync(temporaryFile, temporaryText, { mode: 0o600 });

  stage = 'native migration with inbound authentication disabled';
  await startAndStop(false);
  for (const file of [...originalFiles, temporaryFile, upstreamSource])
    assert.ok(!fs.existsSync(file), 'Native startup left a managed plaintext source');
  stage = 'native restart with inbound authentication enabled';
  await startAndStop(true);
  stage = 'real native repository reads';
  await openNative();
  assert.deepEqual(snapshot(storage, ids), expected, 'Migration/restart changed security records');
  references = refs();
  assert.ok(
    references.length >= originalFiles.length + 2,
    'Native inventory omitted seeded security records, temporary, or upstream record',
  );

  // Exercise the chosen Node/SEA executable's provider and HTTP handlers,
  // rather than using the Node fixture imports as packaged-provider proof.
  storage.shutdown();
  storage = undefined;
  stage = 'executable code redemption and refresh replay';
  const origin = await startRuntime(true);
  async function tokenRequest(fields) {
    const response = await fetch(`${origin}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: secret, ...fields }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (body.access_token) {
      issuedSecrets.add(body.access_token);
      protectedIdentifiers.add(body.access_token.slice(AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX.length));
    }
    if (body.refresh_token) issuedSecrets.add(body.refresh_token);
    return { status: response.status, body };
  }
  const grant = {
    grant_type: 'authorization_code',
    code: ids.code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    resource,
  };
  const issued = await tokenRequest(grant);
  assert.ok(
    issued.status === 200 && issued.body.refresh_token,
    'Executable failed to redeem migrated native authorization code',
  );
  const secondRedemption = await tokenRequest(grant);
  assert.ok(
    secondRedemption.status === 400 && secondRedemption.body.error === 'invalid_grant',
    'Executable revived a consumed authorization code',
  );
  const beforeReplay = await fetch(`${origin}/mcp`, {
    headers: { authorization: `Bearer ${issued.body.access_token}` },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(beforeReplay.status !== 401, 'Executable rejected the valid family-bound native access token');
  const refreshGrant = { grant_type: 'refresh_token', refresh_token: issued.body.refresh_token, resource };
  const concurrent = await Promise.all([tokenRequest(refreshGrant), tokenRequest(refreshGrant)]);
  assert.ok(
    concurrent.filter((result) => result.status === 200).length === 1,
    'Executable refresh produced multiple successors',
  );
  assert.ok(
    concurrent.some((result) => result.status === 400 && result.body.error === 'invalid_grant'),
    'Executable native refresh did not reject replay',
  );
  const revokedTokens = [
    issued.body.access_token,
    concurrent.find((result) => result.status === 200).body.access_token,
  ];
  for (const token of revokedTokens) {
    const rejected = await fetch(`${origin}/mcp`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    assert.ok(rejected.status === 401, 'Executable accepted a revoked family-bound access token');
  }
  stop();
  await openNative();
  assert.ok(storage.authCodeRepository.get(ids.code) === null, 'Native provider code consumption was not durable');

  stage = 'native consent consumption';
  const consent = await storage.processConsentApproval(ids.consent, scopes);
  protectedIdentifiers.add(consent.authCode);
  protectedIdentifiers.add(consent.authCode.slice(AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX.length));
  assert.ok(storage.getAuthorizationRequest(ids.consent) === null, 'Native consent request was not consumed');
  assert.ok(
    storage.authCodeRepository.get(consent.authCode)?.clientId === clientId,
    'Native consent code was not persisted',
  );
  await assert.rejects(storage.processConsentApproval(ids.consent, scopes));

  stage = 'native refresh concurrency and replay revocation';
  const results = await Promise.all(
    [0, 1].map(async () => {
      const nextId = randomUUID();
      protectedIdentifiers.add(nextId);
      return storage.refreshTokenFamilyRepository.consume(refreshToken, clientId, nextId, (familyId) => {
        storage.sessionRepository.createRefreshFamilyAccessSession({
          tokenId: nextId,
          clientId,
          resource,
          scopes,
          ttlMs: 3600000,
          familyId,
        });
      });
    }),
  );
  assert.ok(
    results.filter((result) => result.status === 'rotated').length === 1,
    'Native refresh produced multiple successors',
  );
  assert.ok(
    results.some((result) => result.status === 'replay'),
    'Concurrent native refresh did not detect replay',
  );
  assert.ok(
    storage.refreshTokenFamilyRepository.findByToken(refreshToken)?.status === 'revoked',
    'Native refresh replay did not revoke the family',
  );
  const expectedExport = snapshot(storage, ids);
  storage.shutdown();
  storage = undefined;
  assertProtected();
  stage = 'revocation after executable restart';
  await startAndStop(true);
  await openNative();
  assert.deepEqual(snapshot(storage, ids), expectedExport, 'Native restart lost consumption or revocation');
  storage.shutdown();
  storage = undefined;
  references = refs();

  stage = 'unconfirmed export';
  const refused = run(['auth', 'export-upstream-credentials']);
  assert.ok(refused.status !== 0 && !fs.existsSync(sessionFile), 'Unconfirmed export wrote plaintext');
  stage = 'confirmed both-domain export';
  const exported = run(['auth', 'export-upstream-credentials', '--confirm-plaintext-export']);
  assert.ok(exported.status === 0, 'Confirmed synthetic export failed');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(upstreamSource, 'utf8')),
    upstreamPayload,
    'Both-domain export omitted upstream state',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(sessionFile, 'utf8')),
    sessionData,
    'Export changed whole-record session extensions',
  );
  await openFile();
  assert.deepEqual(snapshot(storage, ids), expectedExport, 'Export changed inbound security state');
  assert.ok(fs.readFileSync(temporaryFile, 'utf8') === temporaryText, 'Export changed opaque temporary');
  assert.ok(refs().length === 0, 'Export left protected-record references');
  for (const ref of references)
    for (let index = 0; index < ref.chunks; index++) {
      assert.ok(native.read(chunkKey(ref, index)) === null, 'Export left a native chunk');
    }
  for (const file of files(scope))
    assert.ok(
      !fs.readFileSync(file, 'utf8').includes(refreshToken),
      'Export introduced inbound refresh-token plaintext',
    );
  storage.shutdown();
  storage = undefined;
  stage = 'executable inbound failure containment and independent Admin';
  const admin = new AdminIdentityService({ runtimeScopeId: scopeId, storageDir: scope, sessionTtlMs: 3600000 });
  await admin.bootstrapFirstAdmin({ username: 'synthetic-operator', password: adminPassword });
  blockedMetadata = path.join(base, 'sessions', 'server', '.native-oauth');
  metadataBackup = `${blockedMetadata}.synthetic-backup`;
  fs.renameSync(blockedMetadata, metadataBackup);
  fs.writeFileSync(blockedMetadata, 'synthetic unavailable metadata directory', { mode: 0o600 });
  // Keep the deliberately exported upstream fixture outside managed layouts, so
  // this containment startup does not create fresh native credentials to clean.
  exportedUpstreamBackup = path.join(scope, 'exported-upstream.synthetic-backup');
  fs.renameSync(upstreamSource, exportedUpstreamBackup);
  const failedOrigin = await startRuntime(true, false);
  const login = await fetch(`${failedOrigin}/admin/cli/v1/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'synthetic-operator', password: adminPassword }),
    signal: AbortSignal.timeout(15000),
  });
  const loginBody = await login.json();
  adminSessionToken = loginBody?.result?.sessionToken;
  assert.ok(
    login.status === 200 && typeof adminSessionToken === 'string' && adminSessionToken.length > 0,
    'Independent Admin login failed during inbound native outage',
  );
  const status = await fetch(`${failedOrigin}/admin/cli/v1/session/status`, {
    headers: { authorization: `Bearer ${adminSessionToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const statusBody = await status.json();
  assert.ok(
    status.status === 200 && statusBody?.result?.authenticated === true,
    'Independent Admin session unavailable during inbound native outage',
  );
  const refusedGrant = await fetch(`${failedOrigin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      grant_type: 'authorization_code',
      code: consent.authCode,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const refusedBody = await refusedGrant.json();
  assert.ok(
    refusedGrant.status >= 400 && !refusedBody.access_token && !refusedBody.refresh_token,
    'Unavailable inbound native store issued an OAuth token',
  );
  const deniedMcp = await fetch(`${failedOrigin}/mcp`, {
    headers: { authorization: `Bearer ${AUTH_CONFIG.SERVER.TOKEN.ID_PREFIX}${accessId}` },
    signal: AbortSignal.timeout(15000),
  });
  const deniedMcpBody = await deniedMcp.json();
  const safeServerError = deniedMcp.status === 500 && deniedMcpBody?.error === 'server_error';
  assert.ok(
    safeServerError || deniedMcp.status === 401 || deniedMcp.status === 503,
    'Unavailable inbound native store returned an unexpected MCP denial response',
  );
  stop();
  fs.unlinkSync(blockedMetadata);
  fs.renameSync(metadataBackup, blockedMetadata);
  blockedMetadata = undefined;
  metadataBackup = undefined;
  fs.renameSync(exportedUpstreamBackup, upstreamSource);
  exportedUpstreamBackup = undefined;
  assert.ok(refs().length === 0, 'Failure containment left native references');
  for (const ref of references)
    for (let index = 0; index < ref.chunks; index++) {
      assert.ok(native.read(chunkKey(ref, index)) === null, 'Failure containment revived a native chunk');
    }
  for (const file of files(scope).filter((file) => file.endsWith('.log'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(
      !text.includes(adminPassword) && !text.includes(adminSessionToken),
      'Failure containment logs exposed Admin credentials',
    );
  }
  clean = true;
  console.log(
    `Inbound native smoke passed: ${process.platform}, ${binary ? 'SEA' : 'Node'}, all security records, whole-record extensions, digest-only refresh, opaque temporary, automatic migration with auth disabled, enabled restart, executable code redemption and family-bound access rejection, consent consumption, concurrent refresh/replay revocation, confirmation, verified export, native cleanup, failed-domain OAuth refusal and independent authenticated Admin access.`,
  );
} catch (error) {
  process.exitCode = 1;
  // Never print provider errors or assertion actual/expected payloads.
  const reason = error instanceof assert.AssertionError && !error.generatedMessage ? `: ${error.message}` : '';
  console.error(`Synthetic inbound native smoke failed at ${stage}${reason}. Retained scope: ${scope}`);
} finally {
  storage?.shutdown();
  if (running) {
    const stopped = run(['serve', '--stop']);
    running = stopped.status !== 0;
  }
  if (!running && metadataBackup && blockedMetadata) {
    fs.unlinkSync(blockedMetadata);
    fs.renameSync(metadataBackup, blockedMetadata);
  }
  if (!running && exportedUpstreamBackup) fs.renameSync(exportedUpstreamBackup, upstreamSource);
  // Failed runs retain recovery references: no speculative deletion of unpublished
  // native revisions. Export the reported scope after resolving the failure.
  if (clean && !running) fs.rmSync(scope, { recursive: true, force: true });
}
