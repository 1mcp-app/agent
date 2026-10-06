import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit opt-in only. Tests one fresh synthetic key; never lists credentials
// or reads existing OAuth records. Run after pnpm build:
// node scripts/security/native-credential-store-smoke.mjs --allow-native-write
// --module selects a different compiled adapter for distribution verification.
const args = process.argv.slice(2);
if (!args.includes('--allow-native-write')) {
  console.error(
    'Native credential smoke requires --allow-native-write to create and remove synthetic OS-store entries.',
  );
  process.exit(2);
}

const moduleIndex = args.indexOf('--module');
const modulePath = moduleIndex === -1 ? 'build/auth/storage/nativeCredentialStore.js' : args[moduleIndex + 1];
if (!modulePath) {
  console.error('Provide the compiled native credential adapter path after --module.');
  process.exit(2);
}

let store;
let key;
let attemptedWrite = false;
let failure = false;
let stage = 'load';
try {
  const { DockerNativeCredentialStore, NATIVE_CREDENTIAL_MAX_SECRET_BYTES } = await import(
    pathToFileURL(path.resolve(modulePath)).href
  );
  store = new DockerNativeCredentialStore();
  key = `https://oauth.1mcp.invalid/smoke/${randomBytes(32).toString('hex')}/revision/0`;
  const firstSecret = randomBytes(NATIVE_CREDENTIAL_MAX_SECRET_BYTES / 2).toString('hex');
  const refreshedSecret = randomBytes(NATIVE_CREDENTIAL_MAX_SECRET_BYTES / 2).toString('hex');
  stage = 'missing';
  assert.equal(store.read(key), null);
  attemptedWrite = true;
  stage = 'write';
  store.write(key, firstSecret);
  // Assertions intentionally avoid embedding secret-bearing actual/expected data.
  stage = 'read';
  assert.ok(store.read(key) === firstSecret, 'Synthetic native write/read mismatch.');
  stage = 'recreate';
  store = new DockerNativeCredentialStore();
  assert.ok(store.read(key) === firstSecret, 'Synthetic native entry did not survive adapter recreation.');
  stage = 'refresh';
  store.write(key, refreshedSecret);
  assert.ok(store.read(key) === refreshedSecret, 'Synthetic native refresh mismatch.');
  stage = 'delete';
  store.delete(key);
  assert.equal(store.read(key), null);
  attemptedWrite = false;
  console.log(
    `Native credential smoke passed on ${process.platform}: missing, write, read, recreate, refresh, delete.`,
  );
} catch (error) {
  failure = true;
  // Print only the fixed safe adapter error code, never a thrown message/cause.
  const code = error?.name === 'NativeCredentialStoreError' ? error.code : 'smoke_failed';
  console.error(
    `Native credential smoke failed at ${stage} (${code}). Check helper installation, OS-store access, and user session.`,
  );
} finally {
  if (attemptedWrite && store && key) {
    try {
      store.delete(key);
      assert.equal(store.read(key), null);
    } catch {
      failure = true;
      console.error(
        'Synthetic native entry cleanup failed. Unlock the OS credential store and erase this synthetic key:',
      );
      console.error(key);
    }
  }
}
if (failure) process.exitCode = 1;
