import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import {
  DockerNativeCredentialStore,
  NATIVE_CREDENTIAL_MAX_SECRET_BYTES,
  type NativeCredentialHelperResult,
  type NativeCredentialHelperRunner,
  NativeCredentialStoreError,
  type NativeCredentialStoreErrorCode,
} from './nativeCredentialStore.js';

const KEY = 'https://oauth.1mcp.invalid/scope/credential/generation/chunk';
const SECRET = 'synthetic-token-DO-NOT-LEAK';
const MISSING = 'credentials not found in native keychain';

function helperResult(overrides: Partial<NativeCredentialHelperResult> = {}): NativeCredentialHelperResult {
  return { status: 0, signal: null, stdout: '', stderr: '', ...overrides };
}

function credentialResult(overrides: Record<string, unknown> = {}): NativeCredentialHelperResult {
  return helperResult({ stdout: JSON.stringify({ Username: '1mcp', Secret: SECRET, ServerURL: KEY, ...overrides }) });
}

function makeStore(result: NativeCredentialHelperResult = credentialResult()) {
  const runner = vi.fn<NativeCredentialHelperRunner>(() => result);
  return { store: new DockerNativeCredentialStore({ platform: 'darwin', runner }), runner };
}

function expectSafeError(operation: () => unknown, code: NativeCredentialStoreErrorCode): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(NativeCredentialStoreError);
  expect(caught).toMatchObject({ code });
  expect(inspect(caught)).not.toContain(SECRET);
  expect(inspect(caught)).not.toContain(KEY);
  expect(JSON.stringify(caught)).not.toContain(SECRET);
  expect(caught).not.toHaveProperty('cause');
}

