import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { activateInboundOAuthStore } from '@src/auth/storage/inboundOAuthStorage.js';
import { type NativeCredentialStore, NativeCredentialStoreError } from '@src/auth/storage/nativeCredentialStore.js';
import { AgentConfigManager } from '@src/core/server/agentConfig.js';
import type { OAuthClientInformationFull } from '@src/sdk/legacy/shared/auth.js';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SDKOAuthServerProvider } from './sdkOAuthServerProvider.js';

class NativeFixture implements NativeCredentialStore {
  readonly records = new Map<string, string>();
  unavailable = false;
  read(key: string): string | null {
    if (this.unavailable) throw new NativeCredentialStoreError('helper_failed');
    return this.records.get(key) ?? null;
  }
  write(key: string, value: string): void {
    if (this.unavailable) throw new NativeCredentialStoreError('helper_failed');
    this.records.set(key, value);
  }
  delete(key: string): void {
    if (this.unavailable) throw new NativeCredentialStoreError('helper_failed');
    this.records.delete(key);
  }
}

const client: OAuthClientInformationFull = {
  client_id: 'native-provider-client',
  client_secret: 'arbitrary-extension-secret',
  redirect_uris: ['http://127.0.0.1:3000/callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};
const resource = 'https://resource.example/mcp';

describe.each(['file', 'native'] as const)('inbound provider with %s storage', (mode) => {
  const config = AgentConfigManager.getInstance();
  let directory: string;
  let native: NativeFixture;
  let provider: SDKOAuthServerProvider;
  let originalAuth: ReturnType<typeof config.get<'auth'>>;
  let originalFeatures: ReturnType<typeof config.get<'features'>>;
  let originalScope: string | undefined;

  beforeEach(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), '1mcp-inbound-provider-'));
    native = new NativeFixture();
    originalAuth = { ...config.get('auth') };
    originalFeatures = { ...config.get('features') };
    originalScope = config.get('runtimeScopeStoragePath');
    config.updateConfig({
      auth: { ...originalAuth, credentialStore: mode, sessionStoragePath: directory },
      features: { ...originalFeatures, auth: true },
      runtimeScopeStoragePath: directory,
    });
    await activateInboundOAuthStore({ baseDir: directory, runtimeScope: directory, mode, nativeStore: native });
    provider = new SDKOAuthServerProvider(directory, 'native-provider-runtime');
    await provider.oauthStorage.ready();
    provider.clientsStore.registerClient?.(client);
  });

  afterEach(() => {
    provider?.shutdown();
    config.updateConfig({ auth: originalAuth, features: originalFeatures, runtimeScopeStoragePath: originalScope });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  async function grant() {
    const code = provider.oauthStorage.authCodeRepository.create(
      client.client_id,
      client.redirect_uris[0],
      resource,
      ['tag:alpha'],
      60_000,
      'challenge',
    );
    const tokens = await provider.exchangeAuthorizationCode(
      client,
      code,
      undefined,
      client.redirect_uris[0],
      new URL(resource),
    );
    return { code, tokens };
  }

  it('commits nested code redemption once and survives provider recreation', async () => {
    const { code, tokens } = await grant();
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow('Invalid or expired');
    provider.shutdown();
    provider = new SDKOAuthServerProvider(directory, 'native-provider-runtime');
    await provider.oauthStorage.ready();
    expect((await provider.verifyAccessToken(tokens.access_token)).scopes).toEqual(['tag:alpha']);
    await expect(provider.exchangeAuthorizationCode(client, code)).rejects.toThrow('Invalid or expired');
    expect((await provider.clientsStore.getClient(client.client_id))?.client_secret).toBe(client.client_secret);
  });

  it('permits one concurrent refresh then rejects all family-bound access after replay', async () => {
    const { tokens } = await grant();
    const attempts = await Promise.allSettled([
      provider.exchangeRefreshToken(client, tokens.refresh_token!),
      provider.exchangeRefreshToken(client, tokens.refresh_token!),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toThrow('Invalid or expired');
    const succeeded = attempts.find((attempt) => attempt.status === 'fulfilled');
    if (succeeded?.status !== 'fulfilled') throw new Error('Expected one successful rotation');
    await expect(provider.verifyAccessToken(succeeded.value.access_token)).rejects.toThrow('Invalid or expired');
  });

  it('consumes an authorization request exactly once under concurrent consent', async () => {
    const request = provider.oauthStorage.createAuthorizationRequest(
      client.client_id,
      client.redirect_uris[0],
      'challenge',
      'consent-state',
      resource,
      ['tag:alpha'],
    );
    const results = await Promise.allSettled([
      provider.oauthStorage.processConsentApproval(request, ['tag:alpha']),
      provider.oauthStorage.processConsentApproval(request, ['tag:alpha']),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  if (mode === 'native') {
    it('fails affected operations closed without changing inbound authentication policy', async () => {
      const { tokens } = await grant();
      native.unavailable = true;
      await expect(provider.verifyAccessToken(tokens.access_token)).rejects.toMatchObject({
        errorCode: 'server_error',
      });
      expect(config.get('features').auth).toBe(true);
      expect(() => provider.clientsStore.getClient(client.client_id)).toThrow(
        'Native credential migration or access is incomplete',
      );
    });

    it('keeps bearer identifiers, refresh plaintext, and record extensions out of managed files', async () => {
      const { code, tokens } = await grant();
      const plaintext = (directory: string): string =>
        fs
          .readdirSync(directory, { withFileTypes: true })
          .map((entry) => {
            const file = path.join(directory, entry.name);
            return entry.name + (entry.isDirectory() ? plaintext(file) : fs.readFileSync(file, 'utf8'));
          })
          .join('\n');
      const files = plaintext(directory);
      for (const secret of [code, tokens.access_token.slice(3), tokens.refresh_token!, client.client_secret!]) {
        expect(files).not.toContain(secret);
      }
      const nativePayloads = [...native.records.values()].join('');
      expect(nativePayloads).not.toContain(tokens.refresh_token!);
    });
  }
});
