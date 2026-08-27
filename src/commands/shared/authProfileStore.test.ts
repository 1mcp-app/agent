import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteAuthProfile,
  listAuthProfiles,
  loadAuthProfile,
  normalizeServerUrl,
  saveAuthProfile,
} from './authProfileStore.js';

describe('normalizeServerUrl', () => {
  it('strips trailing slash', () => {
    expect(normalizeServerUrl('http://localhost:3050/')).toBe('http://localhost:3050');
  });

  it('strips /mcp suffix', () => {
    expect(normalizeServerUrl('http://localhost:3050/mcp')).toBe('http://localhost:3050');
  });

  it('strips /mcp and trailing slash', () => {
    expect(normalizeServerUrl('http://localhost:3050/mcp/')).toBe('http://localhost:3050');
  });

  it('lowercases the host', () => {
    expect(normalizeServerUrl('http://LOCALHOST:3050')).toBe('http://localhost:3050');
  });

  it('strips query params', () => {
    expect(normalizeServerUrl('http://localhost:3050?preset=dev')).toBe('http://localhost:3050');
  });

  it('treats http://localhost:3050, http://localhost:3050/, and http://localhost:3050/mcp as equivalent', () => {
    const a = normalizeServerUrl('http://localhost:3050');
    const b = normalizeServerUrl('http://localhost:3050/');
    const c = normalizeServerUrl('http://localhost:3050/mcp');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe('authProfileStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'auth-profile-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a profile', async () => {
    await saveAuthProfile(tmpDir, {
      serverUrl: 'http://localhost:3050',
      token: 'secret-token',
      savedAt: 1000,
    });

    const loaded = await loadAuthProfile(tmpDir, 'http://localhost:3050');
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe('secret-token');
    expect(loaded!.serverUrl).toBe('http://localhost:3050');
  });

  it('normalizes URL on save so different forms resolve to the same profile', async () => {
    await saveAuthProfile(tmpDir, {
      serverUrl: 'http://localhost:3050/mcp',
      token: 'tok',
      savedAt: 1000,
    });

    const loaded = await loadAuthProfile(tmpDir, 'http://localhost:3050');
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe('tok');
  });

  it('returns null for unknown URL', async () => {
    const loaded = await loadAuthProfile(tmpDir, 'http://localhost:9999');
    expect(loaded).toBeNull();
  });

  it('deletes a profile', async () => {
    await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok', savedAt: 1000 });
    const removed = await deleteAuthProfile(tmpDir, 'http://localhost:3050');
    expect(removed).toBe(true);
    expect(await loadAuthProfile(tmpDir, 'http://localhost:3050')).toBeNull();
  });

  it('returns false when deleting non-existent profile', async () => {
    const removed = await deleteAuthProfile(tmpDir, 'http://localhost:9999');
    expect(removed).toBe(false);
  });

  it('lists all profiles', async () => {
    await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok1', savedAt: 1000 });
    await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3051', token: 'tok2', savedAt: 2000 });

    const profiles = await listAuthProfiles(tmpDir);
    expect(profiles).toHaveLength(2);
    const urls = profiles.map((p) => p.serverUrl).sort();
    expect(urls).toContain('http://localhost:3050');
    expect(urls).toContain('http://localhost:3051');
  });

  it('returns empty array when no profiles exist', async () => {
    const profiles = await listAuthProfiles(tmpDir);
    expect(profiles).toEqual([]);
  });

  describe('read-side strictModes (POSIX-only)', () => {
    const isPosix = process.platform !== 'win32';

    async function profileFileUrl(url: string): Promise<string> {
      // Recompute the on-disk path the same way the store does: save, then
      // locate the single profile file in the profiles dir.
      await saveAuthProfile(tmpDir, { serverUrl: url, token: 'tok', savedAt: 1000 });
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(join(tmpDir, 'auth-profiles'));
      return join(tmpDir, 'auth-profiles', files[0]);
    }

    it.skipIf(!isPosix)('self-heals a legacy group/other-readable profile to 0600 on load', async () => {
      const filePath = await profileFileUrl('http://localhost:3050');
      const { chmod, stat } = await import('node:fs/promises');
      await chmod(filePath, 0o644);

      const loaded = await loadAuthProfile(tmpDir, 'http://localhost:3050');
      expect(loaded?.token).toBe('tok');
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    });

    it.skipIf(!isPosix)('self-heals a legacy group/other-readable profiles dir to 0700 on load', async () => {
      await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok', savedAt: 1000 });
      const dir = join(tmpDir, 'auth-profiles');
      const { chmod, stat } = await import('node:fs/promises');
      await chmod(dir, 0o755);

      const loaded = await loadAuthProfile(tmpDir, 'http://localhost:3050');
      expect(loaded?.token).toBe('tok');
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    });

    it.skipIf(!isPosix)('listAuthProfiles stays available while healing every file', async () => {
      const first = await profileFileUrl('http://localhost:3050');
      await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3051', token: 'tok2', savedAt: 2000 });
      const { chmod } = await import('node:fs/promises');
      await chmod(first, 0o644);

      const profiles = await listAuthProfiles(tmpDir);
      expect(profiles).toHaveLength(2);
    });

    it.skipIf(!isPosix)(
      'listAuthProfiles skips a file whose heal is denied instead of hiding healthy profiles',
      async () => {
        await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok1', savedAt: 1000 });
        await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3051', token: 'tok2', savedAt: 2000 });

        // Deny the heal on every read: Any file with open mode bits set then
        // rejects handle.chmod. Force all files permissive first.
        const { chmod, open, readdir } = await import('node:fs/promises');
        const dir = join(tmpDir, 'auth-profiles');
        for (const f of await readdir(dir)) {
          await chmod(join(dir, f), 0o644);
        }
        const probe = await open(join(dir, (await readdir(dir))[0]), 'r');
        const proto = Object.getPrototypeOf(probe) as { chmod: (mode: number) => Promise<void> };
        await probe.close();
        const spy = vi
          .spyOn(proto, 'chmod')
          .mockRejectedValue(Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }));

        try {
          // Every file fails its heal → every file is skipped with a warn, so
          // the list is empty but the call does not throw and does not
          // silently misreport success.
          const profiles = await listAuthProfiles(tmpDir);
          expect(profiles).toEqual([]);
          expect(spy).toHaveBeenCalled();
        } finally {
          spy.mockRestore();
        }
      },
    );
  });
});
