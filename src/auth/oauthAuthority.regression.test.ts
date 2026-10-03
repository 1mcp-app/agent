import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SDKOAuthClientProvider } from './sdkOAuthClientProvider.js';
import { ClientSessionRepository } from './storage/clientSessionRepository.js';
import { FileStorageService } from './storage/fileStorageService.js';

const dirs: string[] = [];
const providers: SDKOAuthClientProvider[] = [];
afterEach(() => {
  for (const provider of providers.splice(0)) provider.shutdown();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-authority-'));
  dirs.push(dir);
  const storage = new FileStorageService(dir, 'client');
  const repository = new ClientSessionRepository(storage);
  repository.save(
    'same-name',
    {
      serverName: 'same-name',
      tokens: JSON.stringify({ access_token: 'old-secret', token_type: 'Bearer' }),
      clientInfo: JSON.stringify({ client_id: 'old-dynamic' }),
      createdAt: Date.now(),
      expires: Date.now() + 60000,
    },
    60000,
  );
  storage.shutdown();
  const provider = new SDKOAuthClientProvider(
    'same-name',
    { redirectUrl: 'http://localhost/callback', clientId: 'approved-client' },
    dir,
  );
  providers.push(provider);
  return provider;
}
describe('issuer-bound OAuth regression contract', () => {
  it('quarantines an old unbound credential instead of reusing it by display name', async () => {
    expect(await fixture().tokens()).toBeUndefined();
  });
  it('configured registration takes precedence over persisted dynamic registration', async () => {
    expect((await fixture().clientInformation())?.client_id).toBe('approved-client');
  });
  it('does not accept an origin-prefix lookalike protected resource', async () => {
    await expect(
      fixture().validateResourceURL('https://resource.example/mcp', 'https://resource.example.evil/mcp'),
    ).rejects.toThrow();
  });
  it('each authorization attempt receives a new state', async () => {
    const provider = fixture();
    expect(await provider.state()).not.toBe(await provider.state());
  });
});