describe('DockerNativeCredentialStore', () => {
  it.each([
    ['darwin', 'docker-credential-osxkeychain'],
    ['win32', 'docker-credential-wincred.exe'],
    ['linux', 'docker-credential-secretservice'],
  ] as const)('selects the fixed helper for %s', (platform, command) => {
    const runner = vi.fn<NativeCredentialHelperRunner>(() => credentialResult());
    const store = new DockerNativeCredentialStore({ platform, runner });
    expect(store.read(KEY)).toBe(SECRET);
    expect(runner.mock.calls[0][0]).toBe(command);
  });

  it('fails closed on unsupported platforms', () => {
    const runner = vi.fn<NativeCredentialHelperRunner>();
    expectSafeError(() => new DockerNativeCredentialStore({ platform: 'freebsd', runner }), 'unsupported_platform');
    expect(runner).not.toHaveBeenCalled();
  });

  it('sends write secrets only in stdin JSON and bounds the helper process', () => {
    const { store, runner } = makeStore(helperResult());
    const value = `${SECRET}\n"\\雪`;
    store.write(KEY, value);
    const [command, args, options] = runner.mock.calls[0];
    expect(command).not.toContain(SECRET);
    expect(args).toEqual(['store']);
    expect(args.join(' ')).not.toContain(value);
    expect(JSON.parse(String(options.input))).toEqual({ ServerURL: KEY, Username: '1mcp', Secret: value });
    expect(options).not.toHaveProperty('env');
    expect(options).not.toHaveProperty('cwd');
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 10_000,
      killSignal: 'SIGKILL',
      maxBuffer: 16_384,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('uses raw URL stdin for reads and deletes, never listing the native store', () => {
    const runner = vi
      .fn<NativeCredentialHelperRunner>()
      .mockReturnValueOnce(credentialResult())
      .mockReturnValueOnce(helperResult());
    const store = new DockerNativeCredentialStore({ platform: 'darwin', runner });
    expect(store.read(KEY)).toBe(SECRET);
    store.delete(KEY);
    expect(runner.mock.calls.map(([, args]) => args)).toEqual([['get'], ['erase']]);
    expect(runner.mock.calls.map(([, , options]) => options.input)).toEqual([KEY, KEY]);
  });

  it('accepts the Docker response when ServerURL is omitted', () => {
    const { store } = makeStore(credentialResult({ ServerURL: undefined }));
    expect(store.read(KEY)).toBe(SECRET);
  });

  it.each([MISSING, `${MISSING}\n`, ` ${MISSING}\r\n`])('recognizes only canonical missing output: %j', (stdout) => {
    const { store, runner } = makeStore(helperResult({ status: 1, stdout }));
    expect(store.read(KEY)).toBeNull();
    expect(() => store.delete(KEY)).not.toThrow();
    expect(runner).toHaveBeenCalledTimes(2);
    expectSafeError(() => store.write(KEY, SECRET), 'helper_failed');
  });

  it.each([
    { status: 0, stdout: MISSING },
    { status: 2, stdout: MISSING },
    { status: 1, stdout: `${MISSING}: ${SECRET}` },
    { status: 1, stdout: `error: ${MISSING}` },
    { status: 1, stdout: '', stderr: MISSING },
    { status: 1, stdout: MISSING, stderr: 'access denied' },
    { status: 1, stdout: MISSING, signal: 'SIGKILL' as const },
    { status: null, stdout: MISSING },
    { status: 1, stdout: 'User interaction is not allowed. (-25308)' },
    { status: 1, stdout: `access denied ${SECRET}` },
    { status: 1, stdout: `Secret Service is unavailable ${SECRET}` },
  ])('never treats helper failures as absence or plaintext fallback: %j', (result) => {
    const { store } = makeStore(helperResult(result));
    const expected = result.status === 0 ? 'invalid_response' : 'helper_failed';
    expectSafeError(() => store.read(KEY), expected);
  });

  it.each(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ENOBUFS', 'UNKNOWN'])('sanitizes spawn errors: %s', (code) => {
    const error = Object.assign(new Error(`${SECRET} ${KEY}`), { code, stdout: SECRET, stderr: SECRET });
    const { store } = makeStore(helperResult({ status: null, error, stdout: MISSING }));
    const expected =
      code === 'ETIMEDOUT'
        ? 'helper_timeout'
        : ['ENOENT', 'EACCES', 'EPERM'].includes(code)
          ? 'helper_unavailable'
          : 'helper_failed';
    expectSafeError(() => store.read(KEY), expected);
    expectSafeError(() => store.write(KEY, SECRET), expected);
    expectSafeError(() => store.delete(KEY), expected);
  });

  it('sanitizes thrown errors without retaining their secret-bearing cause', () => {
    const runner: NativeCredentialHelperRunner = () => {
      throw new Error(`${SECRET} ${KEY}`);
    };
    const store = new DockerNativeCredentialStore({ platform: 'darwin', runner });
    expectSafeError(() => store.write(KEY, SECRET), 'helper_failed');
  });

  it.each([
    {},
    { Username: 'someone-else', Secret: SECRET },
    { Username: '1mcp', Secret: 42 },
    { Username: '1mcp', Secret: null },
    { Username: '1mcp', Secret: SECRET, ServerURL: `${KEY}-other` },
    { Username: '1mcp', Secret: SECRET, ServerURL: null },
    { Username: '1mcp', Secret: '' },
    { Username: '1mcp', Secret: '\0' },
    { Username: '1mcp', Secret: '\ud800' },
    { Username: '1mcp', Secret: 'x'.repeat(NATIVE_CREDENTIAL_MAX_SECRET_BYTES + 1) },
    null,
    ['1mcp', SECRET],
  ])('rejects malformed or mismatched credential responses: %j', (response) => {
    const { store } = makeStore(helperResult({ stdout: JSON.stringify(response) }));
    expectSafeError(() => store.read(KEY), 'invalid_response');
  });

  it.each(['', SECRET, `{ "Secret": "${SECRET}"`, `${JSON.stringify({ Username: '1mcp', Secret: SECRET })} trailing`])(
    'rejects invalid JSON without disclosing input: %j',
    (stdout) => {
      const { store } = makeStore(helperResult({ stdout }));
      expectSafeError(() => store.read(KEY), 'invalid_response');
    },
  );

  it('does not accept a successful response with helper diagnostics on stderr', () => {
    const { store } = makeStore({ ...credentialResult(), stderr: SECRET });
    expectSafeError(() => store.read(KEY), 'helper_failed');
  });

  it.each(['store', 'erase'] as const)('rejects unexpected successful %s output', (action) => {
    const { store } = makeStore(helperResult({ stdout: SECRET }));
    expectSafeError(() => (action === 'store' ? store.write(KEY, SECRET) : store.delete(KEY)), 'invalid_response');
  });

  it.each(['stdout', 'stderr'] as const)('bounds %s even with an injected runner', (stream) => {
    const { store } = makeStore(helperResult({ [stream]: 'x'.repeat(16_385) }));
    expectSafeError(() => store.read(KEY), 'invalid_response');
  });

  it('preserves exactly the maximum UTF-8 byte size', () => {
    const value = '雪'.repeat(NATIVE_CREDENTIAL_MAX_SECRET_BYTES / 3);
    const { store, runner } = makeStore(helperResult());
    store.write(KEY, value);
    expect(JSON.parse(String(runner.mock.calls[0][2].input)).Secret).toBe(value);
    runner.mockReturnValue(credentialResult({ Secret: value }));
    expect(store.read(KEY)).toBe(value);
  });

  it.each(['x'.repeat(1801), '雪'.repeat(601)])('rejects oversized UTF-8 secrets before spawning', (value) => {
    const { store, runner } = makeStore();
    expectSafeError(() => store.write(KEY, value), 'secret_too_large');
    expect(runner).not.toHaveBeenCalled();
  });

  it.each(['', '\0', 'before\0after', '\ud800'])('rejects secrets the helpers cannot preserve: %j', (value) => {
    const { store, runner } = makeStore();
    expectSafeError(() => store.write(KEY, value), 'invalid_secret');
    expect(runner).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'https://example.com/credential',
    'https://another-1mcp.invalid/credential',
    'http://oauth.1mcp.invalid/credential',
    'https://oauth.1mcp.invalid/',
    'https://oauth.1mcp.invalid',
    'https://oauth.1mcp.invalid/../credential',
    'https://oauth.1mcp.invalid/credential?token=secret',
    'https://oauth.1mcp.invalid/credential#fragment',
    'https://user:password@oauth.1mcp.invalid/credential',
    'https://oauth.1mcp.invalid:443/credential',
    'https://oauth.1mcp.invalid/credential\n',
    `https://oauth.1mcp.invalid/${'x'.repeat(2048)}`,
  ])('rejects invalid or ambiguous keys before touching credentials: %j', (key) => {
    const { store, runner } = makeStore();
    expectSafeError(() => store.read(key), 'invalid_key');
    expectSafeError(() => store.write(key, SECRET), 'invalid_key');
    expectSafeError(() => store.delete(key), 'invalid_key');
    expect(runner).not.toHaveBeenCalled();
  });
});
