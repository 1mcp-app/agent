import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

import { z } from 'zod';

export interface NativeCredentialStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
  delete(key: string): void;
}

export const NATIVE_CREDENTIAL_MAX_SECRET_BYTES = 1800;
const HELPER_TIMEOUT_MS = 10_000;
const HELPER_MAX_OUTPUT_BYTES = 16_384;
const CREDENTIALS_NOT_FOUND = 'credentials not found in native keychain';

export type NativeCredentialStoreErrorCode =
  | 'unsupported_platform'
  | 'invalid_key'
  | 'invalid_secret'
  | 'secret_too_large'
  | 'helper_unavailable'
  | 'helper_timeout'
  | 'helper_failed'
  | 'invalid_response';

const ERROR_MESSAGES: Record<NativeCredentialStoreErrorCode, string> = {
  unsupported_platform:
    'Native OAuth storage requires macOS, Windows, or Linux. Select file storage explicitly if needed.',
  invalid_key: 'Native OAuth storage received an invalid credential key. Check the credential storage configuration.',
  invalid_secret:
    'Native OAuth storage requires a nonempty UTF-8 secret without NUL characters. Reauthorize the connection.',
  secret_too_large: 'Native OAuth storage received a secret exceeding its per-entry limit. Check credential chunking.',
  helper_unavailable:
    'Native OAuth storage could not start its platform Docker credential helper. Install the helper on PATH and allow it to execute.',
  helper_timeout:
    'Native OAuth storage timed out. Unlock the OS credential store, allow access, and check the user-session credential service.',
  helper_failed:
    'Native OAuth storage failed. Unlock the OS credential store, allow access, and check the platform Docker credential helper and user-session service.',
  invalid_response:
    'Native OAuth storage returned an invalid credential response. Check the platform Docker credential helper and reauthorize if necessary.',
};

/** Contains no raw helper output, input, key, secret, or original error cause. */
export class NativeCredentialStoreError extends Error {
  constructor(public readonly code: NativeCredentialStoreErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = 'NativeCredentialStoreError';
  }
}

export interface NativeCredentialHelperResult {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  error?: unknown;
}

/** Injection boundary for tests, not a configurable credential-store plugin. */
export type NativeCredentialHelperRunner = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => NativeCredentialHelperResult;

const HelperCredentialSchema = z.object({
  Username: z.literal('1mcp'),
  Secret: z.string(),
  ServerURL: z.string().optional(),
});

/**
 * Uses Docker's native helpers directly; the helper executable must be installed
 * on PATH. Linux also requires a working, unlocked user-session Secret Service.
 * Secrets travel only through stdin/stdout, never command arguments or files.
 *
 * Protocol and canonical missing response:
 * https://github.com/docker/docker-credential-helpers/blob/master/credentials/credentials.go
 * https://github.com/docker/docker-credential-helpers/blob/master/credentials/error.go
 */
export class DockerNativeCredentialStore implements NativeCredentialStore {
  private readonly command: string;
  private readonly runner: NativeCredentialHelperRunner;

  constructor(options: { platform?: string; runner?: NativeCredentialHelperRunner } = {}) {
    this.command = helperForPlatform(options.platform ?? process.platform);
    this.runner = options.runner ?? spawnSync;
  }

  read(key: string): string | null {
    validateKey(key);
    const output = this.run('get', key);
    if (output === null) return null;

    let decoded: unknown;
    try {
      decoded = JSON.parse(output);
    } catch {
      throw new NativeCredentialStoreError('invalid_response');
    }
    const response = HelperCredentialSchema.safeParse(decoded);
    if (!response.success) throw new NativeCredentialStoreError('invalid_response');
    if (response.data.ServerURL !== undefined && response.data.ServerURL !== key) {
      throw new NativeCredentialStoreError('invalid_response');
    }
    if (!isPortableSecret(response.data.Secret)) throw new NativeCredentialStoreError('invalid_response');
    if (Buffer.byteLength(response.data.Secret, 'utf8') > NATIVE_CREDENTIAL_MAX_SECRET_BYTES) {
      throw new NativeCredentialStoreError('invalid_response');
    }
    return response.data.Secret;
  }

