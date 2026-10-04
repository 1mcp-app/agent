import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  authoritySlot,
  OAUTH_AUTHORITY_TTL_MS,
  type OAuthAuthority,
  oauthConfigurationFingerprint,
  oauthConfigurationFingerprintAsync,
} from './oauthAuthority.js';
import { ClientSessionRepository } from './storage/clientSessionRepository.js';
import { FileStorageService } from './storage/fileStorageService.js';

describe('active OAuth authority lifetime', () => {
  let dir: string;
  let storage: FileStorageService;
  let repository: ClientSessionRepository;
  const authority: OAuthAuthority = {
    version: 1,
    owner: 'runtime',
    source: 'configured-server',
    route: { kind: 'http', connectionKey: 'server', url: 'https://resource.example/mcp' },
    configuration: 'configuration',
    issuer: 'https://issuer.example',
    resource: 'https://resource.example/mcp',
    authorizationEndpoint: 'https://issuer.example/authorize',
    tokenEndpoint: 'https://issuer.example/token',
    requireIssuer: false,
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-lifetime-'));
    storage = new FileStorageService(dir, 'client');
    repository = new ClientSessionRepository(storage);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    storage.shutdown();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a used authority and refresh token eligible beyond thirty days without writing on every request', async () => {
    const generation = await repository.claimContext(authoritySlot(authority), authority, null);
    await repository.activate(authoritySlot(authority), authority, 'discovery', generation);
    await repository.updateBound(authoritySlot(authority), generation, (record) => {
      record.tokens = JSON.stringify({ access_token: 'access', token_type: 'Bearer', refresh_token: 'refresh' });
    });
    await repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.8.8');
    const write = vi.spyOn(storage, 'writeDataDurable');
    const lock = vi.spyOn(storage, 'withExclusiveLock');
    await repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.8.8');
    expect(write).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    for (let day = 0; day < 35; day++) {
      vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
      await repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.8.8');
    }
    expect(repository.getClaim(authoritySlot(authority))?.generation).toBe(generation);
    expect(JSON.parse(repository.getBound(authoritySlot(authority))!.tokens!).refresh_token).toBe('refresh');
    expect(repository.getBound(authoritySlot(authority))?.expires).toBe(Date.now() + OAUTH_AUTHORITY_TTL_MS);
  });

  it('does not persist a pending claim after shutdown cancellation', async () => {
    const controller = new AbortController();
    const slot = authoritySlot(authority);
    const write = vi.spyOn(storage, 'writeDataDurable');
    const pending = repository.claimContext(slot, authority, null, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(write).not.toHaveBeenCalled();
    expect(repository.getClaim(slot)).toBeNull();
  });

  it('renews both records on credential saves and same-authority activation', async () => {
    const generation = await repository.claimContext(authoritySlot(authority), authority, null);
    await repository.activate(authoritySlot(authority), authority, 'discovery', generation);
    vi.setSystemTime(Date.now() + OAUTH_AUTHORITY_TTL_MS - 1000);
    await repository.updateBound(authoritySlot(authority), generation, (record) => {
      record.revision++;
    });
    expect(repository.getClaim(authoritySlot(authority))?.expires).toBe(Date.now() + OAUTH_AUTHORITY_TTL_MS);
    expect(repository.getBound(authoritySlot(authority))?.expires).toBe(Date.now() + OAUTH_AUTHORITY_TTL_MS);
    vi.setSystemTime(Date.now() + OAUTH_AUTHORITY_TTL_MS - 1000);
    await repository.activate(authoritySlot(authority), authority, 'new-discovery', generation);
    expect(repository.getClaim(authoritySlot(authority))?.expires).toBe(Date.now() + OAUTH_AUTHORITY_TTL_MS);
    expect(repository.getBound(authoritySlot(authority))?.expires).toBe(Date.now() + OAUTH_AUTHORITY_TTL_MS);
  });

  it('accepts validated DNS rotation but rejects a superseded generation', async () => {
    const generation = await repository.claimContext(authoritySlot(authority), authority, null);
    await repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.8.8');
    await repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.4.4');
    expect(repository.getClaim(authoritySlot(authority))?.destinations['issuer.example']).toBe('8.8.4.4');
    await repository.claimContext(authoritySlot(authority), { ...authority, configuration: 'changed' }, generation);
    await expect(
      repository.pinDestination(authoritySlot(authority), generation, 'issuer.example', '8.8.4.4'),
    ).rejects.toThrow(/OAuth/);
  });
});

it('keeps secret-bearing configuration identity stable across sync/async derivation and distinct across secrets and scopes', async () => {
  const config = { clientSecret: 'secret-a', headers: { authorization: 'Bearer secret' } };
  const asyncDigest = await oauthConfigurationFingerprintAsync(config, ['owner', 'source']);
  const digest = oauthConfigurationFingerprint(config, ['owner', 'source']);
  expect(digest).toBe(asyncDigest);
  expect(oauthConfigurationFingerprint(config, ['owner', 'source'])).toBe(digest);
  expect(oauthConfigurationFingerprint({ ...config, clientSecret: 'secret-b' }, ['owner', 'source'])).not.toBe(digest);
  expect(oauthConfigurationFingerprint(config, ['other-owner', 'source'])).not.toBe(digest);
});
