import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
});
