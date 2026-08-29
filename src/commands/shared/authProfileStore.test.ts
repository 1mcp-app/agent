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

  it('saveAuthProfile self-heals a pre-existing permissive auth-profiles directory', async () => {
    const isPosix = process.platform !== 'win32';
    if (!isPosix) return;
    const fs = await import('node:fs/promises');
    const profilesDir = join(tmpDir, 'auth-profiles');
    await fs.mkdir(profilesDir, { recursive: true });
    await fs.chmod(profilesDir, 0o775);

    await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok', savedAt: 1000 });

    expect((await fs.stat(profilesDir)).mode & 0o777).toBe(0o700);
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
      'listAuthProfiles skips only the file whose heal is denied, keeping healthy ones visible',
      async () => {
        await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3050', token: 'tok1', savedAt: 1000 });
        await saveAuthProfile(tmpDir, { serverUrl: 'http://localhost:3051', token: 'tok2', savedAt: 2000 });

        const { chmod, open, readdir } = await import('node:fs/promises');
        const dir = join(tmpDir, 'auth-profiles');
        const files = (await readdir(dir)).sort();
        const deniedPath = join(dir, files[files.length - 1]);

        // Only the denied file is permissive; handle.chmod rejects only when
        // the opened file still carries group/other bits (i.e. only for the
        // one file that needs a heal).
        await chmod(deniedPath, 0o644);
        const probe = await open(deniedPath, 'r');
        const proto = Object.getPrototypeOf(probe) as {
          chmod: (mode: number) => Promise<void>;
          fd: number;
        };
        await probe.close();
        const deniedP = deniedPath;
        const fchmodSpy = vi.spyOn(proto, 'chmod').mockImplementation(async function (
          this: { fd: number },
          mode: number,
        ) {
          const fsSync = await import('node:fs');
          const st = fsSync.fstatSync(this.fd);
          // fstatSync has no path on Windows; on POSIX /proc/self/fd works.
          let fdPath = '';
          try {
            fdPath = fsSync.readlinkSync(`/proc/self/fd/${this.fd}`);
          } catch {
            // Not all POSIX platforms expose /proc/self/fd; fall back to
            // rejecting only heals whose target still has 0644 on this fd
            // (the only file we weakened).
            if ((st.mode & 0o777) !== 0o644) {
              return;
            }
            throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
          }
          if (fdPath === deniedP) {
            throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
          }
          return fsSync.fchmodSync(this.fd, mode);
        });

        try {
          const profiles = await listAuthProfiles(tmpDir);
          expect(profiles).toHaveLength(1);
          expect(profiles[0].token).toBe('tok1');
          expect(fchmodSpy).toHaveBeenCalled();
        } finally {
          fchmodSpy.mockRestore();
        }
      },
    );
  });
});
