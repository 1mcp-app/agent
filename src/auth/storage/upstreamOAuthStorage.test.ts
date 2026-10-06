import { createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SDKOAuthClientProvider } from '@src/auth/sdkOAuthClientProvider.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileStorageService } from './fileStorageService.js';
import { type NativeCredentialStore, NativeCredentialStoreError } from './nativeCredentialStore.js';
import {
  activateUpstreamOAuthStore,
  createUpstreamOAuthStorage,
  UpstreamOAuthStorage,
} from './upstreamOAuthStorage.js';

class MemoryStore implements NativeCredentialStore {
  entries = new Map<string, string>();
  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }
  write(key: string, value: string): void {
    this.entries.set(key, value);
  }
  delete(key: string): void {
    this.entries.delete(key);
  }
}
const directories: string[] = [];
const storages: FileStorageService[] = [];
const slot = 'a'.repeat(64);
const data = (token = 'private-access-secret') => ({
  expires: Date.now() + 60_000,
  createdAt: Date.now(),
  generation: 'generation-one',
  revision: 7,
  tokens: { access_token: token, refresh_token: 'private-refresh-secret' },
  clientInfo: { registration_access_token: 'registration-secret', client_secret: 'client-secret' },
  attempts: { pending: { verifier: 'private-pkce'.repeat(7), consumed: false } },
});
function directory() {
  const result = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-native-'));
  directories.push(result);
  return result;
}
function storage(baseDir: string, mode: 'file' | 'native', nativeStore: MemoryStore) {
  const result = new UpstreamOAuthStorage({ baseDir, mode, nativeStore });
  storages.push(result);
  return result;
}
function plaintext(baseDir: string, value = data()) {
  const result = new FileStorageService(baseDir, 'client');
  storages.push(result);
  result.writeDataDurable('oauth-bound-', slot, value);
  return result.getFilePath('oauth-bound-', slot);
}
function files(directory: string): string {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? files(target) : fs.readFileSync(target, 'utf8');
    })
    .join('\n');
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const instance of storages.splice(0)) instance.shutdown();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('upstream native record persistence', () => {
  it('migrates the whole record, including registration and PKCE, without managed plaintext', async () => {
    const base = directory();
    const value = data();
    const source = plaintext(base, value);
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    await target.activate();
    expect(target.readData('oauth-bound-', slot)).toEqual(value);
    expect(fs.existsSync(source)).toBe(false);
    expect(files(base)).not.toContain('private-');
    expect(files(base)).not.toContain('registration-secret');
    expect(files(base)).not.toContain('client-secret');
    expect(target.cleanupExpiredData()).toBe(0);
    expect(native.entries.size).toBeGreaterThan(0);
  });

  it('chunks large records into portable immutable entries and verifies identity and content', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    await target.activate();
    const value = data('非ASCII'.repeat(8000));
    await target.withExclusiveLock('oauth-test', () => target.writeDataDurable('oauth-bound-', slot, value));
    expect(target.readData('oauth-bound-', slot)).toEqual(value);
    expect([...native.entries.values()].every((value) => Buffer.byteLength(value) <= 1800)).toBe(true);
    const key = [...native.entries.keys()][0];
    native.entries.set(key, Buffer.from('wrong envelope').toString('base64'));
    expect(() => target.readData('oauth-bound-', slot)).toThrow(/incomplete/);
  });

  it('isolates identical record names across canonical scope directories', async () => {
    const native = new MemoryStore();
    const first = storage(directory(), 'native', native);
    const second = storage(directory(), 'native', native);
    await first.activate();
    await second.activate();
    await first.withExclusiveLock('oauth-test', () => first.writeDataDurable('oauth-bound-', slot, data('first')));
    await second.withExclusiveLock('oauth-test', () => second.writeDataDurable('oauth-bound-', slot, data('second')));
    await first.withExclusiveLock('oauth-test', () => first.deleteData('oauth-bound-', slot));
    expect(second.readData('oauth-bound-', slot)).toMatchObject({ tokens: { access_token: 'second' } });
  });

  it('fails strictly on native read/write failure and redacts backend diagnostics', async () => {
    const base = directory();
    const source = plaintext(base);
    const native = new MemoryStore();
    vi.spyOn(native, 'write').mockImplementation(() => {
      throw new Error('sensitive helper stdout private-access-secret');
    });
    const target = storage(base, 'native', native);
    await expect(target.activate()).rejects.toThrow(/incomplete/);
    expect(fs.existsSync(source)).toBe(true);
    expect(() => target.readData('oauth-bound-', slot)).toThrow(/incomplete/);
    try {
      await target.activate();
    } catch (error) {
      expect(String(error)).not.toContain('private-access-secret');
    }
  });

  it.each(['before-write', 'after-verification', 'source-cleanup'] as const)(
    'resumes migration interrupted at %s',
    async (stage) => {
      const base = directory();
      const original = data();
      const source = plaintext(base, original);
      const native = new MemoryStore();
      const target = storage(base, 'native', native);
      if (stage === 'before-write')
        vi.spyOn(native, 'write').mockImplementationOnce(() => {
          throw new Error('unavailable');
        });
      if (stage === 'after-verification') {
        const rename = fs.renameSync;
        vi.spyOn(fs, 'renameSync').mockImplementation((oldPath, newPath) => {
          if (String(newPath).endsWith('.ref')) throw new Error('disk full');
          rename(oldPath, newPath);
        });
      }
      if (stage === 'source-cleanup') {
        const unlink = fs.unlinkSync;
        vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
          if (String(file) === source) throw new Error('permission denied');
          unlink(file);
        });
      }
      await expect(target.activate()).rejects.toThrow();
      expect(fs.existsSync(source)).toBe(true);
      vi.restoreAllMocks();
      const restarted = storage(base, 'native', native);
      await restarted.activate();
      expect(restarted.readData('oauth-bound-', slot)).toEqual(original);
      expect(fs.existsSync(source)).toBe(false);
      expect(files(base)).not.toContain('private-access-secret');
      const count = native.entries.size;
      await restarted.activate();
      expect(native.entries.size).toBe(count);
    },
  );

  it('inventories expired quarantine, legacy layout and abandoned temporary records without binding them', async () => {
    const base = directory();
    const plain = new FileStorageService(base, 'client');
    storages.push(plain);
    plain.writeDataDurable('oauth-quarantine-', slot, { ...data(), expires: 1 });
    const temporary = plain.getFilePath('oauth-bound-', slot) + '.123.orphan.tmp';
    fs.writeFileSync(temporary, JSON.stringify(data('rollback-private')), { mode: 0o600 });
    const legacy = path.join(base, 'clientSessions');
    fs.mkdirSync(legacy, { mode: 0o700 });
    fs.writeFileSync(path.join(legacy, 'client-session-test.json'), JSON.stringify(data('legacy-private')), {
      mode: 0o600,
    });
    const target = storage(base, 'native', new MemoryStore());
    await target.activate();
    expect(files(base)).not.toContain('private');
    expect(target.readData('oauth-bound-', slot)).toBeNull();
    expect(target.readData('oauth-quarantine-', slot)).toBeNull();
    expect(fs.existsSync(temporary)).toBe(false);
  });

  it('file switching requires fresh login and native reselection cannot resurrect older credentials', async () => {
    const base = directory();
    const native = new MemoryStore();
    plaintext(base);
    const first = storage(base, 'native', native);
    await first.activate();
    const file = storage(base, 'file', native);
    await file.activate();
    expect(file.readData('oauth-bound-', slot)).toBeNull();
    expect(() => first.readData('oauth-bound-', slot)).toThrow(/restart/i);
    file.writeDataDurable('oauth-bound-', slot, data('fresh-file-login'));
    const reselected = storage(base, 'native', native);
    await reselected.activate();
    expect(reselected.readData('oauth-bound-', slot)).toMatchObject({ tokens: { access_token: 'fresh-file-login' } });
    expect(files(base)).not.toContain('fresh-file-login');
  });

  it('does not revive native credentials after a file switch without fresh login', async () => {
    const base = directory();
    const native = new MemoryStore();
    plaintext(base);
    await storage(base, 'native', native).activate();
    await storage(base, 'file', native).activate();
    const reselected = storage(base, 'native', native);
    await reselected.activate();
    expect(reselected.readData('oauth-bound-', slot)).toBeNull();
  });

  it('fences older writers and serializes concurrent updates under one scope lock', async () => {
    const base = directory();
    const native = new MemoryStore();
    const old = storage(base, 'native', native);
    await old.activate();
    const current = storage(base, 'native', native);
    await current.activate();
    await expect(
      old.withExclusiveLock('oauth-a', () => old.writeDataDurable('oauth-bound-', slot, data('stale'))),
    ).rejects.toThrow(/restart/i);
    await current.withExclusiveLock('oauth-a', () => current.writeDataDurable('oauth-bound-', slot, data()));
    await Promise.all(
      Array.from({ length: 10 }, () =>
        current.withExclusiveLock('oauth-other', async () => {
          const value = current.readData<ReturnType<typeof data>>('oauth-bound-', slot)!;
          await new Promise((resolve) => setTimeout(resolve, 1));
          value.revision++;
          current.writeDataDurable('oauth-bound-', slot, value);
        }),
      ),
    );
    expect(current.readData('oauth-bound-', slot)).toMatchObject({ revision: 17 });
  });

  it('exports only after verifying file destination and resumes failed native cleanup', async () => {
    const base = directory();
    const native = new MemoryStore();
    const original = data();
    const source = plaintext(base, original);
    const target = storage(base, 'native', native);
    await target.activate();
    vi.spyOn(native, 'delete').mockImplementationOnce(() => {
      throw new Error('locked');
    });
    await expect(target.exportToFile()).rejects.toThrow(/incomplete/);
    expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toEqual(original);
    expect(native.entries.size).toBeGreaterThan(0);
    expect((await target.exportToFile()).records).toBe(1);
    expect(native.entries.size).toBe(0);
    expect((await target.exportToFile()).records).toBe(0);
  });

  it('retains native recovery after an export destination advances', async () => {
    const base = directory();
    const native = new MemoryStore();
    const source = plaintext(base);
    const target = storage(base, 'native', native);
    await target.activate();
    vi.spyOn(native, 'delete').mockImplementationOnce(() => {
      throw new Error('locked');
    });
    await expect(target.exportToFile()).rejects.toThrow();
    fs.writeFileSync(source, JSON.stringify(data('newer-file')), { mode: 0o600 });
    await expect(target.exportToFile()).rejects.toThrow(/destination changed/);
    expect(native.entries.size).toBeGreaterThan(0);
    expect(fs.readFileSync(source, 'utf8')).toContain('newer-file');
  });

  it('protects a fresh file login after interrupted native source cleanup', async () => {
    const base = directory();
    const native = new MemoryStore();
    const source = plaintext(base);
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (String(file) === source) throw new Error('permission denied');
      unlink(file);
    });
    await expect(storage(base, 'native', native).activate()).rejects.toThrow();
    vi.restoreAllMocks();
    const file = storage(base, 'file', native);
    await file.activate();
    expect(file.readData('oauth-bound-', slot)).toBeNull();
    file.writeDataDurable('oauth-bound-', slot, data('advanced-file'));
    expect(file.readData('oauth-bound-', slot)).toMatchObject({ tokens: { access_token: 'advanced-file' } });
    const reselected = storage(base, 'native', native);
    await reselected.activate();
    expect(reselected.readData('oauth-bound-', slot)).toMatchObject({ tokens: { access_token: 'advanced-file' } });
  });
  it('keeps failed deletion explicitly incomplete and resumes erasure after restart', async () => {
    const base = directory();
    const native = new MemoryStore();
    plaintext(base);
    const target = storage(base, 'native', native);
    await target.activate();
    expect(target.listFiles('oauth-bound-')).toHaveLength(1);
    vi.spyOn(native, 'delete').mockImplementationOnce(() => {
      throw new Error('locked');
    });
    await expect(
      target.withExclusiveLock('oauth-test', () => target.deleteData('oauth-bound-', slot)),
    ).rejects.toThrow();
    expect(() => target.readData('oauth-bound-', slot)).toThrow(/incomplete/);
    const restarted = storage(base, 'native', native);
    await restarted.activate();
    expect(restarted.readData('oauth-bound-', slot)).toBeNull();
    expect(native.entries.size).toBe(0);
  });

  it('preserves callback PKCE across native-backed provider restart and consumes it exactly once', async () => {
    const base = directory();
    const native = new MemoryStore();
    const manager = AgentConfigManager.getInstance();
    const previous = manager.get('auth');
    manager.updateConfig({ auth: { ...previous, credentialStore: 'native' } });
    const config = {
      redirectUrl: 'https://proxy.example/oauth/callback/backend',
      authority: {
        owner: 'runtime-a',
        source: 'configured-source',
        configuration: 'security-configuration-a',
        route: { kind: 'http' as const, connectionKey: 'backend', url: 'https://resource.example/mcp' },
      },
    };
    await activateUpstreamOAuthStore({ baseDir: base, mode: 'native', nativeStore: native });
    const first = new SDKOAuthClientProvider('backend', config, base);
    let restarted: SDKOAuthClientProvider | undefined;
    try {
      await first.saveDiscoveryState({
        authorizationServerUrl: 'https://issuer.example',
        resourceMetadata: { resource: config.authority.route.url, authorization_servers: ['https://issuer.example'] },
        authorizationServerMetadata: {
          issuer: 'https://issuer.example',
          authorization_endpoint: 'https://issuer.example/authorize',
          token_endpoint: 'https://issuer.example/token',
          response_types_supported: ['code'],
          authorization_response_iss_parameter_supported: true,
        },
      });
      const state = first.state();
      const verifier = randomBytes(32).toString('base64url');
      first.saveCodeVerifier(verifier);
      const authorization = new URL('https://issuer.example/authorize');
      authorization.search = new URLSearchParams({
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        redirect_uri: config.redirectUrl,
        resource: config.authority.route.url,
      }).toString();
      await first.redirectToAuthorization(authorization);
      await first.shutdown();
      expect(files(base)).not.toContain(verifier);
      restarted = new SDKOAuthClientProvider('backend', config, base);
      const response = new URLSearchParams({ state, code: 'secret-code', iss: 'https://issuer.example' });
      await expect(restarted.withAuthorizationCallback(response, async () => restarted!.codeVerifier())).resolves.toBe(
        verifier,
      );
      await expect(
        restarted.withAuthorizationCallback(response, async () => restarted!.codeVerifier()),
      ).rejects.toThrow(/OAuth authority/);
      expect(files(base)).not.toContain(verifier);
    } finally {
      await first.shutdown();
      await restarted?.shutdown();
      manager.updateConfig({ auth: previous });
    }
  });
  it('recovers partial export before native startup can remigrate its plaintext destination', async () => {
    const base = directory();
    const native = new MemoryStore();
    const original = data();
    const source = plaintext(base, original);
    const first = storage(base, 'native', native);
    await first.activate();
    vi.spyOn(native, 'delete').mockImplementationOnce(() => {
      throw new Error('locked');
    });
    await expect(first.exportToFile()).rejects.toThrow();
    const restarted = storage(base, 'native', native);
    await restarted.activate();
    expect(restarted.readData('oauth-bound-', slot)).toEqual(original);
    expect(fs.existsSync(source)).toBe(false);
    expect((await restarted.exportToFile()).records).toBe(1);
    expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toEqual(original);
    expect(native.entries.size).toBe(0);
  });
  it.each(['file', 'native'] as const)(
    'permanently binds a shared storage directory before %s-mode access by another Runtime Scope',
    async (mode) => {
      const base = directory();
      const runtimeA = directory();
      const runtimeB = directory();
      const native = new MemoryStore();
      const original = data();
      plaintext(base, original);
      const first = new UpstreamOAuthStorage({ baseDir: base, mode, runtimeScope: runtimeA, nativeStore: native });
      storages.push(first);
      await first.activate();
      const contents = files(base);
      const chunks = [...native.entries];
      for (const otherMode of ['file', 'native'] as const) {
        const second = new UpstreamOAuthStorage({
          baseDir: base,
          mode: otherMode,
          runtimeScope: runtimeB,
          nativeStore: native,
        });
        storages.push(second);
        await expect(second.activate()).rejects.toThrow(/another Runtime Scope/);
        expect(() => second.readData('oauth-bound-', slot)).toThrow(/another Runtime Scope/);
        expect(() => second.writeDataDurable('oauth-bound-', slot, data('intruding-scope'))).toThrow(
          /another Runtime Scope/,
        );
        expect(() => second.deleteData('oauth-bound-', slot)).toThrow(/another Runtime Scope/);
        await expect(second.exportToFile()).rejects.toThrow(/another Runtime Scope/);
        expect(files(base)).toBe(contents);
        expect([...native.entries]).toEqual(chunks);
        expect(first.readData('oauth-bound-', slot)).toEqual(original);
      }
    },
  );

  it('a rejected startup in another Runtime Scope does not poison the owning scope provider readiness', async () => {
    const base = directory();
    const native = new MemoryStore();
    const runtimeA = directory();
    const runtimeB = directory();
    plaintext(base);
    await activateUpstreamOAuthStore({ baseDir: base, mode: 'native', runtimeScope: runtimeA, nativeStore: native });
    await activateUpstreamOAuthStore({ baseDir: base, mode: 'file', runtimeScope: runtimeB, nativeStore: native });
    const first = createUpstreamOAuthStorage({ baseDir: base, mode: 'native', runtimeScope: runtimeA });
    const second = createUpstreamOAuthStorage({ baseDir: base, mode: 'file', runtimeScope: runtimeB });
    storages.push(first, second);
    await first.ready();
    expect(first.readData('oauth-bound-', slot)).toMatchObject({ tokens: { access_token: 'private-access-secret' } });
    await expect(second.ready()).rejects.toThrow(/another Runtime Scope/);
  });

  it('retains the sanitized helper installation error without exposing arbitrary backend output', async () => {
    const base = directory();
    const native = new MemoryStore();
    plaintext(base);
    vi.spyOn(native, 'write').mockImplementation(() => {
      throw new NativeCredentialStoreError('helper_unavailable');
    });
    await expect(storage(base, 'native', native).activate()).rejects.toThrow(/Install the helper on PATH/);
  });
  it('keeps a fresh random nonce only in native envelopes and commits identical payloads differently', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    await target.activate();
    const value = data('guessable-registration-secret');
    const metadata = path.join(target.getStorageDir(), '.native-oauth');
    const snapshots: { nonce: string; digest: string }[] = [];
    for (let iteration = 0; iteration < 2; iteration++) {
      await target.withExclusiveLock('oauth-test', () => target.writeDataDurable('oauth-bound-', slot, value));
      const encoded = [...native.entries.values()].join('');
      const envelope = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>;
      const nonce = String(envelope.nonce);
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(nonce, 'base64url')).toHaveLength(32);
      expect(envelope.payload).toEqual(value);
      const referenceFile = fs.readdirSync(metadata).find((file) => file.endsWith('.ref'))!;
      const reference = JSON.parse(fs.readFileSync(path.join(metadata, referenceFile), 'utf8')) as { digest: string };
      expect(reference.digest).toBe(
        createHmac('sha256', Buffer.from(nonce, 'base64url')).update(encoded).digest('hex'),
      );
      expect(files(base)).not.toContain(nonce);
      const { nonce: _nonce, ...publiclyReconstructable } = envelope;
      const withoutNonce = Buffer.from(JSON.stringify(publiclyReconstructable)).toString('base64');
      expect(reference.digest).not.toBe(createHash('sha256').update(withoutNonce).digest('hex'));
      snapshots.push({ nonce, digest: reference.digest });
    }
    expect(snapshots[0].nonce).not.toBe(snapshots[1].nonce);
    expect(snapshots[0].digest).not.toBe(snapshots[1].digest);
  });

  it('rejects native envelopes without the required nonce instead of accepting a public checksum', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    await target.activate();
    await target.withExclusiveLock('oauth-test', () => target.writeDataDurable('oauth-bound-', slot, data()));
    expect(native.entries.size).toBe(1);
    const key = [...native.entries.keys()][0];
    const envelope = JSON.parse(Buffer.from(native.entries.get(key)!, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
    delete envelope.nonce;
    const encoded = Buffer.from(JSON.stringify(envelope)).toString('base64');
    native.entries.set(key, encoded);
    const metadata = path.join(target.getStorageDir(), '.native-oauth');
    const referencePath = path.join(
      metadata,
      fs.readdirSync(metadata).find((file) => file.endsWith('.ref'))!,
    );
    const reference = JSON.parse(fs.readFileSync(referencePath, 'utf8')) as Record<string, unknown>;
    reference.digest = createHash('sha256').update(encoded).digest('hex');
    fs.writeFileSync(referencePath, JSON.stringify(reference), { mode: 0o600 });
    expect(() => target.readData('oauth-bound-', slot)).toThrow(/incomplete/);
  });

  it('journals no plaintext commitment and preserves a changed migration source until reconciled', async () => {
    const base = directory();
    const native = new MemoryStore();
    const original = data('guessable-registration-secret');
    const source = plaintext(base, original);
    const target = storage(base, 'native', native);
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (String(file) === source) throw new Error('permission denied');
      unlink(file);
    });
    await expect(target.activate()).rejects.toThrow();
    const metadata = path.join(target.getStorageDir(), '.native-oauth');
    const intentFile = fs.readdirSync(metadata).find((file) => file.endsWith('.intent'))!;
    const intent = JSON.parse(fs.readFileSync(path.join(metadata, intentFile), 'utf8')) as Record<string, unknown>;
    expect(intent.migrationSource).toBe(true);
    expect(intent).not.toHaveProperty('sourceDigest');
    expect(files(metadata)).not.toContain(createHash('sha256').update(JSON.stringify(original)).digest('hex'));
    const chunks = [...native.entries];
    vi.restoreAllMocks();
    const advanced = data('newer-secret');
    fs.writeFileSync(source, JSON.stringify(advanced), { mode: 0o600 });
    const restarted = storage(base, 'native', native);
    await expect(restarted.activate()).rejects.toThrow(/Migration source changed/);
    expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toEqual(advanced);
    expect([...native.entries]).toEqual(chunks);
    fs.writeFileSync(source, JSON.stringify(original), { mode: 0o600 });
    await restarted.activate();
    expect(restarted.readData('oauth-bound-', slot)).toEqual(original);
    expect(fs.existsSync(source)).toBe(false);
  });
  it('protects empty, truncated and valid temporary fragments alongside authoritative JSON and exports exact bytes', async () => {
    const base = directory();
    const native = new MemoryStore();
    const original = data();
    const source = plaintext(base, original);
    const fragments = ['', '{"client_secret":"fragment-private', '\ufeff { "secret": "fragment-private-中文" }\r\n'];
    const temporaryFiles = fragments.map((value, index) => {
      const file = `${source}.orphan-${index}.tmp`;
      fs.writeFileSync(file, value, { mode: 0o600 });
      return file;
    });
    const target = storage(base, 'native', native);
    await target.activate();
    expect(target.readData('oauth-bound-', slot)).toEqual(original);
    expect(target.listFiles()).toEqual([path.basename(source)]);
    for (const file of temporaryFiles) expect(fs.existsSync(file)).toBe(false);
    expect(files(base)).not.toContain('fragment-private');
    expect((await target.exportToFile()).records).toBe(4);
    for (let index = 0; index < temporaryFiles.length; index++) {
      expect(fs.readFileSync(temporaryFiles[index])).toEqual(Buffer.from(fragments[index], 'utf8'));
    }
    expect(JSON.parse(fs.readFileSync(source, 'utf8'))).toEqual(original);
    expect(native.entries.size).toBe(0);
  });

  it('retains a temporary fragment when destination verification fails and safely resumes cleanup', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    const temporary = path.join(target.getStorageDir(), 'oauth_fragment.json.orphan.tmp');
    const fragment = '{"client_secret":"fragment-private';
    fs.writeFileSync(temporary, fragment, { mode: 0o600 });
    vi.spyOn(native, 'read').mockImplementationOnce(() => {
      throw new Error('verification failed');
    });
    await expect(target.activate()).rejects.toThrow();
    expect(fs.readFileSync(temporary, 'utf8')).toBe(fragment);
    vi.restoreAllMocks();
    const unlink = fs.unlinkSync;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (String(file) === temporary) throw new Error('cleanup denied');
      unlink(file);
    });
    const retry = storage(base, 'native', native);
    await expect(retry.activate()).rejects.toThrow();
    expect(fs.readFileSync(temporary, 'utf8')).toBe(fragment);
    expect(native.entries.size).toBeGreaterThan(0);
    vi.restoreAllMocks();
    const restarted = storage(base, 'native', native);
    await restarted.activate();
    expect(fs.existsSync(temporary)).toBe(false);
    expect(restarted.listFiles()).toEqual([]);
    expect((await restarted.exportToFile()).records).toBe(1);
    expect(fs.readFileSync(temporary, 'utf8')).toBe(fragment);
    expect(native.entries.size).toBe(0);
  });

  it('retains malformed authoritative JSON and fails closed instead of treating it as a recovery fragment', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    const source = target.getFilePath('oauth-bound-', slot);
    const malformed = '{"client_secret":"authoritative-private';
    fs.writeFileSync(source, malformed, { mode: 0o600 });
    await expect(target.activate()).rejects.toThrow();
    expect(fs.readFileSync(source, 'utf8')).toBe(malformed);
    expect(native.entries.size).toBe(0);
  });

  it('preserves invalid UTF-8 bytes instead of erasing a replacement-decoded temporary fragment', async () => {
    const base = directory();
    const native = new MemoryStore();
    const target = storage(base, 'native', native);
    const temporary = path.join(target.getStorageDir(), 'oauth_fragment.json.orphan.tmp');
    const bytes = Buffer.from([0x7b, 0x22, 0xe4, 0xb8]);
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    await expect(target.activate()).rejects.toThrow(/not valid UTF-8/);
    expect(fs.readFileSync(temporary)).toEqual(bytes);
    expect(native.entries.size).toBe(0);
  });
});