  write(key: string, value: string): void {
    validateKey(key);
    if (!isPortableSecret(value)) throw new NativeCredentialStoreError('invalid_secret');
    if (Buffer.byteLength(value, 'utf8') > NATIVE_CREDENTIAL_MAX_SECRET_BYTES) {
      throw new NativeCredentialStoreError('secret_too_large');
    }
    this.run('store', JSON.stringify({ ServerURL: key, Username: '1mcp', Secret: value }));
  }

  delete(key: string): void {
    validateKey(key);
    this.run('erase', key);
  }

  private run(action: 'get' | 'store' | 'erase', input: string): string | null {
    let result: NativeCredentialHelperResult;
    try {
      result = this.runner(this.command, [action], {
        input,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: HELPER_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: HELPER_MAX_OUTPUT_BYTES,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      throw sanitizedHelperError(error);
    }
    if (result.error) throw sanitizedHelperError(result.error);
    if (result.signal) throw new NativeCredentialStoreError('helper_failed');
    if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
      throw new NativeCredentialStoreError('invalid_response');
    }
    if (Buffer.byteLength(result.stdout, 'utf8') > HELPER_MAX_OUTPUT_BYTES) {
      throw new NativeCredentialStoreError('invalid_response');
    }
    if (Buffer.byteLength(result.stderr, 'utf8') > HELPER_MAX_OUTPUT_BYTES) {
      throw new NativeCredentialStoreError('invalid_response');
    }
    // Serve prints canonical errors on stdout and exits 1. Never classify a
    // denied/locked/unavailable store from fuzzy matches or stderr content.
    if (result.status === 1 && result.stdout.trim() === CREDENTIALS_NOT_FOUND && result.stderr === '') {
      if (action !== 'store') return null;
    }
    if (result.status !== 0) throw new NativeCredentialStoreError('helper_failed');
    if (result.stderr !== '') throw new NativeCredentialStoreError('helper_failed');
    if (action !== 'get' && result.stdout.trim() !== '') {
      throw new NativeCredentialStoreError('invalid_response');
    }
    return result.stdout;
  }
}

function helperForPlatform(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'docker-credential-osxkeychain';
    case 'win32':
      return 'docker-credential-wincred.exe';
    case 'linux':
      return 'docker-credential-secretservice';
    default:
      throw new NativeCredentialStoreError('unsupported_platform');
  }
}

function sanitizedHelperError(error: unknown): NativeCredentialStoreError {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    return new NativeCredentialStoreError('helper_unavailable');
  }
  if (code === 'ETIMEDOUT') return new NativeCredentialStoreError('helper_timeout');
  return new NativeCredentialStoreError('helper_failed');
}

function isPortableSecret(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return false;
  // Reject lone surrogates rather than let UTF-8 encoding change the secret.
  return Buffer.from(value, 'utf8').toString('utf8') === value;
}

function validateKey(key: string): void {
  // Opaque keys are generated by the storage coordinator. A nonempty path and
  // no query/fragment avoid platform helper URL normalization collisions.
  if (typeof key !== 'string' || Buffer.byteLength(key, 'utf8') > 2048) {
    throw new NativeCredentialStoreError('invalid_key');
  }
  if (!/^https:\/\/oauth\.1mcp\.invalid\/[-a-zA-Z0-9/_]+$/.test(key)) {
    throw new NativeCredentialStoreError('invalid_key');
  }
  let parsed: URL;
  try {
    parsed = new URL(key);
  } catch {
    throw new NativeCredentialStoreError('invalid_key');
  }
  if (parsed.href !== key || parsed.pathname === '/') throw new NativeCredentialStoreError('invalid_key');
}
