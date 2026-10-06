import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AUTH_CONFIG } from '@src/constants.js';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileStorageService } from './fileStorageService.js';
import {
  activateInboundOAuthStore,
  getInboundOAuthStoreReadiness,
  InboundOAuthStorage,
} from './inboundOAuthStorage.js';
import { type NativeCredentialStore } from './nativeCredentialStore.js';
import { OAuthStorageService } from './oauthStorageService.js';
import { UpstreamOAuthStorage } from './upstreamOAuthStorage.js';

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
const makeDirectory = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-native-'));
  directories.push(directory);
  return directory;
};
const value = (secret = 'whole-record-secret') => ({
  expires: Date.now() + 60_000,
  createdAt: Date.now(),
  extension: { secret },
});
const identifier = (prefix = AUTH_CONFIG.SERVER.AUTH_CODE.ID_PREFIX) => prefix + randomUUID();
function store(baseDir: string, nativeStore: MemoryStore, mode: 'file' | 'native' = 'native') {
  const storage = new InboundOAuthStorage({ baseDir, nativeStore, mode });
  storages.push(storage);
  return storage;
}
function disk(directory: string): string {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? disk(target) : entry.name + '\n' + fs.readFileSync(target, 'utf8');
    })
    .join('\n');
}
afterEach(() => {
  vi.restoreAllMocks();
  storages.splice(0).forEach((storage) => storage.shutdown());
  directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

describe('inbound shared protected storage', () => {
  it('migrates every managed whole record and opaque/truncated temporary copy without exposing bearer filenames', async () => {
    const base = makeDirectory();
    const plain = new FileStorageService(base, 'server', { manageLifecycle: false });
    storages.push(plain);
    const records = [
      ['session_', identifier('sess-')],
      ['session_', 'cli_client-shared'],
      ['auth_code_', identifier()],
      ['auth_request_', identifier()],
      ['refresh_family_', identifier('rf-')],
      ['refresh_lookup_', 'rtl-' + 'a'.repeat(64)],
    ];
    for (const [prefix, id] of records) plain.writeDataDurable(prefix, id, value());
    const temporary = plain.getFilePath(...(records[2] as [string, string])) + '.42.truncated.tmp';
    fs.writeFileSync(temporary, '{"secret":"truncated-private', { mode: 0o600 });
    const legacy = path.join(base, 'sessions');
    const legacyId = identifier();
    fs.writeFileSync(path.join(legacy, `auth_code_${legacyId}.json`), JSON.stringify(value('legacy-secret')), {
      mode: 0o600,
    });
    const native = new MemoryStore();
    const target = store(base, native);
    await target.activate();
    for (const [prefix, id] of records)
      expect(target.readData(prefix, id)).toMatchObject({ extension: { secret: 'whole-record-secret' } });
    expect(target.readData('auth_code_', legacyId)).toMatchObject({ extension: { secret: 'legacy-secret' } });
    const plaintext = disk(base);
    for (const [, id] of [...records, ['auth_code_', legacyId]]) expect(plaintext).not.toContain(id);
    expect(plaintext).not.toContain('whole-record-secret');
    expect(plaintext).not.toContain('truncated-private');
    expect(target.listFiles('auth_code_')).toContain(`auth_code_${legacyId}.json`);
    expect(fs.existsSync(temporary)).toBe(false);
  });

  it('preserves malformed authoritative JSON and fails readiness without fallback', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const target = store(base, native);
    const source = target.getFilePath('auth_code_', identifier());
    fs.mkdirSync(path.dirname(source), { recursive: true, mode: 0o700 });
    fs.writeFileSync(source, '{private-malformed', { mode: 0o600 });
    await expect(target.activate()).rejects.toThrow(/incomplete/);
    expect(target.isReady()).toBe(false);
    expect(fs.readFileSync(source, 'utf8')).toBe('{private-malformed');
  });

  it('isolates domain identities even when logical IDs and scope paths match', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const inbound = store(base, native);
    const upstream = new UpstreamOAuthStorage({ baseDir: base, mode: 'native', nativeStore: native });
    storages.push(upstream);
    await inbound.activate();
    await upstream.activate();
    const id = 'cli_same-client';
    inbound.writeDataDurable('session_', id, value('inbound-secret'));
    await upstream.withExclusiveLock('test', () => upstream.writeDataDurable('', id, value('upstream-secret')));
    inbound.deleteData('session_', id);
    expect(upstream.readData('', id)).toMatchObject({ extension: { secret: 'upstream-secret' } });
    expect(inbound.readData('session_', id)).toBeNull();
    expect(inbound.getActivationKey()).not.toBe(upstream.getActivationKey());
  });

  it.each(['before-commit', 'after-commit', 'cleanup'] as const)(
    'recovers a multi-record code/session mutation interrupted %s',
    async (failure) => {
      const base = makeDirectory();
      const native = new MemoryStore();
      const target = store(base, native);
      await target.activate();
      const code = identifier();
      const session = identifier('sess-');
      const family = identifier('rf-');
      target.writeDataDurable('auth_code_', code, value('single-use-code'));
      target.writeDataDurable('refresh_family_', family, value('previous-family'));
      let injected = false;
      const rename = fs.renameSync;
      const deletion = native.delete.bind(native);
      if (failure === 'before-commit')
        vi.spyOn(native, 'write').mockImplementation(() => {
          throw new Error('private-backend-detail');
        });
      if (failure === 'after-commit')
        vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
          if (!injected && String(destination).endsWith('.ref')) {
            injected = true;
            throw new Error('private-publication-detail');
          }
          return rename(source, destination);
        });
      if (failure === 'cleanup')
        vi.spyOn(native, 'delete').mockImplementation((key) => {
          if (!injected) {
            injected = true;
            throw new Error('private-cleanup-detail');
          }
          deletion(key);
        });
      await expect(
        target.withExclusiveLock('code-redemption', async () => {
          target.deleteData('auth_code_', code);
          await target.withExclusiveLock('refresh-token-families', () => {
            target.writeDataDurable('session_', session, value('issued-session'));
            target.writeDataDurable('refresh_family_', family, value('successor-family'));
          });
        }),
      ).rejects.toThrow();
      expect(target.isReady()).toBe(false);
      expect(() => target.readData('auth_code_', code)).toThrow();
      vi.restoreAllMocks();
      const restarted = store(base, native);
      await restarted.activate();
      if (failure === 'before-commit') {
        expect(restarted.readData('auth_code_', code)).not.toBeNull();
        expect(restarted.readData('session_', session)).toBeNull();
        expect(restarted.readData('refresh_family_', family)).toMatchObject({
          extension: { secret: 'previous-family' },
        });
      } else {
        expect(restarted.readData('auth_code_', code)).toBeNull();
        expect(restarted.readData('session_', session)).toMatchObject({ extension: { secret: 'issued-session' } });
        expect(restarted.readData('refresh_family_', family)).toMatchObject({
          extension: { secret: 'successor-family' },
        });
      }
      expect(disk(base)).not.toContain('issued-session');
      expect(disk(base)).not.toContain(code);
    },
  );

  it('fails a concurrent synchronous write busy instead of joining another async transaction', async () => {
    const native = new MemoryStore();
    const base = makeDirectory();
    await activateInboundOAuthStore({ baseDir: base, mode: 'native', nativeStore: native });
    const target = store(base, native);
    const peer = store(base, native);
    await target.ready();
    await peer.ready();
    const firstId = identifier();
    const otherId = identifier();
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = target.withExclusiveLock('test', async () => {
      target.writeDataDurable('auth_code_', firstId, value());
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await enteredPromise;
    expect(() => target.writeDataDurable('auth_code_', otherId, value('other'))).toThrow(/busy/);
    expect(() => peer.writeDataDurable('auth_code_', otherId, value('other'))).toThrow(/incomplete|busy/);
    expect(peer.isReady()).toBe(true);
    expect(target.isReady()).toBe(true);
    release();
    await pending;
    expect(target.readData('auth_code_', firstId)).not.toBeNull();
    expect(target.readData('auth_code_', otherId)).toBeNull();
  });

  it.each(['file', 'native'] as const)(
    'consumes consent exactly once and retains refresh replay revocation in %s mode',
    async (mode) => {
      const base = makeDirectory();
      const native = new MemoryStore();
      const service = new OAuthStorageService(base, 'scope-test', { credentialStore: mode, nativeStore: native });
      storages.push(service.fileStorage);
      await service.ready();
      const request = service.createAuthorizationRequest(
        'client',
        'https://client.example/callback',
        'pkce',
        'state',
        'resource',
        ['read'],
      );
      const outcomes = await Promise.allSettled([
        service.processConsentApproval(request, ['read']),
        service.processConsentApproval(request, ['read']),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const accessId = randomUUID();
      const sessionWrite = (id: string) => (familyId: string) =>
        service.sessionRepository.createWithId(id, 'client', 'resource', ['read'], 60_000, familyId);
      const initial = await service.refreshTokenFamilyRepository.create(
        'client',
        ['read'],
        'resource',
        accessId,
        sessionWrite(accessId),
      );
      const results = await Promise.all(
        [1, 2].map(() => {
          const id = randomUUID();
          return service.refreshTokenFamilyRepository.consume(initial.refreshToken, 'client', id, sessionWrite(id));
        }),
      );
      expect(results.filter((result) => result.status === 'rotated')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'replay')).toHaveLength(1);
      expect(service.refreshTokenFamilyRepository.findById(initial.family.familyId)?.status).toBe('revoked');
      expect(disk(base)).not.toContain(initial.refreshToken);
    },
  );

  it('file mutation recovery finishes consumption before reads after a partial destination failure', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const target = store(base, native, 'file');
    const code = identifier();
    const session = identifier('sess-');
    target.writeDataDurable('auth_code_', code, value());
    const unlink = fs.unlinkSync;
    let injected = false;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (!injected && String(file) === target.getFilePath('auth_code_', code)) {
        injected = true;
        throw new Error('injected deletion');
      }
      return unlink(file);
    });
    await expect(
      target.withExclusiveLock('exchange', () => {
        target.deleteData('auth_code_', code);
        target.writeDataDurable('session_', session, value('successor-session'));
      }),
    ).rejects.toThrow();
    expect(() => target.readData('auth_code_', code)).toThrow();
    vi.restoreAllMocks();
    const restarted = store(base, native, 'file');
    await restarted.activate();
    expect(restarted.readData('auth_code_', code)).toBeNull();
    expect(restarted.readData('session_', session)).toMatchObject({ extension: { secret: 'successor-session' } });
    expect(fs.readdirSync(restarted.getStorageDir()).filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });

  it('does not revive a consumed legacy code through export and file-layout migration', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const target = store(base, native);
    const code = identifier();
    const legacy = path.join(base, 'sessions', `auth_code_${code}.json`);
    fs.mkdirSync(path.dirname(legacy), { recursive: true, mode: 0o700 });
    fs.writeFileSync(legacy, JSON.stringify(value()), { mode: 0o600 });
    const unlink = fs.unlinkSync;
    let interrupted = false;
    vi.spyOn(fs, 'unlinkSync').mockImplementation((file) => {
      if (!interrupted && String(file) === legacy) {
        interrupted = true;
        throw new Error('legacy cleanup interruption');
      }
      return unlink(file);
    });
    await expect(target.activate()).rejects.toThrow();
    vi.restoreAllMocks();
    const restarted = store(base, native);
    await restarted.activate();
    expect(restarted.readData('auth_code_', code)).not.toBeNull();
    restarted.deleteData('auth_code_', code);
    await restarted.exportToFile();
    const file = store(base, native, 'file');
    await file.activate();
    expect(file.readData('auth_code_', code)).toBeNull();
    expect(fs.existsSync(legacy)).toBe(false);
  });

  it('contains denied credential-directory creation while independent storage remains usable', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const mkdir = fs.mkdirSync;
    vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, options) => {
      if (String(directory).endsWith(path.join('sessions', 'server'))) throw new Error('private permission failure');
      return mkdir(directory, options);
    });
    const options = { baseDir: base, mode: 'native' as const, nativeStore: native };
    expect(() => store(base, native)).not.toThrow();
    await activateInboundOAuthStore(options);
    expect(getInboundOAuthStoreReadiness(options)).toEqual({ mode: 'native', ready: false });
    const service = new OAuthStorageService(base, 'scope', { credentialStore: 'native' });
    storages.push(service.fileStorage);
    await expect(service.ready()).rejects.toThrow(/incomplete/);
    const independent = new FileStorageService(base, 'admin');
    storages.push(independent);
    const id = identifier('sess-');
    independent.writeData('session_', id, value('independent-admin'));
    expect(independent.readData('session_', id)).toMatchObject({ extension: { secret: 'independent-admin' } });
  });

  it('resumes confirmed export after partial native cleanup without losing destinations', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const target = store(base, native);
    await target.activate();
    const first = identifier();
    const second = identifier();
    target.writeDataDurable('auth_code_', first, value('first-export-' + 'x'.repeat(4000)));
    target.writeDataDurable('auth_code_', second, value('second-export'));
    const deletion = native.delete.bind(native);
    let calls = 0;
    vi.spyOn(native, 'delete').mockImplementation((key) => {
      if (++calls === 2) throw new Error('private cleanup failure');
      deletion(key);
    });
    await expect(target.exportToFile()).rejects.toThrow();
    vi.restoreAllMocks();
    const retry = store(base, native);
    await retry.exportToFile();
    expect(native.entries.size).toBe(0);
    const file = store(base, native, 'file');
    await file.activate();
    expect(file.readData('auth_code_', first)).toMatchObject({
      extension: { secret: 'first-export-' + 'x'.repeat(4000) },
    });
    expect(file.readData('auth_code_', second)).toMatchObject({ extension: { secret: 'second-export' } });
    expect(
      fs
        .readdirSync(path.join(file.getStorageDir(), '.native-oauth'))
        .filter((name) => /\.(export|intent|commit|ref)$/.test(name)),
    ).toEqual([]);
  });

  it.each(['duplicate', 'completed-fence'] as const)(
    'never restores consumed flat-layout credentials after file restart (%s)',
    async (scenario) => {
      const base = makeDirectory();
      const native = new MemoryStore();
      const current = path.join(base, 'sessions', 'server');
      const legacy = path.dirname(current);
      fs.mkdirSync(current, { recursive: true, mode: 0o700 });
      if (scenario === 'completed-fence')
        fs.writeFileSync(path.join(legacy, '.migrated-to-server'), '{}', { mode: 0o600 });
      const records = [
        ['auth_code_', identifier()],
        ['auth_request_', identifier()],
        ['session_', identifier('sess-')],
      ];
      for (const [prefix, id] of records) {
        const file = `${prefix}${id}.json`;
        fs.writeFileSync(path.join(legacy, file), JSON.stringify(value('stale-legacy')), { mode: 0o600 });
        if (scenario === 'duplicate')
          fs.writeFileSync(path.join(current, file), JSON.stringify(value('current')), { mode: 0o600 });
      }
      const file = store(base, native, 'file');
      for (const [prefix, id] of records) {
        if (scenario === 'duplicate') expect(file.readData(prefix, id)).not.toBeNull();
        else expect(file.readData(prefix, id)).toBeNull();
        file.deleteData(prefix, id);
      }
      file.shutdown();
      const restarted = store(base, native, 'file');
      await restarted.activate();
      for (const [prefix, id] of records) expect(restarted.readData(prefix, id)).toBeNull();
      const protectedStore = store(base, native);
      await protectedStore.activate();
      await protectedStore.exportToFile();
      const exported = store(base, native, 'file');
      await exported.activate();
      for (const [prefix, id] of records) expect(exported.readData(prefix, id)).toBeNull();
      expect(fs.readdirSync(legacy).filter((file) => file.endsWith('.json'))).toEqual([]);
    },
  );

  it('restores file expiry collection while preserving malformed authority and committed journals', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const target = store(base, native, 'file');
    const expired = identifier();
    target.writeDataDurable('auth_code_', expired, { ...value(), expires: 1 });
    const malformed = target.getFilePath('auth_code_', identifier());
    fs.writeFileSync(malformed, '{malformed-secret', { mode: 0o600 });
    const fragment = target.getFilePath('auth_code_', identifier()) + '.old.tmp';
    fs.writeFileSync(fragment, 'temporary-secret', { mode: 0o600 });
    const old = new Date(Date.now() - 120_000);
    fs.utimesSync(fragment, old, old);
    expect(target.cleanupExpiredData()).toBe(2);
    expect(fs.existsSync(malformed)).toBe(true);
    expect(fs.existsSync(fragment)).toBe(false);
    expect(target.readData('auth_code_', expired)).toBeNull();
  });

  it('filters native categories before opening unrelated envelopes while preserving prefix queries', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const plain = new FileStorageService(base, 'server', { manageLifecycle: false });
    storages.push(plain);
    const records = [
      ['session_', identifier('sess-')],
      ['session_', 'cli_client-filter'],
      ['auth_code_', identifier()],
      ['auth_request_', identifier()],
      ['refresh_family_', identifier('rf-')],
      ['refresh_lookup_', 'rtl-' + 'b'.repeat(64)],
    ];
    for (const [prefix, id] of records) plain.writeDataDurable(prefix, id, value());
    const temporary = plain.getFilePath('auth_code_', records[2][1]) + '.orphan.tmp';
    fs.writeFileSync(temporary, 'temporary-category-secret', { mode: 0o600 });
    const target = store(base, native);
    await target.activate();
    const refs = fs
      .readdirSync(path.join(target.getStorageDir(), '.native-oauth'))
      .filter((file) => file.endsWith('.ref'))
      .map(
        (file) =>
          JSON.parse(fs.readFileSync(path.join(target.getStorageDir(), '.native-oauth', file), 'utf8')) as {
            category: string;
            record: string;
            chunks: number;
          },
      );
    const read = vi.spyOn(native, 'read');
    const assertReadsOnly = (categories: string[]) => {
      const selected = refs.filter((reference) => categories.includes(reference.category));
      expect(read).toHaveBeenCalledTimes(selected.reduce((count, reference) => count + reference.chunks, 0));
      expect(
        read.mock.calls.every(([key]) => selected.some((reference) => key.includes(`/${reference.record}/`))),
      ).toBe(true);
    };
    expect(target.listFiles('refresh_family_')).toEqual([`refresh_family_${records[4][1]}.json`]);
    assertReadsOnly(['refresh_family_']);
    read.mockClear();
    expect(target.listFiles('refresh_')).toHaveLength(2);
    assertReadsOnly(['refresh_family_', 'refresh_lookup_']);
    read.mockClear();
    expect(target.listFiles('session_cli_')).toEqual(['session_cli_client-filter.json']);
    assertReadsOnly(['session_']);
    read.mockClear();
    expect(target.listFiles()).toHaveLength(records.length);
    expect(
      read.mock.calls.every(
        ([key]) =>
          !refs
            .filter((reference) => reference.category === 'temporary')
            .some((reference) => key.includes(`/${reference.record}/`)),
      ),
    ).toBe(true);
    expect(disk(base)).not.toContain('temporary-category-secret');
  });

  it('backfills legacy category metadata during activation and shares validation with recreated instances', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    const options = { baseDir: base, nativeStore: native, mode: 'native' as const };
    await activateInboundOAuthStore(options);
    const target = store(base, native);
    await target.ready();
    const code = identifier();
    const family = identifier('rf-');
    target.writeDataDurable('auth_code_', code, value());
    target.writeDataDurable('refresh_family_', family, value());
    const metadata = path.join(target.getStorageDir(), '.native-oauth');
    for (const file of fs.readdirSync(metadata).filter((file) => file.endsWith('.ref'))) {
      const reference = JSON.parse(fs.readFileSync(path.join(metadata, file), 'utf8')) as { category?: string };
      delete reference.category;
      fs.writeFileSync(path.join(metadata, file), JSON.stringify(reference), { mode: 0o600 });
    }
    const read = vi.spyOn(native, 'read');
    await activateInboundOAuthStore(options);
    expect(getInboundOAuthStoreReadiness(options).ready).toBe(true);
    expect(read.mock.calls.filter(([key]) => !key.endsWith('/readiness')).length).toBeGreaterThan(1);
    const refs = fs
      .readdirSync(metadata)
      .filter((file) => file.endsWith('.ref'))
      .map(
        (file) =>
          JSON.parse(fs.readFileSync(path.join(metadata, file), 'utf8')) as {
            category: string;
            record: string;
            chunks: number;
          },
      );
    expect(refs.map((reference) => reference.category).sort()).toEqual(['auth_code_', 'refresh_family_']);
    const recreated = store(base, native);
    await recreated.ready();
    read.mockClear();
    expect(recreated.listFiles('refresh_family_')).toEqual([`refresh_family_${family}.json`]);
    const selected = refs.find((reference) => reference.category === 'refresh_family_')!;
    expect(read).toHaveBeenCalledTimes(selected.chunks);
    expect(read.mock.calls.every(([key]) => key.includes(`/${selected.record}/`))).toBe(true);
    recreated.writeDataDurable('refresh_family_', family, value('replacement'));
    expect(recreated.listFiles('refresh_family_')).toHaveLength(1);
    recreated.deleteData('refresh_family_', family);
    expect(recreated.listFiles('refresh_family_')).toEqual([]);
    recreated.writeDataDurable('refresh_family_', family, value('recreated'));
    expect(recreated.listFiles('refresh_family_')).toHaveLength(1);
  });

  it.each(['auth_code_', 'unapproved-category'] as const)(
    'fails closed on tampered native category %s before selection and after restart',
    async (category) => {
      const base = makeDirectory();
      const native = new MemoryStore();
      const options = { baseDir: base, nativeStore: native, mode: 'native' as const };
      await activateInboundOAuthStore(options);
      const target = store(base, native);
      await target.ready();
      const family = identifier('rf-');
      target.writeDataDurable('refresh_family_', family, value());
      const metadata = path.join(target.getStorageDir(), '.native-oauth');
      const file = fs.readdirSync(metadata).find((file) => file.endsWith('.ref'))!;
      const reference = JSON.parse(fs.readFileSync(path.join(metadata, file), 'utf8')) as { category: string };
      reference.category = category;
      fs.writeFileSync(path.join(metadata, file), JSON.stringify(reference), { mode: 0o600 });
      const recreated = store(base, native);
      await recreated.ready();
      const read = vi.spyOn(native, 'read');
      expect(() => recreated.listFiles('refresh_family_')).toThrow(/incomplete/);
      expect(read).not.toHaveBeenCalled();
      expect(recreated.isReady()).toBe(false);
      await activateInboundOAuthStore(options);
      expect(getInboundOAuthStoreReadiness(options).ready).toBe(false);
      const restarted = store(base, native);
      await expect(restarted.ready()).rejects.toThrow(/incomplete/);
    },
  );

  it('captures empty-store native helper failure and cached readiness without constructor failure', async () => {
    const base = makeDirectory();
    const native = new MemoryStore();
    vi.spyOn(native, 'read').mockImplementation(() => {
      throw new Error('secret-helper-output');
    });
    const options = { baseDir: base, nativeStore: native, mode: 'native' as const };
    await activateInboundOAuthStore(options);
    expect(getInboundOAuthStoreReadiness(options)).toEqual({ mode: 'native', ready: false });
    const service = new OAuthStorageService(base, 'scope', { credentialStore: 'native' });
    storages.push(service.fileStorage);
    await expect(service.ready()).rejects.toThrow(/incomplete/);
    expect(service.isReady()).toBe(false);
  });
});
