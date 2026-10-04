import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Synthetic scope only, no listing or reading pre-existing user credentials.
const args = process.argv.slice(2);
if (!args.includes('--allow-native-write')) {
  console.error('Pass --allow-native-write to test synthetic upstream credentials.');
  process.exit(2);
}
const binaryIndex = args.indexOf('--binary');
const binary = binaryIndex < 0 ? undefined : args[binaryIndex + 1];
if (binaryIndex >= 0 && !binary) throw new Error('--binary requires an executable path');
const executable = binary ? path.resolve(binary) : process.execPath;
const prefix = binary ? [] : [path.resolve('build/index.js')];
const { DockerNativeCredentialStore } = await import(
  pathToFileURL(path.resolve('build/auth/storage/nativeCredentialStore.js')).href
);
const native = new DockerNativeCredentialStore();
const scope = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-native-smoke-'));
const base = path.join(scope, 'state');
const directory = path.join(scope, 'clientSessions', 'sessions', 'client');
const metadata = path.join(directory, '.native-oauth');
const id = randomBytes(32).toString('hex');
const filename = `oauth-bound-${id}.json`;
const source = path.join(directory, filename);
const secret = randomBytes(3000).toString('base64');
const payload = {
  createdAt: Date.now(),
  expires: Date.now() + 3600000,
  tokens: JSON.stringify({ access_token: secret, refresh_token: secret, token_type: 'Bearer' }),
  clientInfo: JSON.stringify({ client_secret: secret }),
  attempts: { synthetic: { verifier: secret } },
};
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('ONE_MCP_')) delete env[key];
let running = false;
let clean = false;
let stage = 'prepare';
let references = [];

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
  assert.ok(!result.stdout?.includes(secret) && !result.stderr?.includes(secret), 'CLI exposed synthetic secret');
  return result;
}
function refs() {
  if (!fs.existsSync(metadata)) return [];
  return fs
    .readdirSync(metadata)
    .filter((name) => name.endsWith('.ref'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(metadata, name), 'utf8')));
}
function chunkKey(ref, index) {
  return `https://oauth.1mcp.invalid/${ref.scope}/${ref.record}/${ref.revision}/${index}`;
}
function readPayload(ref) {
  let encoded = '';
  for (let i = 0; i < ref.chunks; i++) encoded += native.read(chunkKey(ref, i)) ?? '';
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')).payload;
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
async function migrate() {
  running = true;
  const started = run([
    'serve',
    '--background',
    '--credential-store',
    'native',
    '--port',
    String(await freePort()),
    '--host',
    '127.0.0.1',
  ]);
  assert.ok(started.status === 0, 'Synthetic runtime startup failed');
  const stopped = run(['serve', '--stop']);
  assert.ok(stopped.status === 0, 'Synthetic runtime stop failed');
  running = false;
  references = refs();
  assert.ok(references.length === 1, 'Expected one migrated synthetic record');
  assert.ok(!fs.existsSync(source), 'Native startup left synthetic plaintext source');
  for (const name of fs.readdirSync(metadata))
    assert.ok(
      !fs.readFileSync(path.join(metadata, name), 'utf8').includes(secret),
      'Native metadata exposed synthetic secret',
    );
}
try {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(scope, 'mcp.json'), '{"mcpServers":{}}', { mode: 0o600 });
  fs.writeFileSync(source, JSON.stringify(payload), { mode: 0o600 });
  stage = 'native startup';
  await migrate();
  assert.ok(JSON.stringify(readPayload(references[0])) === JSON.stringify(payload), 'Migrated payload mismatch');
  stage = 'newer file revision';
  payload.tokens = JSON.stringify({ access_token: `${secret}updated`, refresh_token: secret, token_type: 'Bearer' });
  fs.writeFileSync(source, JSON.stringify(payload), { mode: 0o600 });
  await migrate();
  assert.ok(
    JSON.stringify(readPayload(references[0])) === JSON.stringify(payload),
    'Newer file credential was not migrated',
  );
  stage = 'confirmation';
  const refused = run(['auth', 'export-upstream-credentials']);
  assert.ok(refused.status !== 0 && !fs.existsSync(source), 'Unconfirmed export wrote plaintext');
  stage = 'export';
  const exported = run(['auth', 'export-upstream-credentials', '--confirm-plaintext-export']);
  assert.ok(exported.status === 0, 'Confirmed synthetic export failed');
  assert.ok(
    JSON.stringify(JSON.parse(fs.readFileSync(source, 'utf8'))) === JSON.stringify(payload),
    'Exported payload mismatch',
  );
  for (const ref of references)
    for (let i = 0; i < ref.chunks; i++)
      assert.ok(native.read(chunkKey(ref, i)) === null, 'Export left a native chunk');
  assert.ok(refs().length === 0, 'Export left native references');
  clean = true;
  console.log(
    `Upstream native smoke passed: ${process.platform}, ${binary ? 'SEA' : 'Node'}, migration, multi-chunk secrets, restart, newer revision, confirmation, verified export and native cleanup.`,
  );
} catch {
  process.exitCode = 1;
  console.error(`Synthetic upstream native smoke failed at ${stage}. Inspect the retained synthetic scope: ${scope}`);
} finally {
  if (running) {
    const stopped = run(['serve', '--stop']);
    running = stopped.status !== 0;
  }
  if (!running && !clean) {
    try {
      for (const ref of refs()) for (let i = 0; i < ref.chunks; i++) native.delete(chunkKey(ref, i));
      // Preserve files/intents for failures: an interrupted write may own unpublished chunks.
    } catch {
      console.error(`Synthetic native cleanup incomplete; recovery scope: ${scope}`);
    }
  }
  if (clean && !running) fs.rmSync(scope, { recursive: true, force: true });
}
