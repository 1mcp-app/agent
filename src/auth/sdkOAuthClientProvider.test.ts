import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authoritySlot, OAUTH_ATTEMPT_TTL_MS, oauthDigest } from './oauthAuthority.js';
import { type OAuthClientConfig, SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';
import { ClientSessionRepository } from './storage/clientSessionRepository.js';
import { FileStorageService } from './storage/fileStorageService.js';

let dir: string;
const providers: SDKOAuthClientProvider[] = [];
const issuer = 'https://issuer.example';
const config: OAuthClientConfig = {
  redirectUrl: 'https://proxy.example/oauth/callback/backend',
  scopes: ['read'],
  authority: {
    owner: 'runtime-a',
    source: 'configured-source',
    route: { kind: 'http', connectionKey: 'backend', url: 'https://resource.example/mcp' },
    configuration: 'security-configuration-a',
  },
};
const discovery = {
  authorizationServerUrl: issuer,
  resourceMetadata: { resource: 'https://resource.example/mcp', authorization_servers: [issuer] },
  authorizationServerMetadata: {
    issuer,
    authorization_endpoint: issuer + '/authorize',
    token_endpoint: issuer + '/token',
    registration_endpoint: issuer + '/register',
    response_types_supported: ['code'],
    authorization_response_iss_parameter_supported: true,
  },
};
function provider(changes: Partial<OAuthClientConfig> = {}, name = 'backend') {
  const result = new SDKOAuthClientProvider(name, { ...config, ...changes }, dir);
  providers.push(result);
  return result;
}
async function bound(changes: Partial<OAuthClientConfig> = {}) {
  const result = provider(changes);
  await result.saveDiscoveryState(discovery);
  return result;
}
async function attempt(target: SDKOAuthClientProvider) {
  const state = await target.state();
  const verifier = randomBytes(32).toString('base64url');
  target.saveCodeVerifier(verifier);
  const url = new URL(issuer + '/authorize');
  url.search = new URLSearchParams({
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    redirect_uri: config.redirectUrl,
    resource: config.authority!.route.url,
    scope: 'read',
  }).toString();
  await target.redirectToAuthorization(url);
  return { state, verifier, response: new URLSearchParams({ state, code: 'private-code', iss: issuer }) };
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bound-provider-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const instance of providers.splice(0)) instance.shutdown();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SDKOAuthClientProvider authority persistence', () => {
  it('accepts segment ancestors and preserves Resource Indicator query without broadening the route', async () => {
    const route = 'https://resource.example/team/mcp?transport=1';
    const target = provider({ authority: { ...config.authority!, route: { ...config.authority!.route, url: route } } });
    expect((await target.validateResourceURL(route)).href).toBe(route);
    expect((await target.validateResourceURL(route, 'https://resource.example/team?transport=1')).href).toBe(
      'https://resource.example/team?transport=1',
    );
    expect((await target.validateResourceURL(route, 'https://resource.example?transport=1')).href).toBe(
      'https://resource.example/?transport=1',
    );
    for (const resource of [
      'https://resource.example/team?tenant=2',
      'https://resource.example/team',
      'https://resource.example/tea?transport=1',
      'https://resource.example/team%2Fmcp?transport=1',
      'https://resource.example/other?transport=1',
      'https://resource.example/team/mcp/child?transport=1',
      'https://other.example/team?transport=1',
      'https://resource.example:444/team?transport=1',
      'https://resource.example/team?transport=1#fragment',
      'https://user:pass@resource.example/team?transport=1',
    ]) {
      await expect(target.validateResourceURL(route, resource)).rejects.toThrow(/OAuth/);
    }
    await expect(
      target.validateResourceURL('https://resource.example/team/other', 'https://resource.example'),
    ).rejects.toThrow(/OAuth/);
  });
  it('joins an identical first cold claim even when its migration completes after activation', async () => {
    const original = ClientSessionRepository.prototype.quarantine;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    vi.spyOn(ClientSessionRepository.prototype, 'quarantine').mockImplementation(async function (
      this: ClientSessionRepository,
      name,
    ) {
      if (++count === 2) await held;
      return original.call(this, name);
    });
    const first = provider();
    const second = provider();
    await first.saveDiscoveryState(discovery);
    release();
    await expect(second.saveDiscoveryState(discovery)).resolves.toBeUndefined();
    expect(second.clientInformation()).toBeUndefined();
  });
  it('preserves configured metadata and public client defaults', async () => {
    const target = await bound({ clientId: 'configured' });
    expect(target.redirectUrl).toBe(config.redirectUrl);
    expect(target.clientMetadata).toMatchObject({
      scope: 'read',
      token_endpoint_auth_method: 'none',
      redirect_uris: [config.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(target.clientInformation()).toMatchObject({ client_id: 'configured', issuer });
    expect(target.tokens()).toBeUndefined();
    expect(target.getAuthorizationUrl()).toBeUndefined();
  });
  it('persists dynamic registration under exact authority and configured registration wins', async () => {
    const target = await bound();
    const storage = new FileStorageService(dir, 'client');
    const repository = new ClientSessionRepository(storage);
    const slot = authoritySlot(config.authority!);
    await repository.updateBound(slot, repository.getBound(slot)!.generation, (record) => {
      record.clientInfo = JSON.stringify({ ...target.clientMetadata, client_id: 'dynamic' });
    });
    storage.shutdown();
    expect(provider().clientInformation()).toMatchObject({ client_id: 'dynamic', issuer });
    const configured = await bound({ clientId: 'configured', clientSecret: 'private-secret' });
    await configured.saveClientInformation({ ...target.clientMetadata, client_id: 'ignored-dynamic' });
    expect(configured.clientInformation()).toMatchObject({ client_id: 'configured', client_secret: 'private-secret' });
  });
  it.each(['https://issuer.example/', 'https://other.example'])(
    'rejects mismatched issuer context %s',
    async (wrong) => {
      const target = await bound();
      expect(() => target.tokens({ issuer: wrong })).toThrow(/OAuth authority/);
      expect(() => target.clientInformation({ issuer: wrong })).toThrow(/OAuth authority/);
      await expect(
        target.saveTokens({ access_token: 'opaque', token_type: 'Bearer' }, { issuer: wrong }),
      ).rejects.toThrow(/OAuth authority/);
    },
  );
  it('fails closed on incompatible configured issuer without falling through', async () => {
    await expect(bound({ issuer: issuer + '/' })).rejects.toThrow(/OAuth authority/);
  });
  it('rejects ambiguous issuers unless a compatible approval selects exactly one', async () => {
    const target = provider();
    const ambiguous = {
      ...discovery,
      resourceMetadata: { ...discovery.resourceMetadata, authorization_servers: [issuer, 'https://other.example'] },
    };
    await expect(target.saveDiscoveryState(ambiguous)).rejects.toThrow(/OAuth authority/);
    const approved = provider({ issuer });
    await expect(approved.saveDiscoveryState(ambiguous)).resolves.toBeUndefined();
  });
  it('binds metadata endpoints to authority and rejects stale discovery after endpoint change', async () => {
    const first = await bound();
    const old = provider();
    const changed = {
      ...discovery,
      authorizationServerMetadata: {
        ...discovery.authorizationServerMetadata,
        token_endpoint: 'https://tokens.example/new',
      },
    };
    await first.saveDiscoveryState(changed);
    await expect(old.saveDiscoveryState(discovery)).rejects.toThrow(/OAuth authority/);
    expect(() => old.clientInformation()).toThrow(/OAuth authority/);
    expect(first.discoveryState()).toBeUndefined();
  });
  it('joins simultaneous identical cold-start claims without granting a different source', async () => {
    const storage = new FileStorageService(dir, 'client');
    const repository = new ClientSessionRepository(storage);
    const slot = authoritySlot(config.authority!);
    const [first, second] = await Promise.all([
      repository.claimContext(slot, config.authority!, null),
      repository.claimContext(slot, config.authority!, null),
    ]);
    expect(first).toBe(second);
    await expect(repository.claimContext(slot, { ...config.authority!, configuration: 'other' }, null)).rejects.toThrow(
      /OAuth/,
    );
    storage.shutdown();
  });
  it('a delayed first claim cannot overwrite a newer configuration claim', async () => {
    const storage = new FileStorageService(dir, 'client');
    const repository = new ClientSessionRepository(storage);
    const slot = authoritySlot(config.authority!);
    await repository.claimContext(slot, { ...config.authority!, configuration: 'newer-configuration' }, null);
    await expect(repository.claimContext(slot, config.authority!, null)).rejects.toThrow(/OAuth authority/);
    storage.shutdown();
  });
  it('superseded configuration cannot reactivate its authority', async () => {
    const first = await bound();
    const changed = await bound({ authority: { ...config.authority!, configuration: 'security-configuration-b' } });
    await expect(first.saveDiscoveryState(discovery)).rejects.toThrow(/OAuth authority/);
    expect(() => first.tokens()).toThrow(/OAuth authority/);
    expect(changed.discoveryState()).toBeUndefined();
  });
  it('retains the original independently bound verifier across restart and one consumption', async () => {
    const target = await bound();
    const first = await attempt(target);
    const second = await attempt(target);
    target.shutdown();
    const restarted = provider();
    const exchange = vi.fn(async () => restarted.codeVerifier());
    expect(await restarted.withAuthorizationCallback(first.response, exchange)).toBe(first.verifier);
    await expect(provider().withAuthorizationCallback(first.response, exchange)).rejects.toThrow(/OAuth authority/);
    expect(await restarted.withAuthorizationCallback(second.response, async () => restarted.codeVerifier())).toBe(
      second.verifier,
    );
    expect(exchange).toHaveBeenCalledOnce();
    expect(() => restarted.codeVerifier()).toThrow(/OAuth authority/);
  });
  it('serializes concurrent callbacks, including across repository instances', async () => {
    const target = await bound();
    const flow = await attempt(target);
    const exchange = vi.fn(async () => 'exchanged');
    const results = await Promise.allSettled([
      target.withAuthorizationCallback(flow.response, exchange),
      provider().withAuthorizationCallback(flow.response, exchange),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(exchange).toHaveBeenCalledOnce();
  });
  it('expires attempts at exactly fifteen minutes without sliding with other writes', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const target = await bound();
    const flow = await attempt(target);
    clock.mockReturnValue(now + OAUTH_ATTEMPT_TTL_MS);
    await expect(target.withAuthorizationCallback(flow.response, async () => undefined)).rejects.toThrow(
      /OAuth authority/,
    );
  });
  it.each(['expired', 'consumed'])('does not resume a %s cached authorization URL', async (kind) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const target = await bound();
    const flow = await attempt(target);
    const cachedUrl = target.getAuthorizationUrl();
    expect(target.getPendingAuthorizationUrl()).toBe(cachedUrl);
    if (kind === 'expired') clock.mockReturnValue(now + OAUTH_ATTEMPT_TTL_MS);
    else
      await expect(
        target.withAuthorizationCallback(flow.response, async () => {
          throw new Error('token network failure');
        }),
      ).rejects.toThrow('token network failure');
    expect(target.getAuthorizationUrl()).toBe(cachedUrl);
    expect(target.getPendingAuthorizationUrl()).toBeUndefined();
    await target.invalidateCredentials('tokens');
    await attempt(target);
    expect(target.getPendingAuthorizationUrl()).toBeDefined();
    expect(target.getPendingAuthorizationUrl()).not.toBe(cachedUrl);
  });

  it('bounds pending and consumed attempt records and recovers capacity after expiry', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const target = await bound();
    for (let i = 0; i < 32; i++) await attempt(target);
    await expect(attempt(target)).rejects.toThrow(/Too many/);
    clock.mockReturnValue(now + OAUTH_ATTEMPT_TTL_MS);
    await expect(attempt(target)).resolves.toHaveProperty('state');
  });
  it('keeps admin return with the consumed durable attempt, including restart', async () => {
    const target = await bound();
    const flow = await attempt(target);
    await target.bindAdminReturn(flow.state, 'https://admin.example');
    const restarted = provider();
    expect(restarted.getAdminReturn(flow.state)).toBeUndefined();
    await restarted.withAuthorizationCallback(flow.response, async () => undefined);
    expect(provider().getAdminReturn(flow.state)).toBe('https://admin.example');
  });
  it('invalidation forgets attempts and cannot be undone by stale providers', async () => {
    const target = await bound();
    const stale = provider();
    const flow = await attempt(target);
    await target.invalidateCredentials('all');
    await expect(stale.withAuthorizationCallback(flow.response, async () => undefined)).rejects.toThrow(
      /OAuth authority/,
    );
    await expect(stale.saveDiscoveryState(discovery)).rejects.toThrow(/OAuth authority/);
  });
  it('deliberately shared configured authority works while unrelated instances remain isolated', async () => {
    const target = await bound();
    const flow = await attempt(target);
    const unshared = provider(
      { authority: { ...config.authority!, source: 'unshared-template-instance' } },
      'same-display-name',
    );
    await expect(unshared.withAuthorizationCallback(flow.response, async () => undefined)).rejects.toThrow(
      /OAuth authority/,
    );
    const shared = provider({}, 'another-template-instance');
    expect(await shared.withAuthorizationCallback(flow.response, async () => shared.codeVerifier())).toBe(
      flow.verifier,
    );
  });
  it('stores only hashed state keys and protects bound records with owner-only permissions', async () => {
    const target = await bound();
    const flow = await attempt(target);
    const storage = new FileStorageService(dir, 'client');
    const filename = storage.getFilePath('oauth-bound-', authoritySlot(config.authority!));
    const bytes = fs.readFileSync(filename, 'utf8');
    expect(bytes).not.toContain(flow.state);
    expect(bytes).toContain(oauthDigest(flow.state));
    if (process.platform !== 'win32') expect(fs.statSync(filename).mode & 0o777).toBe(0o600);
    storage.shutdown();
  });
  it('quarantines unbound records idempotently and never promotes their state or registration', async () => {
    const storage = new FileStorageService(dir, 'client');
    const repository = new ClientSessionRepository(storage);
    repository.save(
      'backend',
      {
        serverName: 'backend',
        clientInfo: '{"client_id":"old"}',
        tokens: '{"access_token":"private-old-token"}',
        state: 'private-old-state',
        codeVerifier: 'private-old-verifier',
        createdAt: Date.now(),
        expires: Date.now() + 60000,
      },
      60000,
    );
    await repository.quarantine('backend');
    await repository.quarantine('backend');
    expect(repository.get('backend')).toBeNull();
    expect(fs.existsSync(storage.getFilePath('oauth-quarantine-', oauthDigest('backend')))).toBe(true);
    const target = await bound();
    expect(target.clientInformation()).toBeUndefined();
    expect(target.tokens()).toBeUndefined();
    expect(() => target.codeVerifier()).toThrow(/OAuth authority/);
    storage.shutdown();
  });
  it('preserves migration source if protected rollback write fails', async () => {
    const storage = new FileStorageService(dir, 'client');
    const repository = new ClientSessionRepository(storage);
    repository.save('backend', { serverName: 'backend', createdAt: Date.now(), expires: Date.now() + 60000 }, 60000);
    vi.spyOn(storage, 'writeDataDurable').mockImplementationOnce(() => {
      throw new Error('synthetic storage failure');
    });
    await expect(repository.quarantine('backend')).rejects.toThrow('synthetic storage failure');
    expect(repository.get('backend')).not.toBeNull();
    await repository.quarantine('backend');
    expect(repository.get('backend')).toBeNull();
    storage.shutdown();
  });
});
